import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

for (const { count, width } of [{ count: 2, width: 56 }, { count: 4, width: 56 }, { count: 2, width: 35 }]) test(`${count} wrap images stay at their drop coordinates beside and above each other, with bounded layout work${width === 35 ? ' inside the page' : ''}`, async ({ page }, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1400, height: 1000 });
  const audio = info.outputPath('multiple-wrap.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'multiple-wrap.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  await page.evaluate(() => {
    const probe = { measurements: [] as { ms: number; gaps: number; imageReads: number }[] };
    (window as unknown as { multiWrapProbe: typeof probe }).multiWrapProbe = probe;
    const append = Element.prototype.appendChild;
    const remove = Element.prototype.remove;
    const bounds = Element.prototype.getBoundingClientRect;
    const starts = new WeakMap<Node, { time: number; imageReads: number }>();
    Element.prototype.getBoundingClientRect = function() {
      const start = starts.get(this.closest('.tiptap-editor')!);
      const rect = bounds.call(this);
      if (start && this.classList.contains('editor-image-surface')) start.imageReads++;
      return rect;
    };
    Element.prototype.appendChild = function<T extends Node>(child: T): T {
      if (child instanceof HTMLElement && child.classList.contains('tiptap-editor') && child.getAttribute('aria-hidden') === 'true') starts.set(child, { time: performance.now(), imageReads: 0 });
      return append.call(this, child) as T;
    };
    Element.prototype.remove = function() {
      const start = starts.get(this);
      if (start !== undefined) probe.measurements.push({ ms: performance.now() - start.time, gaps: this.querySelectorAll('.image-wrap-gap').length, imageReads: start.imageReads });
      return remove.call(this);
    };
  });
  await editor.evaluate((root, { src, count, width }) => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const image = (name: string) => `<span data-editor-image data-layout="wrap" data-width="${width}" data-position="${width === 35 ? 0 : 50}"><img src="${src}" alt="${name}"></span>`;
    instance.commands.setContent(`<p>Prima</p><p>${image('Prima figura')}${'Testo vicino alle figure. '.repeat(3)}</p><p>${image('Seconda figura')}${'Altro testo da disporre. '.repeat(3)}</p>` + Array.from({ length: count - 2 }, (_, i) => `<p>${'Testo tra le figure. '.repeat(100)}</p><p>${image(`Altra figura ${i}`)}${'Testo delle altre figure. '.repeat(3)}</p>`).join('') + '<p>Testo dopo le figure da disporre attorno alle immagini.</p>'.repeat(100));
  }, { src, count, width });
  await expect(editor.getByAltText('Seconda figura')).toBeVisible();
  await page.waitForTimeout(300);
  const first = editor.getByAltText('Prima figura');
  const second = editor.getByAltText('Seconda figura');
  const read = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const original = await read();
  const initialLayout = await page.evaluate(() => (window as unknown as { multiWrapProbe: { measurements: { ms: number; gaps: number; imageReads: number }[] } }).multiWrapProbe);
  fs.writeFileSync(info.outputPath('initial-layout.json'), JSON.stringify(initialLayout, null, 2));
  expect(Math.max(...initialLayout.measurements.map(m => m.imageReads))).toBeLessThanOrEqual(count * 3);
  const reports = [];
  for (const placement of ['beside', 'below', 'above'] as const) {
    const a = (await first.boundingBox())!;
    const b = (await second.boundingBox())!;
    const left = placement === 'beside' ? a.x + a.width + 12 : a.x;
    const top = placement === 'below' ? a.y + a.height + 8 : placement === 'above' ? a.y - 20 : a.y;
    const measurements = await page.evaluate(() => (window as unknown as { multiWrapProbe: { measurements: unknown[] } }).multiWrapProbe.measurements.length);
    await page.mouse.move(b.x + 15, b.y + 15); await page.mouse.down();
    await page.mouse.move(left + 15, top + 15, { steps: 15 });
    await expect(page.locator('.editor-image-drag-preview img')).toBeVisible();
    const ghost = (await page.locator('.editor-image-drag-preview img').boundingBox())!;
    expect(await page.evaluate(() => (window as unknown as { multiWrapProbe: { measurements: unknown[] } }).multiWrapProbe.measurements.length)).toBe(measurements);
    await page.mouse.up();
    await expect.poll(async () => {
      const actual = (await second.boundingBox())!;
      return Math.max(Math.abs(actual.x - ghost.x), Math.abs(actual.y - ghost.y));
    }).toBeLessThan(2);
    expect(await editor.locator('.image-wrap-gap').count()).toBeLessThan(100);
    await expect.poll(() => editor.evaluate(root => {
      const images = Array.from(root.querySelectorAll('[data-editor-image] img')).map(img => img.getBoundingClientRect());
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null, collisions = 0;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('[contenteditable="false"], [data-editor-image]')) continue;
        for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
          const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
          for (const rect of range.getClientRects()) if (images.some(img => rect.bottom > img.top && rect.top < img.bottom && rect.right > img.left && rect.left < img.right)) collisions++;
        }
      }
      return collisions;
    })).toBe(0);
    reports.push({ placement, ghost, actual: await second.boundingBox(), gaps: await editor.locator('.image-wrap-gap').count() });
  }
  const final = await read();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  expect(await read()).toEqual(original);
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(final);
  const geometry = (await second.boundingBox())!.y - (await editor.boundingBox())!.y;
  // Typing in the affected region must still reflow text, without repeatedly
  // measuring every image for each exclusion spacer. Typing after it reuses gaps.
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.focus(); instance.commands.setTextSelection(2);
  });
  await page.keyboard.type('VICINO ', { delay: 40 });
  const typed = await read();
  const probe = () => page.evaluate(() => (window as unknown as { multiWrapProbe: { measurements: { ms: number; gaps: number; imageReads: number }[] } }).multiWrapProbe);
  const near = await probe();
  expect(near.measurements.length).toBeGreaterThan(3);
  expect(Math.max(...near.measurements.map(m => m.imageReads))).toBeLessThanOrEqual(count * 3);
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.focus(); instance.commands.setTextSelection(instance.state.doc.content.size - 1);
  });
  await page.keyboard.type('LONTANO ');
  expect((await probe()).measurements.length).toBe(near.measurements.length);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(typed);
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(final);
  await page.waitForTimeout(100);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  expect(await read()).toEqual(final);
  await expect.poll(async () => Math.abs((await second.boundingBox())!.y - (await editor.boundingBox())!.y - geometry)).toBeLessThan(2);
  fs.writeFileSync(info.outputPath('multiple-wrap.json'), JSON.stringify({ placements: reports, typing: near }, null, 2));
});

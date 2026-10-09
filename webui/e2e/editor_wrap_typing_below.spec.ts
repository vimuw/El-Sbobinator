import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

for (const zoom of [1, 1.1, 0.9]) test(`typing below two late wrap figures preserves layout without copying the preceding transcript at zoom ${zoom}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const audio = info.outputPath('late-wrap.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'late-wrap.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  await editor.focus();
  await page.keyboard.press('Control+0');
  if (zoom !== 1) await page.keyboard.press(zoom > 1 ? 'Control+=' : 'Control+-');
  await expect(page.locator('.editor-page')).toHaveCSS('zoom', String(zoom));
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  await page.evaluate(() => {
    const probe = { blocks: [] as number[] };
    (window as unknown as { lateWrapProbe: typeof probe }).lateWrapProbe = probe;
    const remove = Element.prototype.remove;
    Element.prototype.remove = function() {
      if (this.classList.contains('tiptap-editor') && this.getAttribute('aria-hidden') === 'true') probe.blocks.push(this.children.length);
      return remove.call(this);
    };
  });
  await editor.evaluate((root, src) => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const image = (name: string, offsetY: number) => `<span data-editor-image data-layout="wrap" data-width="59" data-position="100" data-offset-y="${offsetY}" data-aspect-ratio="1.3333"><img src="${src}" alt="${name}"></span>`;
    const prefix = Array.from({ length: 180 }, (_, i) => `<p>Paragrafo precedente ${i}. ${'Testo lungo della lezione. '.repeat(12)}</p>`).join('');
    instance.commands.setContent(prefix + `<p>${image('Prima figura tardiva', 40)}${'Testo accanto alla prima figura. '.repeat(20)}</p><h3>Sezione con seconda figura</h3><p>${image('Seconda figura tardiva', 230)}${'Testo accanto alla seconda figura. '.repeat(18)}</p><p>SCRIVI QUI</p><h2>Sezione successiva</h2><p>Testo successivo.</p>`);
    instance.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'SCRIVI QUI') instance.commands.setTextSelection(pos + node.nodeSize);
    });
    instance.commands.focus();
  }, src);
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  // Keep fixture installation separate from the user's typing history group.
  await page.waitForTimeout(600);
  const target = editor.locator('p', { hasText: 'SCRIVI QUI' });
  const read = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const images = () => editor.locator('[data-layout="wrap"] .editor-image-surface').evaluateAll(nodes => {
    const root = nodes[0].closest('.tiptap-editor')!.getBoundingClientRect();
    return nodes.map(node => { const rect = node.getBoundingClientRect(); return { left: rect.left-root.left, top: rect.top-root.top, width: rect.width, height: rect.height }; });
  });
  const original = await read();
  const originalImages = await images();
  // Trimming the measured prefix must still place every word outside figures.
  expect(await editor.evaluate(root => {
    const figures = Array.from(root.querySelectorAll('[data-layout="wrap"] img')).map(img => img.getBoundingClientRect());
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null, collisions = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[contenteditable="false"], [data-editor-image]')) continue;
      const range = document.createRange();
      for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        for (const rect of range.getClientRects()) if (figures.some(img => rect.bottom > img.top && rect.top < img.bottom && rect.right > img.left && rect.left < img.right)) collisions++;
      }
    }
    return collisions;
  })).toBe(0);
  expect((await target.boundingBox())!.y).toBeGreaterThan((await editor.getByAltText('Seconda figura tardiva').boundingBox())!.y + (await editor.getByAltText('Seconda figura tardiva').boundingBox())!.height + 16);
  const measured = await page.evaluate(() => (window as unknown as { lateWrapProbe: { blocks: number[] } }).lateWrapProbe.blocks);
  expect(measured.length).toBeGreaterThan(0);
  expect(Math.max(...measured)).toBeLessThan(15);
  await page.keyboard.type('fdhjskfdsjkfdsjhfjkdshfkjdshfkdjsfhdsjk', { delay: 20 });
  await expect(target).toContainText('fdhjskfdsjkfdsjhfjkdshfkjdshfkdjsfhdsjk');
  expect(await page.evaluate(() => (window as unknown as { lateWrapProbe: { blocks: number[] } }).lateWrapProbe.blocks)).toEqual(measured);
  expect(await images()).toEqual(originalImages);
  const final = await read();
  await page.keyboard.press('Control+z');
  expect(await read()).toEqual(original);
  await page.keyboard.press('Control+Shift+z');
  expect(await read()).toEqual(final);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  expect(await read()).toEqual(final);
  expect(await images()).toEqual(originalImages);
});

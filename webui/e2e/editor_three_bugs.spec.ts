import fs from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { Editor } from '@tiptap/core';

async function openEditor(page: Page, info: TestInfo) {
  const audio = info.outputPath('three-bugs.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.locator('.queue-card.is-completed').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
}

test.beforeEach(async ({ page }, info) => openEditor(page, info));

test('context menu stays inside the viewport and its final action is reachable with and without a selection', async ({ page }) => {
  for (const height of [720, 400]) for (const selected of [false, true]) {
    await page.setViewportSize({ width: 1280, height });
    await page.locator('.tiptap-editor').evaluate((root, selected) => {
      const editor = (root as HTMLElement & { editor: Editor }).editor;
      editor.commands.setTextSelection(selected ? { from: 1, to: 4 } : 1);
    }, selected);
    const bounds = await page.locator('.editor-page-container').boundingBox();
    await page.mouse.click(bounds!.x + bounds!.width - 8, bounds!.y + bounds!.height - 8, { button: 'right' });
    const menu = page.locator('.editor-context-menu');
    await expect(menu).toBeVisible();
    const geometry = await menu.evaluate(el => ({ rect: el.getBoundingClientRect().toJSON(), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
    expect(geometry.rect.top).toBeGreaterThanOrEqual(12);
    expect(geometry.rect.bottom).toBeLessThanOrEqual(height - 12);
    expect(geometry.rect.right).toBeLessThanOrEqual(1280 - 12);
    if (height === 400) expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
    await menu.getByRole('button', { name: /Trova e sostituisci/ }).click();
    await expect(menu).toHaveCount(0);
    await page.getByTitle('Chiudi (Esc)').click();
  }
});

test('wrap typing after the figure reuses gaps while edits beside it measure a bounded region and preserve history and reopen', async ({ page }, info) => {
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const editor = page.locator('.tiptap-editor');
  await editor.evaluate((root, src) => {
    const editor = (root as HTMLElement & { editor: Editor }).editor;
    editor.commands.setContent(`<p><span data-editor-image data-layout="wrap" data-width="56" data-position="50"><img src="${src}"></span>${'Testo vicino alla figura per verificare scrittura e geometria. '.repeat(12)}</p>` + Array.from({ length: 200 }, (_, i) => `<p>Paragrafo ${i} ${'Testo della sbobina da modificare. '.repeat(8)}</p>`).join(''));
    editor.commands.focus(); editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  }, src);
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const probe = { clones: 0, blocks: [] as number[] };
    (window as unknown as { wrapTypingProbe: typeof probe }).wrapTypingProbe = probe;
    const clone = Node.prototype.cloneNode;
    Node.prototype.cloneNode = function(deep) {
      const result = clone.call(this, deep);
      if (this instanceof HTMLElement && this.classList.contains('tiptap-editor')) {
        probe.clones++;
        queueMicrotask(() => probe.blocks.push((result as HTMLElement).children.length));
      }
      return result;
    };
  });
  const probe = () => page.evaluate(() => (window as unknown as { wrapTypingProbe: { clones: number; blocks: number[] } }).wrapTypingProbe);
  const geometry = () => editor.locator('.image-wrap-gap').evaluateAll(gaps => gaps.map(el => ({ width: (el as HTMLElement).style.width, height: (el as HTMLElement).style.height })));
  const originalGaps = await geometry();
  await page.keyboard.type('DIGITAZIONE', { delay: 30 });
  await page.waitForTimeout(200);
  expect((await probe()).clones).toBe(0);
  expect(await geometry()).toEqual(originalGaps);
  await expect(editor.locator('p').last()).toContainText('DIGITAZIONE');
  await editor.evaluate(root => {
    const editor = (root as HTMLElement & { editor: Editor }).editor;
    editor.commands.focus(); editor.commands.setTextSelection(2);
  });
  await page.keyboard.type('SCRITTURA ', { delay: 30 });
  await page.waitForTimeout(200);
  const measured = await probe();
  expect(measured.clones).toBeGreaterThan(0);
  expect(measured.clones).toBeLessThanOrEqual(10);
  expect(Math.max(...measured.blocks)).toBeLessThan(10);
  const final = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p').first()).not.toContainText('SCRITTURA');
  await page.keyboard.press('Control+Shift+z');
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(final);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(final);
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML())).not.toContain('image-wrap-gap');
  fs.writeFileSync(info.outputPath('wrap-typing.json'), JSON.stringify(measured));
});

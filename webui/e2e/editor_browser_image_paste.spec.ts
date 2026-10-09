import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

async function openEditor(page: Page, audio: string) {
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: audio.split(/[\\/]/).pop()! });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
}

async function writeImageClipboard(page: Page, html: string) {
  return page.evaluate(async markup => {
    const canvas = document.createElement('canvas');
    canvas.width = 180; canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#e87924'; context.fillRect(0, 0, 180, 120);
    context.fillStyle = '#2479e8'; context.fillRect(40, 30, 100, 60);
    const src = canvas.toDataURL('image/png');
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const formats: Record<string, Blob> = { 'image/png': image };
    if (markup) formats['text/html'] = new Blob([markup.replaceAll('EMBEDDED_IMAGE', src)], { type: 'text/html' });
    await navigator.clipboard.write([new ClipboardItem(formats)]);
    return src;
  }, html);
}

test('browser Copy image and screenshot paste embed pixels, support undo and survive saved reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page, testInfo.outputPath('browser_copy_image.wav'));
  const editor = page.locator('.tiptap-editor');
  const readHtml = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
  // The persistence sanitizer drops IMG title; compare all saved content and
  // image data/layout independently of that optional tooltip.
  const persistedHtml = () => readHtml().then(html => html.replace(/ title="[^"]*"/g, ''));
  const profiles = [
    '', // Screenshot: pixels only.
    '<img src="https://unavailable.invalid/image.svg" alt="Respiratory burst - Wikipedia">',
    '<!--StartFragment--><a href="https://unavailable.invalid"><img src="https://unavailable.invalid/image.png"></a><!--EndFragment-->',
    '<div><span><img src="blob:https://unavailable.invalid/expired"></span></div>',
  ];
  for (const html of profiles) {
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.commands.setContent('<p>Prima</p>');
      instance.commands.setTextSelection(6);
    });
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    const before = await readHtml();
    await writeImageClipboard(page, html);
    await editor.focus(); await page.keyboard.press('Control+v');
    const image = editor.locator('img.editor-image-asset');
    await expect(image).toHaveCount(1);
    await expect(image).toHaveAttribute('src', /^data:image\//);
    await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(editor).toContainText('Prima');
    const pasted = await readHtml();
    expect(pasted).not.toContain('unavailable.invalid');
    await page.keyboard.press('Control+z');
    await expect.poll(readHtml).toBe(before);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(readHtml).toBe(pasted);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await page.locator('.queue-card.is-completed', { hasText: 'browser_copy_image.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible();
    await expect.poll(persistedHtml).toBe(pasted.replace(/ title="[^"]*"/g, ''));
    await expect.poll(() => editor.locator('img.editor-image-asset').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  }
  await page.screenshot({ path: testInfo.outputPath('browser-image-pasted.png') });
});

test('image pixels alongside a mixed HTML document retain its text, formatting and image layout', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page, testInfo.outputPath('mixed_image_clipboard.wav'));
  const editor = page.locator('.tiptap-editor');
  await writeImageClipboard(page, '<p><strong>Testo prima</strong></p><p><span data-editor-image data-layout="wrap" data-align="left" data-width="35"><img src="EMBEDDED_IMAGE"></span></p><p>Testo dopo</p>');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('strong')).toHaveText('Testo prima');
  await expect(editor).toContainText('Testo dopo');
  await expect(editor.locator('img.editor-image-asset')).toHaveCount(1);
  const html = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
  expect(html).toContain('data-layout="wrap"');
  expect(html).toContain('data-width="35"');
});

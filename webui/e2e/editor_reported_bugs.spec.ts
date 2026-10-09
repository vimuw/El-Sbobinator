import fs from 'node:fs';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function openEditor(page: Page, info: TestInfo) {
  const audio = info.outputPath('reported_bugs.wav');
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

async function paste(page: Page, html: string) {
  await page.evaluate(async value => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]), html);
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
}

test.beforeEach(async ({ context, page }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page, info);
});

test('repeated list Tab retains editor focus while the audio bar is present', async ({ page }) => {
  await paste(page, '<ol><li><p>Prima</p></li><li><p>Seconda</p></li></ol>');
  const editor = page.locator('.tiptap-editor');
  await expect(page.locator('audio')).toHaveCount(1);
  for (const label of ['Prima', 'Seconda']) {
    await editor.evaluate((root, label) => {
      const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === label) instance.commands.setTextSelection(pos); });
    }, label);
    await editor.focus();
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); await expect(editor).toBeFocused(); }
  }
  await page.keyboard.press('Shift+Tab'); await expect(editor).toBeFocused();
});

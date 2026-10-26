import fs from 'node:fs';
import { expect, test } from '@playwright/test';

test('Escape in the find bar and in Trova e sostituisci closes only the search', async ({ page }, testInfo) => {
  const audio = testInfo.outputPath('ricerca.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'ricerca.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.press('Control+f');
  const findBar = page.locator('.find-bar-float');
  await expect(findBar.getByPlaceholder('Trova nel documento...')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(findBar).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();

  await page.keyboard.press('Control+h');
  const dialog = page.locator('.find-replace-dialog');
  await dialog.getByPlaceholder('Sostituisci con...').focus();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(editor).toBeVisible();
  await expect(editor).toBeFocused();

  // With the search closed, Escape still closes the full-page editor.
  await page.keyboard.press('Escape');
  await expect(editor).toHaveCount(0);
});

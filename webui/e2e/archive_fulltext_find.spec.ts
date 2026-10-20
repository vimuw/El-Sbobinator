import { expect, test } from '@playwright/test';

test('opening a full-text archive result highlights the query in the editor', async ({ page }) => {
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({
    name: 'Fisiologia.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'),
  });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByRole('heading', { name: 'Recenti' })).toBeVisible({ timeout: 15_000 });
  // A fresh app loads the editor lazily, as when reopening the archive later.
  await page.reload();

  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await page.getByRole('button', { name: 'Testo completo' }).click();
  await page.getByPlaceholder('Cerca nel contenuto...').fill('cardiac');
  const result = page.locator('button.archive-session-card', { hasText: 'occorrenz' }).first();
  await expect(result).toBeVisible();
  await result.click();

  await expect(page.locator('.find-bar-input')).toHaveValue('cardiac');
  // The simulated lesson mentions "cardiaco/cardiaca" four times.
  await expect(page.locator('.find-bar-count')).toHaveText('1 di 4');
  await expect(page.locator('.tiptap-editor .search-highlight-active')).toHaveText(/^cardiac$/i);
  await expect(page.locator('.tiptap-editor .search-highlight')).toHaveCount(3);
});

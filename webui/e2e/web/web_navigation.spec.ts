import { expect, test, type Page } from '@playwright/test';

// The screen is in the URL hash: Back/Forward move between screens (iPad edge swipe included) and a
// reload reopens the same one. Simulated run (?simulazione=1), no Gemini calls. Chromium, not Safari.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';

async function completeSimulatedRun(page: Page, name: string) {
  await page.goto('/?simulazione=1');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: `${name}.mp3`, mimeType: 'audio/mpeg', buffer: Buffer.alloc(2048) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 20_000 });
}

test('Back, Forward and reload keep the screen, editor included @web-smoke', async ({ page }) => {
  await completeSimulatedRun(page, 'Lezione cronologia');
  const heading = page.locator('.tiptap-editor h1');

  await page.locator('.queue-card.is-completed', { hasText: 'Lezione cronologia.mp3' }).click();
  await expect(heading).toHaveText('Lezione cronologia');
  await expect(page).toHaveURL(/simulazione=1#\/sbobina\/[0-9a-f-]+$/);
  const editorUrl = page.url();

  await page.goBack();
  await expect(heading).toHaveCount(0);
  await expect(page.locator('.queue-card.is-completed', { hasText: 'Lezione cronologia.mp3' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');

  await page.goForward();
  await expect(heading).toHaveText('Lezione cronologia');
  expect(page.url()).toBe(editorUrl);

  await page.reload();
  await expect(heading).toHaveText('Lezione cronologia');
  expect(page.url()).toBe(editorUrl);

  // Closing from the app goes back too: no duplicate entry to step through.
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await expect(heading).toHaveCount(0);
  await expect.poll(() => new URL(page.url()).hash).toBe('');

  await page.getByRole('navigation').getByRole('button', { name: 'Archivio' }).click();
  await expect(page).toHaveURL(/#\/archivio$/);
  await page.reload();
  await expect(page.getByText('Archivio Sbobine')).toBeVisible();

  await page.getByRole('button', { name: 'Apri impostazioni', exact: true }).click();
  await expect(page).toHaveURL(/#\/archivio\/impostazioni$/);
  await expect(page.getByLabel('Chiavi API Gemini, una per riga')).toBeVisible();
  await page.goBack();
  await expect(page.getByLabel('Chiavi API Gemini, una per riga')).toHaveCount(0);
  await expect(page.getByText('Archivio Sbobine')).toBeVisible();
});

test('a sbobina deleted from this browser opens its page instead @web-smoke', async ({ page }) => {
  await completeSimulatedRun(page, 'Lezione assente');
  await page.goto('/?simulazione=1#/archivio/sbobina/00000000-0000-0000-0000-000000000000');
  await expect(page.getByText('Archivio Sbobine')).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe('#/archivio');
  await expect(page.locator('.tiptap-editor')).toHaveCount(0);
});

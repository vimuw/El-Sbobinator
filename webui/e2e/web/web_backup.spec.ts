import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAutosaved } from '../autosave';

// Backup round trip in the static build: a sbobina with an edit and the audio the user kept in the
// browser is downloaded as a zip, then imported into an empty browser (a new context: no IndexedDB, no keys), where text and
// audio come back. Gemini is answered by page.route. Chromium only, not Safari or an iPad.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';
const GEMINI = 'https://generativelanguage.googleapis.com';

function syntheticMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function fakeGemini(page: Page) {
  await page.route(`${GEMINI}/**`, route => {
    const request = route.request();
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (!request.url().includes(':generateContent')) return route.fulfill({ status: 404, headers: cors, body: 'not mocked' });
    const text = '## Il cuore\n\nIl cuore pompa il sangue nei vasi.';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
  });
}

async function startWithKey(page: Page) {
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
}

async function openStorageSettings(page: Page) {
  await page.getByRole('button', { name: 'Apri impostazioni', exact: true }).click();
  await page.getByRole('button', { name: 'Archiviazione' }).click();
  await expect(page.getByTestId('web-backup')).toBeVisible();
}

test('downloads a backup and restores sbobina, edit and audio in an empty browser', async ({ page, browser }) => {
  await fakeGemini(page);
  await startWithKey(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Cardiologia.mp3', mimeType: 'audio/mpeg', buffer: syntheticMp3(400) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 40_000 });

  await page.locator('.queue-card.is-completed', { hasText: 'Cardiologia.mp3' }).click();
  const editor = page.locator('.tiptap-editor');
  await expect(editor.locator('h1')).toHaveText('Cardiologia');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Modifica da salvare nel backup.');
  await expectAutosaved(page);
  // A sbobina keeps its audio only on request; only a kept audio goes into the backup.
  await page.getByRole('button', { name: 'Opzioni audio collegato' }).click();
  const keep = page.getByRole('switch', { name: /Tieni l’audio in questo browser/ });
  await keep.click();
  await expect(keep).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await expect(editor).toHaveCount(0);

  await openStorageSettings(page);
  await expect(page.getByTestId('web-backup-estimate')).toContainText('1 sbobina');
  await page.getByRole('button', { name: 'Prepara backup' }).click();
  const link = page.getByTestId('web-backup-download');
  await expect(link).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^El-Sbobinator-backup-\d{4}-\d{2}-\d{2}\.zip$/);
  const backupPath = await download.path();
  await expect(page.getByTestId('web-backup-last')).toContainText('Ultimo backup scaricato');
  expect(readFileSync(backupPath).includes(DUMMY_KEY)).toBe(false);

  // An empty browser: nothing in IndexedDB or localStorage, the key typed again.
  const empty = await browser.newContext();
  const other = await empty.newPage();
  await startWithKey(other);
  await openStorageSettings(other);
  await expect(other.getByTestId('web-backup-estimate')).toContainText('0 sbobine');
  const importChooser = other.waitForEvent('filechooser');
  await other.getByRole('button', { name: 'Importa backup' }).click();
  await (await importChooser).setFiles(backupPath);
  await expect(other.getByTestId('web-backup').getByRole('status')).toHaveText('Backup importato: 1 sbobina aggiunta, 1 audio importato.');
  await expect(other.getByTestId('storage-usage')).toContainText('1 sbobina');

  await other.getByRole('button', { name: 'Chiudi finestra' }).click();
  await other.getByRole('button', { name: 'Archivio', exact: true }).click();
  await other.locator('.archive-session-card').filter({ has: other.getByRole('button', { name: 'Seleziona Cardiologia' }) }).click();
  await expect(other.locator('.tiptap-editor')).toContainText('Modifica da salvare nel backup.');
  const audio = other.locator('.editor-player-dock audio');
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await other.getByRole('button', { name: 'Avvia riproduzione' }).click();
  await expect.poll(() => audio.evaluate(element => (element as HTMLAudioElement).currentTime), { timeout: 10_000 }).toBeGreaterThan(0.3);

  // Importing the same backup again adds nothing.
  await other.getByRole('button', { name: 'Metti in pausa' }).click();
  await other.getByRole('button', { name: 'Torna indietro' }).click();
  await openStorageSettings(other);
  const againChooser = other.waitForEvent('filechooser');
  await other.getByRole('button', { name: 'Importa backup' }).click();
  await (await againChooser).setFiles(backupPath);
  await expect(other.getByTestId('web-backup').getByRole('status')).toHaveText('Backup importato: 1 già presente e lasciata com’era.');
  await empty.close();
});

test('without a Google client ID the settings have no Drive panel and no trash', async ({ page }) => {
  await startWithKey(page);
  await openStorageSettings(page);
  await expect(page.getByTestId('web-drive')).toHaveCount(0);
  // Deleting stays permanent in the released site.
  await expect(page.getByTestId('web-trash')).toHaveCount(0);
});

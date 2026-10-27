import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createFakeDrive, type FakeDrive } from '../../src/web/drive/fakeDrive';
import { expectAutosaved } from '../autosave';

// Drive sync between two browsers (two contexts: separate IndexedDB, localStorage and login) on
// the preview build with a made-up client ID. Google's login answers by page.route with a token in
// the return page's fragment, and one in-memory Drive (fakeDrive.ts) serves both contexts.
// Chromium only: not Safari, not an iPad, not the real Google Drive.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';
const GEMINI = 'https://generativelanguage.googleapis.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };

function syntheticMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

async function fakeGemini(page: Page) {
  await page.route(`${GEMINI}/**`, route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (!request.url().includes(':generateContent')) return route.fulfill({ status: 404, headers: CORS, body: 'not mocked' });
    const text = '## Il cuore\n\nIl cuore pompa il sangue nei vasi.';
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
  });
}

/** Google for one browser: the login page sends straight back with a token, Drive is the shared fake. */
async function fakeGoogle(context: BrowserContext, drive: FakeDrive, device: string) {
  let tokens = 0;
  await context.route('https://accounts.google.com/**', route => {
    const url = new URL(route.request().url());
    const fragment = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      access_token: `${device}-${++tokens}`,
      token_type: 'Bearer',
      expires_in: '3600',
      scope: DRIVE_SCOPE,
    });
    return route.fulfill({ status: 302, headers: { location: `${url.searchParams.get('redirect_uri')}#${fragment.toString()}` } });
  });
  await context.route('https://www.googleapis.com/**', async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const answer = drive.handle({ url: request.url(), method: request.method(), headers: await request.allHeaders(), body: request.postData() });
    return route.fulfill({ status: answer.status, headers: { ...answer.headers, ...CORS }, body: answer.body });
  });
}

async function startWithKey(page: Page) {
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
}

async function openDriveSettings(page: Page) {
  await page.getByRole('button', { name: 'Apri impostazioni', exact: true }).click();
  await page.getByRole('button', { name: 'Archiviazione' }).click();
  const panel = page.getByTestId('web-drive');
  await expect(panel).toBeVisible();
  return panel;
}

async function connectDrive(page: Page) {
  const panel = await openDriveSettings(page);
  const popup = page.context().waitForEvent('page');
  await panel.getByRole('button', { name: 'Collega Google Drive' }).click();
  // The return page hands the answer to the app and closes itself.
  await (await popup).waitForEvent('close');
  await expect(panel.getByTestId('web-drive-status')).toHaveText('Collegato come studente@example.com');
  await expect(panel.getByTestId('web-drive-last-sync')).toContainText('Ultima sincronizzazione');
  await page.getByRole('button', { name: 'Chiudi finestra' }).click();
}

async function openFromArchive(page: Page, name: string) {
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await page.locator('.archive-session-card').filter({ has: page.getByRole('button', { name: `Seleziona ${name}` }) }).click();
  return page.locator('.tiptap-editor');
}

const driveBodies = (drive: FakeDrive) => drive.files()
  .filter(file => file.name.startsWith('sbobina-'))
  .map(file => (file.content as { body?: string }).body ?? '');

test('a sbobina made on one browser reaches the other, and an edit there comes back', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const drive = createFakeDrive();
  await fakeGemini(page);
  await fakeGoogle(page.context(), drive, 'pc');

  // PC: a finished sbobina, then Drive linked from the settings.
  await startWithKey(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Cardiologia.mp3', mimeType: 'audio/mpeg', buffer: syntheticMp3(400) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 40_000 });
  await connectDrive(page);
  await expect.poll(() => driveBodies(drive).length).toBe(1);
  expect(JSON.stringify(drive.files())).not.toContain(DUMMY_KEY);

  // iPad (another browser): linking the same account brings the sbobina.
  const ipadContext = await browser.newContext();
  const ipad = await ipadContext.newPage();
  await fakeGoogle(ipadContext, drive, 'ipad');
  await startWithKey(ipad);
  await connectDrive(ipad);
  const ipadEditor = await openFromArchive(ipad, 'Cardiologia');
  await expect(ipadEditor).toContainText('Il cuore pompa il sangue nei vasi.');

  // An edit on the iPad goes up a few seconds after it is saved.
  await ipadEditor.locator('p').last().click();
  await ipad.keyboard.press('End');
  await ipad.keyboard.type(' Aggiunta dall’iPad.');
  await expectAutosaved(ipad);
  await ipad.getByRole('button', { name: 'Torna indietro' }).click();
  await expect.poll(() => driveBodies(drive).join(''), { timeout: 20_000 }).toContain('Aggiunta dall’iPad.');

  // Back on the PC, the next round brings it into the archive.
  const panel = await openDriveSettings(page);
  await panel.getByRole('button', { name: 'Sincronizza ora' }).click();
  await expect(panel.getByTestId('web-drive-last-sync')).toContainText('Ultima sincronizzazione');
  await page.getByRole('button', { name: 'Chiudi finestra' }).click();
  await expect(await openFromArchive(page, 'Cardiologia')).toContainText('Aggiunta dall’iPad.');
  await ipadContext.close();
});

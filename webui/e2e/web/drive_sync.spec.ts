import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { FAKE_FILE_TOKEN_MARK, createFakeDrive, type FakeDrive } from '../../src/web/drive/fakeDrive';
import { expectAutosaved } from '../autosave';

// Drive sync between two browsers (two contexts: separate IndexedDB, localStorage and login) on
// the preview build with a made-up client ID. Google's login answers by page.route with a token in
// the return page's fragment, and one in-memory Drive (fakeDrive.ts) serves both contexts.
// Chromium only: not Safari, not an iPad, not the real Google Drive.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';
const GEMINI = 'https://generativelanguage.googleapis.com';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
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

/**
 * Google for one browser: the login page sends straight back with a token, Drive is the shared fake.
 * Asked for drive.file (the export), the token also covers it, as with include_granted_scopes.
 */
async function fakeGoogle(context: BrowserContext, drive: FakeDrive, device: string) {
  let tokens = 0;
  await context.route('https://accounts.google.com/**', route => {
    const url = new URL(route.request().url());
    const file = url.searchParams.get('scope') === FILE_SCOPE;
    const fragment = new URLSearchParams({
      state: url.searchParams.get('state') ?? '',
      access_token: `${device}-${file ? `${FAKE_FILE_TOKEN_MARK}-` : ''}${++tokens}`,
      token_type: 'Bearer',
      expires_in: '3600',
      scope: file ? `${DRIVE_SCOPE} ${FILE_SCOPE}` : DRIVE_SCOPE,
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

/** Waits for the Google window an action opens: the return page hands the answer over and closes. */
async function throughGoogle(page: Page, action: () => Promise<void>) {
  const popup = page.context().waitForEvent('page');
  await action();
  await (await popup).waitForEvent('close');
}

/** A browser without sbobine links Drive from the settings ("Dove tengo le sbobine?"). */
async function connectDrive(page: Page) {
  const panel = await openDriveSettings(page);
  await expect(panel.getByTestId('web-drive-local-only')).toContainText('Safari può cancellarle');
  await throughGoogle(page, () => panel.getByRole('radio', { name: 'In questo browser + Google Drive' }).check());
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
const trashedOnDrive = (drive: FakeDrive) => drive.files().filter(file => (file.content as { deleted_at?: string }).deleted_at).length;

/** The PC's first sbobina, then the question it brings, answered with Drive. */
async function firstSbobinaLinkedToDrive(page: Page) {
  await startWithKey(page);
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Cardiologia.mp3', mimeType: 'audio/mpeg', buffer: syntheticMp3(400) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 40_000 });
  const question = page.getByRole('dialog', { name: 'Dove tengo le sbobine?' });
  await expect(question).toBeVisible();
  await throughGoogle(page, () => question.getByRole('button', { name: /In questo browser \+ Google Drive/ }).click());
  await expect(question).toHaveCount(0);
}

async function syncNow(page: Page) {
  const panel = await openDriveSettings(page);
  await panel.getByRole('button', { name: 'Sincronizza ora' }).click();
  await expect(panel.getByTestId('web-drive-last-sync')).toContainText('Ultima sincronizzazione');
  return panel;
}

test('a sbobina made on one browser reaches the other, and an edit there comes back', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const drive = createFakeDrive();
  await fakeGemini(page);
  await fakeGoogle(page.context(), drive, 'pc');

  // PC: a finished sbobina asks where to keep it; Drive.
  await firstSbobinaLinkedToDrive(page);
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
  await syncNow(page);
  await page.getByRole('button', { name: 'Chiudi finestra' }).click();
  await expect(await openFromArchive(page, 'Cardiologia')).toContainText('Aggiunta dall’iPad.');
  await ipadContext.close();
});

test('the trash and the restore reach the other browser; export and "Elimina tutti i miei dati"', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const drive = createFakeDrive();
  await fakeGemini(page);
  await fakeGoogle(page.context(), drive, 'pc');
  await firstSbobinaLinkedToDrive(page);
  await expect.poll(() => driveBodies(drive).length).toBe(1);
  const ipadContext = await browser.newContext();
  const ipad = await ipadContext.newPage();
  await fakeGoogle(ipadContext, drive, 'ipad');
  await startWithKey(ipad);
  await connectDrive(ipad);

  // PC: deleting moves the sbobina to the trash, with its text still on Drive.
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  await page.getByRole('button', { name: 'Seleziona Cardiologia' }).click();
  await page.getByRole('button', { name: 'Elimina', exact: true }).click();
  await expect(page.getByText('La sbobina selezionata va nel cestino: puoi ripristinarla per 30 giorni')).toBeVisible();
  await page.getByRole('button', { name: 'Sposta nel cestino' }).click();
  await expect(page.locator('.archive-session-card')).toHaveCount(0);
  await expect.poll(() => trashedOnDrive(drive), { timeout: 20_000 }).toBe(1);
  expect(driveBodies(drive).join('')).toContain('Il cuore pompa il sangue nei vasi.');

  // iPad: the next round puts it in the trash there; "Ripristina" brings it back everywhere.
  await syncNow(ipad);
  const trash = ipad.getByTestId('web-trash');
  await expect(trash).toContainText('Cardiologia');
  await expect(trash).toContainText('Ancora 30 giorni');
  await trash.getByRole('button', { name: 'Ripristina Cardiologia' }).click();
  await expect(trash).toContainText('Il cestino è vuoto.');
  await expect.poll(() => trashedOnDrive(drive), { timeout: 20_000 }).toBe(0);
  await syncNow(page);
  await page.getByRole('button', { name: 'Chiudi finestra' }).click();
  await expect(await openFromArchive(page, 'Cardiologia')).toContainText('Il cuore pompa il sangue nei vasi.');
  await page.getByRole('button', { name: 'Torna indietro' }).click();

  // PC: the export asks for drive.file and writes a visible folder the sync never lists.
  const panel = await openDriveSettings(page);
  await throughGoogle(page, () => panel.getByRole('button', { name: 'Esporta tutte le sbobine nel mio Drive' }).click());
  await expect(panel.getByTestId('web-drive-export-result')).toContainText('1 sbobina esportata in “El Sbobinator – esportazione');
  await expect(panel.getByRole('link', { name: 'Apri la cartella' })).toHaveAttribute('href', /drive\.google\.com/);
  expect(drive.visibleFiles().find(file => file.name === 'Cardiologia.html')?.content).toContain('Il cuore pompa il sangue nei vasi.');
  expect(drive.files().some(file => file.name.endsWith('.html'))).toBe(false);

  // "Elimina tutti i miei dati da Drive": the hidden folder empties, the sbobina stays here.
  await panel.getByRole('button', { name: 'Elimina tutti i miei dati da Drive' }).click();
  await panel.getByRole('button', { name: 'Elimina da Drive' }).click();
  await expect(panel.getByRole('radio', { name: 'Solo in questo browser' })).toBeChecked();
  expect(drive.files()).toEqual([]);
  // The export belongs to the user: it stays.
  expect(drive.visibleFiles().some(file => file.name === 'Cardiologia.html')).toBe(true);
  await page.getByRole('button', { name: 'Chiudi finestra' }).click();
  await page.getByRole('button', { name: 'Archivio', exact: true }).click();
  // Also under "Ultima sbobina aperta", since it was opened above.
  await expect(page.locator('.archive-session-card').first()).toContainText('Cardiologia');
  await ipadContext.close();
});

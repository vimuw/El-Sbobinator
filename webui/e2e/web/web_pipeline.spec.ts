import { expect, test, type Page, type Route } from '@playwright/test';
import { expectAutosaved } from '../autosave';

// The real pipeline in the static build with Gemini answered by page.route: the audio is cut and
// encoded in the worker for real (Chromium WebCodecs), only the network is fake. Not Safari or an iPad.
const DUMMY_KEY = 'AIzaSyE2EDUMMYKEY000000000000000000000';
const GEMINI = 'https://generativelanguage.googleapis.com';

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono, no padding: 417 bytes and 1152 samples per frame.
function syntheticMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0xc4]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

type GeminiLog = { generate: Array<{ key: string; audio: 'inline' | 'file' | null }>; other: string[] };

async function fakeGemini(page: Page): Promise<GeminiLog> {
  const log: GeminiLog = { generate: [], other: [] };
  const json = (route: Route, body: unknown, headers: Record<string, string> = {}) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*', ...headers }, body: JSON.stringify(body) });
  await page.route(`${GEMINI}/**`, async route => {
    const request = route.request();
    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    }
    const url = request.url();
    if (url.includes(':generateContent')) {
      const body = request.postDataJSON() as { contents: Array<{ parts: Array<{ inlineData?: unknown; fileData?: unknown }> }> };
      const parts = body.contents[0].parts;
      const audio = parts.some(part => part.inlineData) ? 'inline' : parts.some(part => part.fileData) ? 'file' : null;
      log.generate.push({ key: request.headers()['x-goog-api-key'] ?? '', audio });
      const text = audio
        ? '## Il nefrone\n\nIl nefrone è l’unità funzionale del rene: filtra il plasma nel glomerulo e riassorbe acqua e soluti lungo il tubulo.'
        : '## Il nefrone\n\nIl nefrone è l’unità funzionale del rene (testo rivisto).';
      return json(route, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
    }
    log.other.push(`${request.method()} ${url.replace(GEMINI, '')}`);
    if (url.endsWith('/upload/v1beta/files')) return json(route, {}, { 'x-goog-upload-url': `${GEMINI}/upload-session/1` });
    if (url.endsWith('/upload-session/1')) return json(route, { file: { name: 'files/e2e', uri: `${GEMINI}/v1beta/files/e2e`, mimeType: 'audio/mpeg', state: 'ACTIVE' } });
    if (request.method() === 'DELETE') return json(route, {});
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
  return log;
}

test('transcribes a file through the real pipeline and opens it in the editor @web-smoke', async ({ page }) => {
  const log = await fakeGemini(page);
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'Fisiologia renale.mp3', mimeType: 'audio/mpeg', buffer: syntheticMp3(400) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();

  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 40_000 });
  expect(log.generate.map(call => call.key)).toEqual([DUMMY_KEY, DUMMY_KEY]);
  expect(log.generate[0].audio).not.toBeNull();
  expect(log.generate[1].audio).toBeNull();

  await page.locator('.queue-card.is-completed', { hasText: 'Fisiologia renale.mp3' }).click();
  await expect(page.locator('.tiptap-editor h1')).toHaveText('Fisiologia renale');
  await expect(page.locator('.tiptap-editor')).toContainText('testo rivisto');

  // The checkpoint and the archive survive a reload.
  await page.getByRole('button', { name: 'Torna indietro' }).click();
  await page.reload();
  await expect(page.locator('.queue-card.is-completed', { hasText: 'Fisiologia renale.mp3' })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(db => db.name))).toContain('el-sbobinator-web');
});

test('reopens an edited sbobina from the archive after a reload and in a new tab', async ({ page, context }) => {
  await fakeGemini(page);
  await page.goto('/');
  await page.getByLabel('Chiave API Gemini').fill(DUMMY_KEY);
  await page.getByRole('button', { name: 'Salva e inizia' }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({ name: 'Istologia.mp3', mimeType: 'audio/mpeg', buffer: syntheticMp3(400) });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.getByText('Sbobinatura completata!')).toBeVisible({ timeout: 40_000 });

  await page.locator('.queue-card.is-completed', { hasText: 'Istologia.mp3' }).click();
  const editor = page.locator('.tiptap-editor');
  await expect(editor.locator('h1')).toHaveText('Istologia');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Nota aggiunta nel browser.');
  await expectAutosaved(page);

  const reopen = async (target: Page) => {
    await target.getByRole('button', { name: 'Archivio', exact: true }).click();
    await target.locator('.archive-session-card').filter({ has: target.getByRole('button', { name: 'Seleziona Istologia' }) }).click();
    await expect(target.locator('.tiptap-editor')).toContainText('Nota aggiunta nel browser.');
  };
  await page.reload();
  await reopen(page);

  // Closing the tab and opening the site again keeps the archive (same browser profile).
  await page.close();
  const again = await context.newPage();
  await again.goto('/');
  await reopen(again);
});

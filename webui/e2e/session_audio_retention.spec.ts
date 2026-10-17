import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

// The desktop media CSP permits the numeric loopback host; keep the configured port.
test.use({
  baseURL: async ({ baseURL }, provide) => {
    const url = new URL(baseURL!);
    url.hostname = '127.0.0.1';
    await provide(url.origin);
  },
});

test('retains playable audio after moving the original and removes only the internal copy', async ({ page }, testInfo) => {
  // Deterministic transcription; audio retention and FFmpeg playback are real.
  const audioFixture = testInfo.outputPath('Lezione.wav');
  const wav = Buffer.alloc(44 + 64000);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(64000, 40);
  fs.writeFileSync(audioFixture, wav);

  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audioFixture);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'Lezione.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  const archive = await page.evaluate(async () => window.pywebview!.api.get_completed_sessions!(0));
  expect(archive.ok).toBe(true);
  // Other specs on the same server can leave newer sessions; the simulated run keeps a fixed old date.
  const session = archive.sessions!.find(item => item.input_name?.endsWith('Lezione.wav'));
  expect(session).toBeTruthy();
  const sessionDir = session!.session_dir;
  const metadataPath = path.join(sessionDir, 'session.json');
  const before = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const original = before.input.path as string;
  // Mutate only the observed file in this test runner's isolated upload folder.
  expect(path.basename(path.dirname(original))).toBe('_browser_uploads');
  expect(fs.existsSync(original)).toBe(true);

  await completed.getByRole('heading').click();
  const player = page.locator('.editor-fullpage-footer audio');
  await expect(player).toBeAttached();
  await expect.poll(() => player.evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
  expect(await player.evaluate(el => (el as HTMLAudioElement).duration)).toBeCloseTo(2, 0);
  const retained = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  expect(path.isAbsolute(retained.playback_audio)).toBe(false);
  const internal = path.resolve(sessionDir, retained.playback_audio);
  expect(path.dirname(internal)).toBe(path.join(sessionDir, 'audio'));
  expect(fs.existsSync(internal)).toBe(true);
  expect(retained.input).toEqual(before.input);

  const moved = `${original}.moved.wav`;
  fs.renameSync(original, moved);
  await page.getByRole('button', { name: /Torna indietro|Torna alla coda/i }).click();
  await completed.getByRole('heading').click();
  await expect(player).toBeAttached();
  await expect.poll(() => player.evaluate(el => (el as HTMLAudioElement).readyState)).toBeGreaterThanOrEqual(1);
  await page.getByRole('button', { name: 'Avvia riproduzione', exact: true }).click();
  await expect.poll(() => player.evaluate(el => (el as HTMLAudioElement).currentTime)).toBeGreaterThan(0);
  await expect(page.getByText('Audio non trovato', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Opzioni audio collegato', exact: true }).click();
  await page.getByRole('button', { name: 'Rimuovi audio collegato', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: "Rimuovere l'audio collegato?" });
  await expect(dialog.getByText(/La copia audio interna verrà eliminata/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Rimuovi audio', exact: true }).click();
  await expect(page.getByText('Nessun audio collegato', { exact: true })).toBeVisible();
  expect(fs.existsSync(internal)).toBe(false);
  expect(fs.existsSync(moved)).toBe(true);
  expect(JSON.parse(fs.readFileSync(metadataPath, 'utf8')).audio_removed).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('audio-removed-original-preserved.png') });
});

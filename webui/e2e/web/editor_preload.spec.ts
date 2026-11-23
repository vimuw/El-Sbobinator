import { expect, test } from './keyedTest';
import { writeSilentWav } from '../audioFixture';

test('the first opened transcript skips the editor and player loading placeholders', async ({ page }, info) => {
  const fixture = info.outputPath('preload.mp3');
  writeSilentWav(fixture);
  const editorChunk = page.waitForRequest(/RichTextEditor/, { timeout: 10_000 }).catch(() => null);

  await page.goto('/?simulazione=rapida');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(fixture);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'preload.mp3' });
  await expect(completed).toBeVisible({ timeout: 15_000 });
  await editorChunk;
  await page.waitForLoadState('networkidle');

  // Count painted frames that still show a loading placeholder after opening.
  const loadingFrames = page.evaluate(() => new Promise<{ editor: number; player: number }>(resolve => {
    const frames = { editor: 0, player: 0 };
    const startedAt = performance.now();
    const sample = () => {
      const text = document.body.innerText;
      if (text.includes('Caricamento editor...')) frames.editor += 1;
      if (text.includes('Caricamento player...')) frames.player += 1;
      const ready = document.querySelector('.ProseMirror') && document.querySelector('[aria-label="Posizione audio"]');
      if (ready || performance.now() - startedAt > 3000) resolve(frames);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  await completed.getByRole('heading').click();

  expect(await loadingFrames).toEqual({ editor: 0, player: 0 });
  await expect(page.locator('.ProseMirror')).toBeVisible();
  await expect(page.getByLabel('Posizione audio')).toBeVisible();
});

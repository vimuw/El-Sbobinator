import fs from 'node:fs';
import { expect, test } from './keyedTest';
import type { Editor } from '@tiptap/core';
import { writeSilentWav } from '../audioFixture';
import { expectAutosaved } from '../autosave';

test('opening a full-text archive result highlights the query in the editor', async ({ page }, testInfo) => {
  await page.goto('/?simulazione=rapida');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles({
    name: 'Fisiologia.mp3',
    mimeType: 'audio/wav',
    buffer: fs.readFileSync(writeSilentWav(testInfo.outputPath('fulltext-find.mp3'))),
  });
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'Fisiologia' });
  await expect(completed).toBeVisible({ timeout: 20_000 });
  // The web sample lesson has no medical terms: give it four mentions of "cardiac".
  await completed.getByRole('heading').click();
  await page.locator('.tiptap-editor').evaluate(root => {
    (root as HTMLElement & { editor: Editor }).editor.commands.setContent('<h1>Fisiologia</h1><p>Il muscolo cardiaco si contrae.</p><p>La frequenza cardiaca aumenta.</p><p>Il ciclo cardiaco ha due fasi.</p><p>La gittata cardiaca dipende dal volume.</p>');
  });
  await expectAutosaved(page);
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
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

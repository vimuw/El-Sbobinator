import fs from 'node:fs';
import { expect, test } from './keyedTest';
import { writeSilentWav } from '../audioFixture';
import { expectAutosaved } from '../autosave';
import type { Editor } from '@tiptap/core';

test('authored paragraph and heading whitespace survives the actual preview reload', async ({ page }, testInfo) => {
  const audio = testInfo.outputPath('saved-whitespace.mp3');
  writeSilentWav(audio);
  await page.goto('/?simulazione=rapida');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'saved-whitespace.mp3' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent('<h2>Titolo</h2><p>Normale</p><p></p>');
    instance.commands.setTextSelection(1);
    instance.commands.insertContent('  Inizio\t');
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
    instance.commands.insertContent(' Spazio  interno\tfinale ');
  });
  const read = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const original = await read();
  const cssom = await page.evaluate(() => {
    const paragraph = new DOMParser().parseFromString('<p style="white-space:pre-wrap"> text </p>', 'text/html').body.firstElementChild as HTMLElement;
    return { properties: Array.from(paragraph.style), whiteSpace: paragraph.style.whiteSpace };
  });
  fs.writeFileSync(testInfo.outputPath('whitespace-cssom.json'), JSON.stringify(cssom));
  await testInfo.attach('white-space-cssom', { body: JSON.stringify(cssom), contentType: 'application/json' });
  await expectAutosaved(page);
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  const reopened = await read();
  await testInfo.attach('whitespace-models', { body: JSON.stringify({ original, reopened }), contentType: 'application/json' });
  expect(reopened).toEqual(original);
});

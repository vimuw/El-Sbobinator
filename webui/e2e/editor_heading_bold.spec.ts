import fs from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { expectAutosaved } from './autosave';
import type { Editor } from '@tiptap/core';

type EditorElement = HTMLElement & { editor: Editor };

async function readClipboardFormats(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.id = 'clipboard-format-probe';
    input.addEventListener('paste', event => {
      event.preventDefault();
      input.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
    }, { once: true });
    document.body.appendChild(input);
    input.focus();
  });
  await page.keyboard.press('Control+v');
  const formats = JSON.parse(await page.locator('#clipboard-format-probe').inputValue());
  await page.locator('#clipboard-format-probe').evaluate(input => input.remove());
  return formats;
}

test('Ctrl+B follows the visible heading weight through save, reopen and copy', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('heading-bold.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'heading-bold.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const bold = page.locator('.editor-toolbar').getByTitle('Grassetto (Ctrl+B)');
  const weight = (text: string) => editor.evaluate((root, text) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.textContent === text) return getComputedStyle(node.parentElement!).fontWeight;
    return null;
  }, text);
  // ProseMirror re-syncs the DOM selection 20 ms after focus; let it settle
  // before the shortcut so Ctrl+B acts on the selection set here.
  const select = (from: number, to: number) => editor.evaluate((root, [from, to]) => new Promise(resolve => {
    root.focus();
    setTimeout(() => { (root as EditorElement).editor.commands.setTextSelection({ from, to }); resolve(null); }, 20);
  }), [from, to]);

  await editor.evaluate(root => { (root as EditorElement).editor.commands.setContent('<h2>Titolo prova</h2><p>Testo</p>'); });
  await select(4, 4);
  await expect(bold).toHaveClass(/is-active/);
  await select(1, 7);
  await page.keyboard.press('Control+b');
  await expect.poll(() => weight('Titolo')).toBe('400');
  expect(await weight(' prova')).toBe('700');
  await expect(bold).not.toHaveClass(/is-active/);
  const edited = await editor.evaluate(root => (root as EditorElement).editor.getJSON());
  expect(JSON.stringify(edited)).not.toContain('"bold"');

  await expectAutosaved(page);
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  await expect.poll(() => weight('Titolo')).toBe('400');
  expect(await editor.evaluate(root => (root as EditorElement).editor.getJSON())).toEqual(edited);

  await select(1, 13);
  await page.keyboard.press('Control+c');
  const formats = await readClipboardFormats(page);
  expect(formats['text/html']).toContain('font-weight: 400');
  await editor.evaluate(root => { const instance = (root as EditorElement).editor; instance.commands.setContent('<p></p>'); });
  await select(1, 1);
  await page.keyboard.press('Control+v');
  await expect.poll(() => weight('Titolo')).toBe('400');
  expect(await weight(' prova')).toBe('700');

  await select(1, 13);
  await page.keyboard.press('Control+b');
  await expect.poll(() => weight('Titolo')).toBe('700');
  expect(await weight(' prova')).toBe('700');
  await expect(bold).toHaveClass(/is-active/);
});

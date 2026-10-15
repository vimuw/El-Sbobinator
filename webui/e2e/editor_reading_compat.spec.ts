import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

type EditorRoot = HTMLElement & { editor: Editor };

async function setContent(page: Page, html: string) {
  await page.evaluate(value => (document.querySelector('.tiptap-editor') as EditorRoot).editor.commands.setContent(value), html);
}

async function ink(page: Page, label: string) {
  return page.locator('.tiptap-editor').evaluate((root, label) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) if (walker.currentNode.textContent?.includes(label)) return getComputedStyle(walker.currentNode.parentElement!).color;
    throw new Error(`Missing text: ${label}`);
  }, label);
}

test.beforeEach(async ({ context, page }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = info.outputPath('reading.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.locator('.queue-card.is-completed').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
});

test('reading colors and highlight contrast change only the view, across themes and saved sessions', async ({ page }, info) => {
  await setContent(page, '<h2 style="color:#000000">Titolo nero</h2><p><span style="color:black"><strong>Nero esplicito</strong></span> <span style="color:rgb(18, 58, 188)">Blu esplicito</span> <mark style="background-color:rgb(254, 240, 138)">Giallo automatico</mark> <span style="color:rgb(18, 58, 188)"><mark style="background-color:rgb(254, 240, 138)">Giallo blu</mark></span> <mark style="background-color:rgb(17, 34, 51)">Sfondo scuro</mark></p>');
  const snapshot = () => page.evaluate(() => {
    const e = (document.querySelector('.tiptap-editor') as EditorRoot).editor;
    return { model: e.getJSON(), saved: e.getHTML() };
  });
  const original = await snapshot();
  let clipboard = '';
  for (const theme of ['light', 'dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await expect.poll(() => ink(page, 'Nero esplicito')).toBe(theme === 'dark' ? 'rgb(241, 241, 239)' : 'rgb(0, 0, 0)');
    expect(await ink(page, 'Titolo nero')).toBe(theme === 'dark' ? 'rgb(241, 241, 239)' : 'rgb(0, 0, 0)');
    expect(await ink(page, 'Blu esplicito')).toBe('rgb(18, 58, 188)');
    expect(await ink(page, 'Giallo automatico')).toBe('rgb(0, 0, 0)');
    expect(await ink(page, 'Giallo blu')).toBe('rgb(18, 58, 188)');
    expect(await ink(page, 'Sfondo scuro')).toBe('rgb(255, 255, 255)');
    expect(await snapshot()).toEqual(original);
    await page.locator('.tiptap-editor').focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const html = await page.evaluate(async () => {
      const item = (await navigator.clipboard.read()).find(item => item.types.includes('text/html'))!;
      return (await item.getType('text/html')).text();
    });
    if (clipboard) expect(html).toBe(clipboard);
    clipboard = html;
    expect(html).not.toContain('editor-reading');
    expect(html).toContain('rgb(0, 0, 0)');
    await page.screenshot({ path: info.outputPath(`reading-${theme}.png`) });
  }
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
  await expect.poll(snapshot).toEqual(original);
});

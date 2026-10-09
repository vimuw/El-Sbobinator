import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('Docs script shortcuts, buttons, clipboard geometry and saved reopen', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audio = testInfo.outputPath('apice-pedice.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'apice-pedice.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent('<p>x</p><p>H2O</p><p><strong><span style="font-size:18pt">a</span></strong></p>');
    instance.commands.setTextSelection(2);
  });
  await editor.focus();
  await page.keyboard.press('Control+.');
  const cursorMetrics = () => editor.evaluate(root => {
    const caret = root.querySelector<HTMLElement>('.editor-script-caret')!;
    const rect = caret.getBoundingClientRect();
    const normal = document.createRange();
    const walker = document.createTreeWalker(caret.closest('p')!, NodeFilter.SHOW_TEXT);
    normal.selectNodeContents(walker.nextNode()!);
    const baseline = normal.getBoundingClientRect();
    return { x: rect.x, y: rect.y, height: rect.height, normalY: baseline.y, normalHeight: baseline.height, normalRight: baseline.right, cssCaret: getComputedStyle(root).caretColor };
  });
  const apice = await cursorMetrics();
  expect(apice.y).toBeLessThan(apice.normalY);
  expect(apice.height).toBeLessThan(apice.normalHeight);
  expect(Math.abs(apice.x - apice.normalRight)).toBeLessThan(1);
  expect(apice.cssCaret).toBe('rgba(0, 0, 0, 0)');
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.doc.textContent)).toBe('xH2Oa');
  expect(await editor.locator('.editor-script-caret').evaluate(caret => getComputedStyle(caret, '::after').animationName)).toBe('none');
  await page.screenshot({ path: testInfo.outputPath('caret-apice.png'), clip: { x: 300, y: 52, width: 520, height: 230 } });
  await page.keyboard.press('Control+,');
  await expect(page.getByRole('button', { name: 'Apice (Ctrl+.)', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Pedice (Ctrl+,)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const pedice = await cursorMetrics();
  expect(pedice.y).toBeGreaterThan(pedice.normalY);
  expect(pedice.height).toBeLessThan(pedice.normalHeight);
  expect(Math.abs(pedice.x - apice.x)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('caret-pedice.png'), clip: { x: 300, y: 52, width: 520, height: 230 } });
  await page.keyboard.press('Control+.');
  await page.keyboard.type('2');
  await expect(editor.locator('sup')).toHaveText('2');
  await page.keyboard.press('ArrowLeft');
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.from)).toBe(2);
  await page.keyboard.press('ArrowRight');
  expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.from)).toBe(3);
  await page.keyboard.press('Control+.');
  const normale = await cursorMetrics();
  expect(Math.abs(normale.y - normale.normalY)).toBeLessThan(1);
  expect(Math.abs(normale.height - normale.normalHeight)).toBeLessThan(1);
  await page.screenshot({ path: testInfo.outputPath('caret-normale.png'), clip: { x: 300, y: 52, width: 520, height: 230 } });
  await page.keyboard.type(' fine');
  expect(await editor.locator('sup').count()).toBe(1);
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => {
      if (node.text === 'H2O') instance.commands.setTextSelection({ from: pos + 1, to: pos + 2 });
    });
  });
  await page.keyboard.press('Control+,');
  await expect(editor.locator('sub')).toHaveText('2');
  await expect(page.getByRole('button', { name: 'Pedice (Ctrl+,)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Apice (Ctrl+.)', exact: true }).click();
  expect(await editor.locator('sub').count()).toBe(0);
  await page.getByRole('button', { name: 'Annulla (Ctrl+Z)', exact: true }).click();
  await expect(editor.locator('sub')).toHaveText('2');
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => {
      if (node.text === 'a') instance.commands.setTextSelection(pos + 1);
    });
  });
  await editor.focus();
  await page.keyboard.press('Control+.');
  const grande = await cursorMetrics();
  expect(grande.y).toBeLessThan(grande.normalY);
  expect(grande.height).toBeLessThan(grande.normalHeight);
  expect(grande.height).toBeGreaterThan(apice.height);
  await page.keyboard.type('3');
  await page.keyboard.press('Control+.');
  await page.keyboard.type('b');
  const read = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const original = await read();
  const geometry = () => editor.evaluate(root => Array.from(root.querySelectorAll<HTMLElement>('sup,sub')).map(script => {
    const range = document.createRange();
    range.selectNodeContents(script);
    const shifted = range.getBoundingClientRect();
    const normal = document.createRange();
    const walker = document.createTreeWalker(script.closest('p')!, NodeFilter.SHOW_TEXT);
    normal.selectNodeContents(walker.nextNode()!);
    const baseline = normal.getBoundingClientRect();
    return { tag: script.tagName, height: shifted.height, normalHeight: baseline.height, y: shifted.y, normalY: baseline.y };
  }));
  const verifyGeometry = (values: Awaited<ReturnType<typeof geometry>>) => {
    expect(values).toHaveLength(3);
    for (const value of values) {
      expect(value.height).toBeLessThan(value.normalHeight);
      if (value.tag === 'SUP') expect(value.y).toBeLessThan(value.normalY);
      else expect(value.y).toBeGreaterThan(value.normalY);
    }
  };
  verifyGeometry(await geometry());
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await items[0].getType('text/html')).text();
  });
  expect(html).toMatch(/<sup\b/);
  expect(html).toMatch(/<sub\b/);
  // Force HTML-only paste so this also exercises the portable fallback.
  await page.evaluate(async html => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
  }, html);
  await editor.focus();
  await page.keyboard.press('Control+v');
  verifyGeometry(await geometry());
  const pasted = await read();
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  expect(await read()).toEqual(pasted);
  verifyGeometry(await geometry());
  const reopened = await read();
  const reopenedGeometry = await geometry();
  // Empty paragraphs and moving back into ordinary text must also show the
  // correct mode without leaving a second caret or changing document text.
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.setContent('<p></p><p>Normale</p>');
    instance.commands.setTextSelection(1);
  });
  await editor.focus();
  await page.keyboard.press('Control+,');
  await expect(editor.locator('.editor-script-caret')).toHaveCount(1);
  expect(await editor.locator('.editor-script-caret').evaluate(caret => Boolean(caret.closest('sub')))).toBe(true);
  await page.keyboard.type('i');
  await expect(editor.locator('sub')).toHaveText('i');
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => { if (node.text === 'Normale') instance.commands.setTextSelection(pos + 3); });
  });
  await expect(editor.locator('.editor-script-caret')).toHaveCount(0);
  expect(await editor.evaluate(root => getComputedStyle(root).caretColor)).not.toBe('rgba(0, 0, 0, 0)');
  await testInfo.attach('scripts-models', { body: JSON.stringify({ original, pasted, reopened, geometry: reopenedGeometry, caret: { apice, pedice, normale, grande } }), contentType: 'application/json' });
});

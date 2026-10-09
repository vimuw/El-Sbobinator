import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function openEditor(page: Page, info: TestInfo) {
  const audio = info.outputPath('reported_bugs.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  await expect(page.locator('.queue-card.is-completed').first()).toBeVisible({ timeout: 15000 });
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
}

async function paste(page: Page, html: string) {
  await page.evaluate(async value => navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]), html);
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
}

test.beforeEach(async ({ context, page }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openEditor(page, info);
});

test('repeated list Tab retains editor focus while the audio bar is present', async ({ page }) => {
  await paste(page, '<ol><li><p>Prima</p></li><li><p>Seconda</p></li></ol>');
  const editor = page.locator('.tiptap-editor');
  await expect(page.locator('audio')).toHaveCount(1);
  for (const label of ['Prima', 'Seconda']) {
    await editor.evaluate((root, label) => {
      const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === label) instance.commands.setTextSelection(pos); });
    }, label);
    await editor.focus();
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); await expect(editor).toBeFocused(); }
  }
  await page.keyboard.press('Shift+Tab'); await expect(editor).toBeFocused();
});

test('generated block gaps survive save and copy without spreading to new paragraphs or list items', async ({ page }, info) => {
  const generated = execFileSync('python', ['-c', "from el_sbobinator.utils.html_export import build_html_document; print(build_html_document('Lezione', 'Prima\\n\\nSeconda\\n\\n- Uno\\n- Due\\n\\nDopo elenco'))"], { cwd: '..', encoding: 'utf8' });
  await paste(page, generated);
  const editor = page.locator('.tiptap-editor');
  const read = () => editor.locator('p').evaluateAll(paragraphs => paragraphs.map(p => ({ text: p.textContent, top: p.getBoundingClientRect().top, height: p.getBoundingClientRect().height, before: getComputedStyle(p).marginTop, after: getComputedStyle(p).marginBottom })));
  const initial = await read();
  expect(initial.map(p => p.before)).toEqual(['0px', '20.24px', '20.24px', '0px', '20.24px']);
  expect(initial.every(p => p.after === '0px')).toBe(true);
  await expect(editor.locator('p:empty')).toHaveCount(0);
  const moveToEnd = async (label: string) => {
    await editor.evaluate((root, label) => {
      const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === label) instance.commands.setTextSelection(pos + node.nodeSize); });
    }, label);
    await editor.focus();
  };
  await moveToEnd('Seconda'); await page.keyboard.press('Enter'); await page.keyboard.type('Nuova');
  let geometry = await read();
  expect(geometry[2].text).toBe('Nuova'); expect(geometry[2].before).toBe('0px');
  expect(Math.abs(geometry[2].top - geometry[1].top - geometry[1].height)).toBeLessThan(1);
  await moveToEnd('Uno'); await page.keyboard.press('Enter'); await page.keyboard.type('Inserita');
  geometry = await read();
  expect(geometry.map(p => p.text)).toEqual(['Prima', 'Seconda', 'Nuova', 'Uno', 'Inserita', 'Due', 'Dopo elenco']);
  expect(geometry[4].before).toBe('0px');
  expect(Math.abs(geometry[4].top - geometry[3].top - geometry[3].height)).toBeLessThan(1);
  await moveToEnd('Dopo elenco'); await page.keyboard.press('Enter'); await page.keyboard.type('Fine');
  const final = await read(); expect(final.at(-1)?.before).toBe('0px');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const clipboard = await page.evaluate(async () => {
    const items = await navigator.clipboard.read(); const item = items.find(item => item.types.includes('text/html'))!;
    return await (await item.getType('text/html')).text();
  });
  expect((clipboard.match(/data-generated-space-before=/g) ?? []).length).toBe(3);
  fs.mkdirSync('../_smoke/paragraph-enter', { recursive: true });
  fs.writeFileSync('../_smoke/paragraph-enter/generated-edited-clipboard.html', clipboard);
  await page.evaluate(() => {
    const probe = document.createElement('textarea'); probe.id = 'generated-clipboard';
    probe.addEventListener('paste', event => { event.preventDefault(); probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)]))); }, { once: true });
    document.body.appendChild(probe); probe.focus();
  });
  await page.keyboard.press('Control+v');
  fs.writeFileSync('../_smoke/paragraph-enter/generated-edited-clipboard.json', await page.locator('#generated-clipboard').inputValue());
  await page.locator('#generated-clipboard').evaluate(probe => probe.remove());
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect.poll(read).toEqual(final);
  await page.screenshot({ path: info.outputPath('generated-spacing.png') });
});

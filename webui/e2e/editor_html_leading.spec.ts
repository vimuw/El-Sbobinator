import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('HTML fallback restores CSS leading, fonts, selections, history and saved content', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('html-leading.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'html-leading.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const source = '<h2>Titolo</h2><p>Normale<br>Seconda riga</p>' +
    '<p style="font-family:Arial;font-size:11pt;line-height:1.6">Arial<br>Seconda riga</p>' +
    '<p style="font-family:Georgia;font-size:18pt;line-height:1.8;font-style:italic">Georgia<br>Seconda riga</p>' +
    '<p style="font-family:Times New Roman;font-size:14pt;line-height:22pt">Times<br>Seconda riga</p>' +
    '<p style="font-family:Courier New;font-size:10pt;line-height:normal">Courier<br>Seconda riga</p>' +
    '<ol start="4"><li><p>Madre</p><ol type="a"><li><p style="line-height:1.6">Figlia</p></li></ol></li></ol>' +
    '<p></p><table><tr><td><p style="line-height:1.8">Cella<br>Seconda riga</p></td><td><p style="font-size:14pt">Esplicita</p></td><th><p>Testata <span style="font-size:150%">Grande</span></p></th></tr></table>' +
    '<div data-math-block="\\begin{pmatrix}a&amp;b\\end{pmatrix}">formula</div><p>Fine</p>';
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, source);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByText('Georgia', { exact: false })).toBeVisible();
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const read = () => editor.evaluate(root => ({
    html: (root as HTMLElement & { editor: Editor }).editor.getHTML(),
    blocks: Array.from(root.querySelectorAll('h2,p')).map(el => {
      const css = getComputedStyle(el);
      return { text: el.textContent, leading: css.lineHeight, font: css.fontFamily.split(',')[0].replaceAll('"', '').trim(), size: css.fontSize, height: el.getBoundingClientRect().height };
    }),
  }));
  const original = await read();
  const emptySeparator = () => editor.evaluate(root => {
    const body = new DOMParser().parseFromString((root as HTMLElement & { editor: Editor }).editor.getHTML(), 'text/html').body;
    const paragraph = body.querySelector('body > ol')?.nextElementSibling;
    return { tag: paragraph?.tagName, empty: paragraph?.childNodes.length === 0, next: paragraph?.nextElementSibling?.tagName };
  });
  expect(await emptySeparator()).toEqual({ tag: 'P', empty: true, next: 'TABLE' });
  const inputs = await page.evaluate(async html => {
    const formatting = await import('/src/utils.ts' /* @vite-ignore */);
    const clipboard = await import('/src/editorClipboard.ts' /* @vite-ignore */);
    const spacing = await import('/src/editorLineSpacing.ts' /* @vite-ignore */);
    const portable = formatting.prepareHtmlForClipboardSync(html);
    const parsed = new DOMParser().parseFromString(portable, 'text/html').body;
    const measure = spacing.nativeLineSpacingReader();
    parsed.querySelector('[data-math-block]')?.remove();
    const native = clipboard.createNativeClipboardFormats(parsed.innerHTML)!;
    const model = JSON.parse(JSON.parse(native['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    return { portable, expected: Array.from(parsed.querySelectorAll('h2,p')).map(el => ({ text: el.textContent, native: measure(el as HTMLElement) })),
      nativeLeading: model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean).map((style: { ps_ls: number }) => style.ps_ls) };
  }, original.html);
  // The portable and clipboard paths must both retain table typography.
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, inputs.portable);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const control = await read();
  // Unstyled cell paragraphs inherit the table's leading, including an
  // explicit paragraph font or a relative inline font in the header.
  for (const text of ['CellaSeconda riga', 'Esplicita', 'Testata Grande']) {
    const before = original.blocks.find(block => block.text === text)!;
    const after = control.blocks.find(block => block.text === text)!;
    expect({ ...after, leading: before.leading }).toEqual(before);
    // Browser CSS serialization rounds the unitless table value to 1.71429.
    expect(parseFloat(after.leading)).toBeCloseTo(parseFloat(before.leading), 3);
  }
  await page.keyboard.press('Control+z');
  expect((await read()).html).toBe(original.html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await page.evaluate(async () => Object.fromEntries(await Promise.all((await navigator.clipboard.read()).flatMap(item => item.types.map(async type => [type, await (await item.getType(type)).text()])))));
  expect(copied['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
  expect(copied['text/html']).toContain('data-editor-css-line-height');
  expect(copied['text/html']).toContain('data-editor-empty-paragraph="true"');
  const leading = await page.evaluate(html => Array.from(new DOMParser().parseFromString(html, 'text/html').querySelectorAll<HTMLElement>('h2,p,div[data-editor-empty-paragraph="true"]')).map(el => ({ text: el.textContent, native: Number(el.style.lineHeight) })), copied['text/html']);
  leading.forEach((block, index) => expect(block.native).toBeCloseTo(inputs.expected[index].native, 4));
  expect(inputs.nativeLeading).toEqual(inputs.expected.map(block => block.native));
  await page.keyboard.press('Control+x');
  await page.keyboard.press('Control+z');
  expect((await read()).html).toBe(original.html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const pasted = await read();
  expect(await emptySeparator()).toEqual({ tag: 'P', empty: true, next: 'TABLE' });
  expect(pasted.blocks.find(block => block.text?.startsWith('Cella'))).toEqual(original.blocks.find(block => block.text?.startsWith('Cella')));
  expect(pasted.blocks).toEqual(control.blocks);
  expect(pasted.html).not.toContain('data-editor-css-line-height');
  expect(pasted.html).not.toContain('data-editor-empty-paragraph');
  expect(pasted.html).not.toContain('calc(');
  await page.keyboard.press('Control+z'); expect((await read()).html).toBe(original.html);
  await page.keyboard.press('Control+Shift+z'); expect((await read()).html).toBe(pasted.html);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  await expect(editor).toBeVisible();
  const reopened = await read();
  expect(await emptySeparator()).toEqual({ tag: 'P', empty: true, next: 'TABLE' });
  expect(reopened.blocks).toEqual(pasted.blocks);
  expect(reopened.html).not.toContain('data-editor-css-line-height');
  expect(reopened.html).not.toContain('data-editor-empty-paragraph');
  await expect(editor.locator('ol ol')).toHaveCount(1);
  await expect(editor.locator('table td')).toHaveCount(2);
  // An inline selection keeps only character formatting and introduces no block.
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.focus();
    instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Georgia') instance.commands.setTextSelection({ from: pos, to: pos + 3 }); });
  });
  await expect.poll(() => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    return instance.state.doc.textBetween(instance.state.selection.from, instance.state.selection.to);
  })).toBe('Geo');
  await page.keyboard.press('Control+c');
  const partial = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text());
  expect(partial).not.toContain('data-editor-css-line-height');
  expect(partial).not.toMatch(/<p[ >]/);
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.focus();
    instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Cella') instance.commands.setTextSelection({ from: pos, to: pos + 5 }); });
  });
  await page.keyboard.press('Control+c');
  // The async Clipboard API omits Chromium's custom native formats. Observe
  // the trusted paste event, as in the existing native clipboard corpus.
  await page.evaluate(() => {
    const probe = document.createElement('textarea');
    probe.id = 'table-font-clipboard-probe';
    probe.addEventListener('paste', event => {
      event.preventDefault();
      probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
    }, { once: true });
    document.body.appendChild(probe); probe.focus();
  });
  await page.keyboard.press('Control+v');
  const cellCopy = JSON.parse(await page.locator('#table-font-clipboard-probe').inputValue());
  await page.locator('#table-font-clipboard-probe').evaluate(probe => probe.remove());
  const cellNative = JSON.parse(JSON.parse(cellCopy['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(cellNative.dsl_spacers).toBe('Cella');
  expect(cellNative.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles[0].ts_fs).toBe(9.625);
  expect(cellCopy['text/html']).not.toMatch(/<(p|table)[ >]/);
  const cellFont = await page.evaluate(html => new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>('span')?.style.fontSize, cellCopy['text/html']);
  expect(cellFont).toBe('9.625pt');
  await editor.focus();
  await editor.evaluate(root => { const instance = (root as HTMLElement & { editor: Editor }).editor; instance.commands.setTextSelection(instance.state.doc.content.size - 1); });
  await page.keyboard.press('Control+v');
  const wordPaste = await editor.locator('p').last().evaluate(el => ({ text: el.textContent, size: getComputedStyle(el.querySelector('span')!).fontSize }));
  expect(wordPaste).toEqual({ text: 'FineCella', size: '12.8333px' });
  await page.keyboard.press('Control+z');
  expect((await read()).html).toBe(reopened.html);
  // Omitting the table shell must carry inherited leading as well as font.
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.commands.focus();
    instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Esplicita') instance.commands.setTextSelection({ from: pos, to: pos + node.nodeSize }); });
  });
  await page.keyboard.press('Control+c');
  const inheritedWord = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text());
  expect(inheritedWord).not.toMatch(/<(p|table)[ >]/);
  expect(await page.evaluate(html => {
    const span = new DOMParser().parseFromString(html, 'text/html').querySelector<HTMLElement>('span')!;
    return { text: span.textContent, size: span.style.fontSize, leading: Number(span.style.lineHeight) };
  }, inheritedWord)).toEqual({ text: 'Esplicita', size: '14pt', leading: 1.71429 });
  expect((await read()).html).toBe(reopened.html);
  fs.writeFileSync(testInfo.outputPath('table-inherited-word-clipboard.html'), inheritedWord);
  fs.writeFileSync(testInfo.outputPath('table-word-clipboard.json'), JSON.stringify(cellCopy));
  fs.writeFileSync(testInfo.outputPath('html-leading-readback.json'), JSON.stringify({ original, control, pasted, reopened, expected: inputs.expected, partial, cellFont, wordPaste }, null, 2));
  fs.writeFileSync(testInfo.outputPath('html-leading-clipboard.json'), JSON.stringify(copied));
  fs.writeFileSync(testInfo.outputPath('html-leading-portable.json'), JSON.stringify({ 'text/html': inputs.portable }));
  await page.screenshot({ path: testInfo.outputPath('html-leading-app.png') });
});

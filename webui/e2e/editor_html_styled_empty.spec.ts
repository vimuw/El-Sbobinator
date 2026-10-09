import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('styled empty paragraphs retain separate typography and typing marks through fallback and reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('html-styled-empty.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'html-styled-empty.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const imageSource = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const fixture = fs.readFileSync(new URL('./fixtures/editor-parity-mixed.html', import.meta.url), 'utf8');
  const source = fixture.replace('__IMAGE_SOURCE__', imageSource).replace('<table>', '<p style="font-family:Georgia;font-size:18pt;line-height:1.6;margin-top:8pt" data-editor-empty-marks="[{&quot;type&quot;:&quot;bold&quot;}]"></p><p style="font-family:Courier New;font-size:10pt;line-height:1.8;margin-bottom:10pt" data-editor-empty-marks="[{&quot;type&quot;:&quot;italic&quot;}]"></p><table>') +
    '<div data-math-block="\\begin{pmatrix}a&amp;b\\\\c&amp;d\\end{pmatrix}">formula</div><p>Dopo la matrice.</p>';
  await page.evaluate(async html => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
  }, source);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const blocks: { type: string; text: string; position: number; size: number }[] = [];
    instance.state.doc.forEach((node, pos) => blocks.push({ type: node.type.name, text: node.textContent, position: pos + 1, size: node.content.size }));
    const html = instance.getHTML();
    const emptyMarks: unknown[] = [];
    const typedMarks: { text: string; marks: unknown[] }[] = [];
    instance.state.doc.descendants(node => {
      if (node.isTextblock && !node.content.size) emptyMarks.push(node.attrs.emptyTextMarks);
      if (node.isText && node.text?.startsWith('Vuoto ')) typedMarks.push({ text: node.text, marks: node.marks.map(mark => mark.toJSON()) });
    });
    const emptyStyles = Array.from(root.children).filter(el => el.tagName === 'P' && !el.textContent).map(el => {
      const css = getComputedStyle(el);
      return { font: css.fontFamily.split(',')[0].replaceAll('"', '').trim(), size: css.fontSize, bold: Number(css.fontWeight) >= 600, italic: css.fontStyle, leading: css.lineHeight, top: css.marginTop, bottom: css.marginBottom, height: el.getBoundingClientRect().height };
    });
    return { html, text: instance.getText(), blocks, empty: blocks.filter(b => b.type === 'paragraph' && b.size === 0), emptyStyles, emptyMarks, typedMarks };
  });
  const original = await read();
  expect(original.empty).toHaveLength(2);
  expect(original.emptyMarks).toEqual([[{ type: 'bold' }], [{ type: 'italic' }]]);
  const capture = async (route: 'native' | 'fallback' | 'button') => {
    if (route === 'button') await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    else {
      await editor.focus();
      if (route === 'fallback') await page.keyboard.press('Control+a');
      else await editor.evaluate(root => {
        const instance = (root as HTMLElement & { editor: Editor }).editor;
        instance.state.doc.forEach((node, pos) => {
          if (node.type.name === 'mathBlock') instance.commands.setTextSelection({ from: 1, to: pos - 1 });
        });
      });
      await page.keyboard.press('Control+c');
    }
    await page.evaluate(() => {
      const probe = document.createElement('textarea'); probe.id = 'html-empty-probe';
      probe.addEventListener('paste', event => {
        event.preventDefault();
        probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
      }, { once: true });
      document.body.appendChild(probe); probe.focus();
    });
    await page.keyboard.press('Control+v');
    const result: Record<string, string> = JSON.parse(await page.locator('#html-empty-probe').inputValue());
    await page.locator('#html-empty-probe').evaluate(probe => probe.remove());
    return result;
  };
  const native = await capture('native');
  expect(native['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeTruthy();
  fs.writeFileSync(testInfo.outputPath('styled-empty-native-clipboard.json'), JSON.stringify(native));
  const fallback = await capture('fallback');
  const button = await capture('button');
  fs.writeFileSync(testInfo.outputPath('empty-fallback-clipboard.json'), JSON.stringify(fallback));
  fs.writeFileSync(testInfo.outputPath('empty-button-clipboard.json'), JSON.stringify(button));
  for (const formats of [fallback, button]) {
    expect(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
    const separators = await page.evaluate(html => {
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      return Array.from(body.querySelectorAll('[data-editor-empty-paragraph="true"]')).map(el => ({ text: el.textContent, html: el.innerHTML }));
    }, formats['text/html']);
    expect(separators).toEqual([{ text: '', html: '<br>' }, { text: '', html: '<br>' }]);
  }
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const pasted = await read();
  expect(pasted.empty).toEqual(original.empty);
  expect(pasted.emptyStyles).toEqual(original.emptyStyles);
  expect(pasted.emptyMarks).toEqual(original.emptyMarks);
  expect(pasted.text).toBe(original.text);
  expect(pasted.html).not.toContain('data-editor-empty-paragraph');
  await page.keyboard.press('Control+z'); expect((await read()).html).toBe(original.html);
  await page.keyboard.press('Control+Shift+z'); expect((await read()).html).toBe(pasted.html);
  // Each separator is a real editable paragraph with an independent position.
  for (const [index, paragraph] of pasted.empty.entries()) {
    await editor.evaluate((root, pos) => (root as HTMLElement & { editor: Editor }).editor.commands.setTextSelection(pos), paragraph.position);
    await editor.focus(); await page.keyboard.type(`Vuoto ${index + 1}`);
    const edited = await read();
    expect(edited.blocks.find(b => b.position === paragraph.position)?.text).toBe(`Vuoto ${index + 1}`);
    expect(edited.empty).toHaveLength(1);
    expect(edited.typedMarks[0].marks).toContainEqual({ type: index === 0 ? 'bold' : 'italic' });
    const typedStyle = await editor.getByText(`Vuoto ${index + 1}`, { exact: true }).evaluate(el => {
      const css = getComputedStyle(el);
      return { font: css.fontFamily.split(',')[0].replaceAll('"', '').trim(), size: css.fontSize, bold: Number(css.fontWeight) >= 600, italic: css.fontStyle };
    });
    const { font, size, bold, italic } = original.emptyStyles[index];
    expect(typedStyle).toEqual({ font, size, bold, italic });
    fs.writeFileSync(testInfo.outputPath(`styled-empty-typed-${index + 1}.json`), JSON.stringify(edited));
    await page.keyboard.press('Control+z'); expect((await read()).html).toBe(pasted.html);
    await page.keyboard.press('Control+Shift+z'); expect((await read()).text).toBe(edited.text);
    await page.keyboard.press('Control+z'); expect((await read()).html).toBe(pasted.html);
  }
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  const reopened = await read();
  expect(reopened.text).toBe(pasted.text);
  expect(reopened.blocks).toEqual(pasted.blocks);
  expect(reopened.html).not.toContain('data-editor-empty-paragraph');
  expect(reopened.empty).toEqual(original.empty);
  expect(reopened.emptyStyles).toEqual(pasted.emptyStyles);
  expect(reopened.emptyMarks).toEqual(pasted.emptyMarks);
  fs.writeFileSync(testInfo.outputPath('empty-readback.json'), JSON.stringify({ original, pasted, reopened }, null, 2));
  await page.screenshot({ path: testInfo.outputPath('empty-app.png') });
});

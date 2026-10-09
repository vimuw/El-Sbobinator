import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('mixed equation clipboard routes preserve editable source through HTML paste and reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('html-equations.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'html-equations.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const imageSource = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const fixture = fs.readFileSync(new URL('./fixtures/editor-parity-mixed.html', import.meta.url), 'utf8');
  const source = fixture.replace('__IMAGE_SOURCE__', imageSource) +
    '<p>Radice e indici: <span data-math="x_i^2+\\sqrt{y}">formula</span>.</p>' +
    '<div data-math-block="\\sum_{i=0}^{n}i">formula</div><p>Prima della matrice.</p>' +
    '<div data-math-block="\\begin{pmatrix}a&amp;b\\\\c&amp;d\\end{pmatrix}">formula</div><p>Dopo la matrice.</p>';
  await page.evaluate(async html => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
  }, source);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const equations: { type: string; latex: string }[] = [];
    instance.state.doc.descendants(node => {
      if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') equations.push({ type: node.type.name, latex: node.attrs.latex });
    });
    return { html: instance.getHTML(), text: instance.getText(), equations };
  });
  const original = await read();
  expect(original.equations).toEqual([
    { type: 'mathInline', latex: '\\frac{x^2}{y}' },
    { type: 'mathInline', latex: 'x_i^2+\\sqrt{y}' },
    { type: 'mathBlock', latex: '\\sum_{i=0}^{n}i' },
    { type: 'mathBlock', latex: '\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}' },
  ]);
  const capture = async (route: 'native' | 'fallback' | 'button') => {
    if (route === 'button') await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    else {
      await editor.focus();
      if (route === 'fallback') await page.keyboard.press('Control+a');
      else await editor.evaluate(root => {
        const instance = (root as HTMLElement & { editor: Editor }).editor;
        instance.state.doc.forEach((node, pos) => {
          if (node.type.name === 'mathBlock' && node.attrs.latex.includes('pmatrix')) instance.commands.setTextSelection({ from: 1, to: pos - 1 });
        });
      });
      await page.keyboard.press('Control+c');
    }
    await page.evaluate(() => {
      const probe = document.createElement('textarea'); probe.id = 'html-equations-probe';
      probe.addEventListener('paste', event => {
        event.preventDefault();
        probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
      }, { once: true });
      document.body.appendChild(probe); probe.focus();
    });
    await page.keyboard.press('Control+v');
    const result: Record<string, string> = JSON.parse(await page.locator('#html-equations-probe').inputValue());
    await page.locator('#html-equations-probe').evaluate(probe => probe.remove());
    return result;
  };
  const native = await capture('native');
  const wrapped = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
  expect(native[wrapped]).toBeTruthy();
  const model = JSON.parse(JSON.parse(native[wrapped]).data).resolved;
  expect(Array.from(model.dsl_spacers as string).filter(char => char.charCodeAt(0) === 26)).toHaveLength(3);
  expect(JSON.stringify(model)).toContain('\\\\frac');
  const fallback = await capture('fallback');
  const button = await capture('button');
  for (const formats of [fallback, button]) {
    expect(formats[wrapped]).toBeUndefined();
    expect(formats['text/plain']).toContain(original.equations[3].latex);
    const htmlEquations = await page.evaluate(html => {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      return { equations: Array.from(parsed.querySelectorAll('[data-math],[data-math-block]')).map(el => ({
        type: el.hasAttribute('data-math') ? 'mathInline' : 'mathBlock', latex: el.getAttribute('data-math') ?? el.getAttribute('data-math-block'),
      })), katex: parsed.querySelectorAll('.katex').length, duplicateLayer: Boolean(parsed.querySelector('.katex-mathml,annotation')), error: Boolean(parsed.querySelector('.katex-error')) };
    }, formats['text/html']);
    expect(htmlEquations).toEqual({ equations: original.equations, katex: 4, duplicateLayer: false, error: false });
  }
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const pasted = await read();
  expect(pasted.equations).toEqual(original.equations);
  expect(pasted.text).toBe(original.text);
  await page.keyboard.press('Control+z'); expect((await read()).equations).toEqual(original.equations);
  await page.keyboard.press('Control+Shift+z'); expect((await read()).equations).toEqual(pasted.equations);
  // Modify actual LaTeX inputs after re-pasting the real fallback bytes.
  await editor.locator('.math-node-wrapper .math-rendered').first().click();
  await editor.locator('.math-inline-edit input').fill('\\frac{x^2}{z}');
  await editor.locator('.math-inline-edit input').press('Enter');
  expect((await read()).equations[0].latex).toBe('\\frac{x^2}{z}');
  await editor.focus(); await page.keyboard.press('Control+z');
  expect((await read()).equations[0].latex).toBe(original.equations[0].latex);
  await page.keyboard.press('Control+Shift+z');
  await editor.locator('.math-block-wrapper .math-rendered').last().click();
  await editor.locator('.math-block-wrapper textarea').fill('\\begin{pmatrix}a&b\\\\c&e\\end{pmatrix}');
  await editor.getByRole('button', { name: 'Salva (Ctrl+Enter)', exact: true }).click();
  const edited = await read();
  expect(edited.equations[3].latex).toBe('\\begin{pmatrix}a&b\\\\c&e\\end{pmatrix}');
  await editor.focus(); await page.keyboard.press('Control+z');
  expect((await read()).equations[3].latex).toBe(original.equations[3].latex);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  const reopened = await read();
  expect(reopened.equations).toEqual(edited.equations);
  expect(reopened.text).toBe(edited.text);
  for (const [name, formats] of Object.entries({ native, fallback, button })) fs.writeFileSync(testInfo.outputPath(`equations-${name}-clipboard.json`), JSON.stringify(formats));
  fs.writeFileSync(testInfo.outputPath('equations-readback.json'), JSON.stringify({ original, pasted, edited, reopened }, null, 2));
  await page.screenshot({ path: testInfo.outputPath('equations-app.png') });
});

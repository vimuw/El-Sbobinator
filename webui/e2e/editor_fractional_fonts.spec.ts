import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

// Keep the app's precision even when a recipient rounds its HTML import.
// The unsupported matrix selects the actual fallback clipboard route.
test('fractional fonts survive clipboard routing, history and saved content', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('fractional-fonts.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'fractional-fonts.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const sizes = [9.49, 9.5, 9.51, 9.624, 9.625, 9.626, 9.749, 9.75, 9.751, 9.875, 10.001, 10.125, 14.4375, 14.5, 14.625, 18.2];
  const samples = sizes.map((size, index) => ({ label: `F${String(index).padStart(2, '0')}=${size}`, size }));
  const source = samples.map(sample => `<p style="font-family:Arial;font-size:${sample.size}pt;line-height:1.38">${sample.label}</p>`).join('') +
    '<table><tr><td><p>Cella</p></td><th><p>Testata <span style="font-size:150%">Grande</span></p></th></tr></table><p>Fine</p>' +
    '<div data-math-block="\\begin{pmatrix}a&amp;b\\end{pmatrix}">formula</div><p>Ultima</p>';
  await page.evaluate(async html => {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]);
  }, source);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const read = () => editor.evaluate(root => ({
    html: (root as HTMLElement & { editor: Editor }).editor.getHTML(),
    text: root.textContent,
    typography: Array.from(root.querySelectorAll('p, p span')).map(el => ({
      text: el.textContent, size: getComputedStyle(el).fontSize,
    })),
  }));
  const nativeSource = await read();
  const capture = async (all = true) => {
    await editor.focus();
    if (all) await page.keyboard.press('Control+a');
    else await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.forEach((node, pos) => {
        if (node.type.name === 'mathBlock') instance.commands.setTextSelection({ from: 1, to: pos - 1 });
      });
    });
    await page.keyboard.press('Control+c');
    // A trusted paste event also sees native MIME types hidden by Chromium's
    // async Clipboard API. It never changes the source document.
    await page.evaluate(() => {
      const probe = document.createElement('textarea');
      probe.id = 'fractional-fonts-probe';
      probe.addEventListener('paste', event => {
        event.preventDefault();
        probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
      }, { once: true });
      document.body.appendChild(probe); probe.focus();
    });
    await page.keyboard.press('Control+v');
    const result = JSON.parse(await page.locator('#fractional-fonts-probe').inputValue());
    await page.locator('#fractional-fonts-probe').evaluate(probe => probe.remove());
    return result;
  };
  const native = await capture(false);
  const model = JSON.parse(JSON.parse(native['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const styles = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
  const nativeSize = (label: string) => {
    const index = model.dsl_spacers.indexOf(label);
    expect(index).toBeGreaterThanOrEqual(0);
    for (let i = index; i >= 0; i--) if (styles[i]) return styles[i].ts_fs;
  };
  samples.forEach(sample => expect(nativeSize(sample.label)).toBe(sample.size));
  expect(nativeSize('Cella')).toBe(9.625);
  expect(nativeSize('Grande')).toBe(14.4375);
  const original = await read();
  const fallback = await capture();
  expect(fallback['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
  expect(fallback['text/html']).toContain('data-editor-css-line-height');
  const htmlSizes = await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(parsed.querySelectorAll<HTMLElement>('p, p span')).filter(el => el.style.fontSize).map(el => ({ text: el.textContent, size: el.style.fontSize }));
  }, fallback['text/html']);
  samples.forEach(sample => expect(htmlSizes).toContainEqual({ text: sample.label, size: `${sample.size}pt` }));
  expect(htmlSizes).toContainEqual({ text: 'Cella', size: '9.625pt' });
  expect(htmlSizes).toContainEqual({ text: 'Grande', size: '14.4375pt' });
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const pasted = await read();
  expect(pasted.text).toBe(original.text);
  // The portable parser materializes inherited styles; compare the font at
  // each labeled text node instead of counting the newly introduced spans.
  const effectiveSizes = () => editor.evaluate(root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const result: { text: string; size: string }[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.parentElement?.closest('p') && node.textContent?.trim()) result.push({ text: node.textContent, size: getComputedStyle(node.parentElement).fontSize });
    }
    return result;
  });
  const pastedSizes = await effectiveSizes();
  samples.forEach(sample => expect(parseFloat(pastedSizes.find(entry => entry.text === sample.label)!.size) * 0.75).toBeCloseTo(sample.size, 3));
  expect(parseFloat(pastedSizes.find(entry => entry.text === 'Cella')!.size) * 0.75).toBeCloseTo(9.625, 3);
  expect(parseFloat(pastedSizes.find(entry => entry.text === 'Grande')!.size) * 0.75).toBeCloseTo(14.4375, 3);
  await page.keyboard.press('Control+z'); expect((await read()).html).toBe(original.html);
  await page.keyboard.press('Control+Shift+z'); expect(await effectiveSizes()).toEqual(pastedSizes);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  expect(await effectiveSizes()).toEqual(pastedSizes);
  const reopened = await read();
  expect(reopened.html).not.toContain('data-editor-css-line-height');
  fs.writeFileSync(testInfo.outputPath('fractional-fonts-native.json'), JSON.stringify(native));
  fs.writeFileSync(testInfo.outputPath('fractional-fonts-fallback.json'), JSON.stringify(fallback));
  fs.writeFileSync(testInfo.outputPath('fractional-fonts-readback.json'), JSON.stringify({ samples, nativeSource, original, pasted, reopened, pastedSizes }, null, 2));
  await page.screenshot({ path: testInfo.outputPath('fractional-fonts-app.png') });
});

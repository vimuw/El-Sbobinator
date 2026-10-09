import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('HTML fallback preserves right caption image geometry, pixels, history and saved content', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('html-images.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'html-images.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const imageSource = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const fixture = fs.readFileSync(new URL('./fixtures/editor-parity-mixed.html', import.meta.url), 'utf8');
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const images: Record<string, unknown>[] = [];
    instance.state.doc.descendants(node => { if (node.type.name === 'floatingImage') images.push(node.attrs); });
    const img = root.querySelector<HTMLImageElement>('img.editor-image-asset')!;
    const image = img.getBoundingClientRect();
    const bounds = root.getBoundingClientRect();
    const following = Array.from(root.querySelectorAll('p')).find(p => p.textContent?.startsWith('Figura del campione:'))!.getBoundingClientRect();
    return { images, text: instance.getText(), html: instance.getHTML(), pixels: [img.naturalWidth, img.naturalHeight],
      geometry: { width: image.width, height: image.height, x: image.left - bounds.left, yFromText: image.top - following.top } };
  });
  const capture = async (button = false) => {
    if (button) await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    else { await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c'); }
    await page.evaluate(() => {
      const probe = document.createElement('textarea'); probe.id = 'html-images-probe';
      probe.addEventListener('paste', event => {
        event.preventDefault();
        probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
      }, { once: true });
      document.body.appendChild(probe); probe.focus();
    });
    await page.keyboard.press('Control+v');
    const formats = JSON.parse(await page.locator('#html-images-probe').inputValue()) as Record<string, string>;
    await page.locator('#html-images-probe').evaluate(probe => probe.remove());
    return formats;
  };
  for (const variant of [
    { name: 'intrinsic', width: 35, offsetX: 0, offsetY: 18, ratio: null },
    { name: 'explicit-ratio', width: 42, offsetX: -12, offsetY: 18, ratio: 2 },
  ]) {
    const source = fixture.replace(/<p>Figura del campione:.*?<\/p>/,
      `<div data-editor-image="true" data-layout="wrap" data-align="right" data-position="100" data-offset-x="${variant.offsetX}" data-offset-y="${variant.offsetY}" data-width="${variant.width}" ${variant.ratio ? `data-aspect-ratio="${variant.ratio}"` : ''} data-caption="Figura 1: campione sintetico"><img src="__IMAGE_SOURCE__" alt="Campione sintetico"></div><p>Figura del campione: il testo continua accanto alla figura. Le misure restano confrontabili e la didascalia descrive il campione.</p>`).replace('__IMAGE_SOURCE__', imageSource);
    await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, source);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await expect.poll(() => editor.getByAltText('Campione sintetico').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    const original = await read();
    const formats = await capture();
    expect(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
    const exported = await page.evaluate(html => {
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      const wrapper = body.querySelector<HTMLElement>('[data-editor-image]')!;
      const img = wrapper.querySelector('img')!;
      return { src: img.getAttribute('src'), width: img.getAttribute('width'), height: img.getAttribute('height'),
        float: wrapper.style.float, transform: wrapper.style.transform, caption: wrapper.querySelector('.editor-image-caption')!.textContent };
    }, formats['text/html']);
    const width = Math.round(634 * variant.width / 100);
    expect(exported).toEqual({ src: imageSource, width: String(width), height: String(Math.round(width / (variant.ratio ?? 1.5))),
      float: 'right', transform: `translate(${variant.offsetX}px, 18px)`, caption: 'Figura 1: campione sintetico' });
    expect(Math.abs(original.geometry.width - width)).toBeLessThan(1);
    expect(Math.abs(original.geometry.height - width / (variant.ratio ?? 1.5))).toBeLessThan(1);
    // Use the real fallback bytes; the native MIME must remain absent.
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    const pasted = await read();
    expect(pasted.images).toEqual(original.images);
    expect(pasted.pixels).toEqual(original.pixels);
    expect(pasted.text).toBe(original.text);
    expect(pasted.geometry).toEqual(original.geometry);
    await page.keyboard.press('Control+z'); expect((await read()).images).toEqual(original.images);
    await page.keyboard.press('Control+Shift+z'); expect((await read()).geometry).toEqual(pasted.geometry);
    await editor.getByText('Misura da correggere', { exact: true }).click();
    await page.keyboard.press('End'); await page.keyboard.type(': confermata');
    await page.keyboard.press('Control+z'); expect((await read()).text).toBe(pasted.text);
    await page.keyboard.press('Control+Shift+z');
    const edited = await read();
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
    await page.keyboard.press('Control+z'); expect((await read()).images).toEqual(edited.images);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await completed.getByRole('heading').click();
    await expect.poll(() => editor.evaluate(root => Boolean((root as HTMLElement & { editor?: Editor }).editor))).toBe(true);
    await expect.poll(() => editor.getByAltText('Campione sintetico').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    const reopened = await read();
    expect(reopened.images).toEqual(edited.images);
    expect(reopened.pixels).toEqual(edited.pixels);
    expect(reopened.text).toBe(edited.text);
    expect(reopened.geometry).toEqual(edited.geometry);
    const finalFormats = await capture();
    expect(finalFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
    const button = await capture(true);
    expect(button['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeUndefined();
    const imageDimensions = (html: string) => page.evaluate(value => {
      const img = new DOMParser().parseFromString(value, 'text/html').querySelector('img')!;
      return { src: img.getAttribute('src'), width: img.getAttribute('width'), height: img.getAttribute('height') };
    }, html);
    expect(await imageDimensions(button['text/html'])).toEqual(await imageDimensions(finalFormats['text/html']));
    expect(button['text/plain']).toContain('Figura 1: campione sintetico');
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-clipboard.json`), JSON.stringify(finalFormats));
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-button-clipboard.json`), JSON.stringify(button));
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-readback.json`), JSON.stringify({ variant, original, pasted, edited, reopened, exported }));
    await page.screenshot({ path: testInfo.outputPath(`${variant.name}-app.png`) });
  }
});

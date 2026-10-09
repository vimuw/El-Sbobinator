import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('native clipboard exports the displayed positions of consecutive wrap images', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = info.outputPath('wrap-clipboard.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'wrap-clipboard.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  await editor.evaluate((root, src) => {
    const image = (offset: number, alt: string) => `<span data-editor-image data-width="59" data-layout="wrap" data-position="100" data-offset-y="${offset}" data-aspect-ratio="1.33"><img src="${src}" alt="${alt}"></span>`;
    (root as HTMLElement & { editor: Editor }).editor.commands.setContent(`<h2>Prima sezione</h2><p>${image(32.25, 'Prima figura')}${'Il testo descrive la prima figura e continua nel paragrafo. '.repeat(12)}</p><h3>Seconda sezione</h3><p>${image(240.63, 'Seconda figura')}${'La seconda figura accompagna questo testo e deve restare nella sua sezione. '.repeat(8)}</p><h2>Sezione successiva</h2><p>${'Questo testo appartiene alla sezione successiva. '.repeat(12)}</p>`);
  }, src);
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const geometry = () => editor.evaluate(root => {
    const scale = root.getBoundingClientRect().width / (root as HTMLElement).offsetWidth;
    return Array.from(root.querySelectorAll<HTMLElement>('.editor-image-node')).map(anchor => {
      const surface = anchor.querySelector('.editor-image-surface')!.getBoundingClientRect();
      const paragraph = anchor.closest('p')!.getBoundingClientRect();
      return { left: (surface.left - paragraph.left) / scale, top: (surface.top - paragraph.top) / scale, stored: Number(anchor.dataset.offsetY) };
    });
  });
  for (const zoom of [100, 75, 150]) {
    await page.getByTitle('Livello di zoom').click();
    await page.locator('.zoom-dropdown-panel').getByRole('button', { name: `${zoom}%`, exact: true }).click();
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const formats = await readClipboardFormats(page);
    const model = JSON.parse(JSON.parse(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    const actual = Object.values(model.dsl_entitymap) as { pe_lo: number; pe_to: number; ee_eo: { eo_ml: number; eo_mt: number } }[];
    const expected = await geometry();
    fs.writeFileSync(info.outputPath(`geometry-${zoom}.json`), JSON.stringify({ expected, actual }, null, 2));
    for (let i = 0; i < expected.length; i++) {
      expect(actual[i].pe_to + actual[i].ee_eo.eo_mt).toBeCloseTo(expected[i].top * 0.75, 1);
      expect(actual[i].pe_lo + actual[i].ee_eo.eo_ml).toBeCloseTo(expected[i].left * 0.75, 0);
    }
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(saved);
    expect(formats['text/html']).toContain('data-offset-y="240.63"');
    await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    const buttonFormats = await readClipboardFormats(page);
    expect(JSON.parse(JSON.parse(buttonFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved).toEqual(model);
    if (zoom === 100) fs.writeFileSync(info.outputPath('clipboard.json'), JSON.stringify(formats));
  }
  // A selection containing only the second occurrence of the same asset must
  // use that occurrence's geometry, not the first image in the source DOM.
  const expectedSecond = (await geometry())[1];
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent.startsWith('La seconda')) instance.commands.setTextSelection({ from: pos + 1, to: pos + node.nodeSize - 1 });
    });
  });
  await editor.focus(); await page.keyboard.press('Control+c');
  const partialFormats = await readClipboardFormats(page);
  const partial = JSON.parse(JSON.parse(partialFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const partialImages = Object.values(partial.dsl_entitymap) as { pe_to: number; ee_eo: { eo_mt: number } }[];
  expect(partialImages).toHaveLength(1);
  expect(partialImages[0].pe_to + partialImages[0].ee_eo.eo_mt).toBeCloseTo(expectedSecond.top * 0.75, 1);
  expect(partial.dsl_spacers).toContain('La seconda figura');
  expect(partial.dsl_spacers).not.toContain('Prima sezione');
  for (const action of ['Copia', 'Taglia']) {
    await page.locator('.editor-shell').evaluate(el => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 })));
    await page.locator('.editor-context-menu').getByText(action, { exact: true }).click();
    const menuFormats = await readClipboardFormats(page);
    const menuModel = JSON.parse(JSON.parse(menuFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    fs.writeFileSync(info.outputPath(`context-${action === 'Copia' ? 'copy' : 'cut'}-comparison.json`), JSON.stringify({ expectedSecond, keyboard: partial, menu: menuModel }, null, 2));
    expect(menuModel).toEqual(partial);
    expect(menuFormats['text/html']).toEqual(partialFormats['text/html']);
    expect(menuFormats['text/plain']).toEqual(partialFormats['text/plain']);
    if (action === 'Taglia') {
      await expect(editor.getByAltText('Seconda figura')).toHaveCount(0);
      await expect(editor.getByAltText('Prima figura')).toHaveCount(1);
      expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getText())).not.toContain('La seconda figura');
      await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
      const cut = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
      await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.commands.undo());
      await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(saved);
      await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.commands.redo());
      await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(cut);
      await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.commands.undo());
    }
    await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(saved);
  }
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await completed.getByRole('heading').click();
  await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(saved);
  await expect.poll(async () => Math.abs((await geometry())[1].top - expectedSecond.top)).toBeLessThan(1);
});

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

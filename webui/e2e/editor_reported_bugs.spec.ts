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

test('internal fallback copy keeps default headings readable in dark mode and preserves direct colors', async ({ page }, info) => {
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await paste(page, '<h1>Predefinito</h1><h2 style="color:#000000">Nero scelto</h2><h3 style="color:#123abc">Blu scelto</h3><div data-math-block="\\begin{matrix}a&amp;b\\end{matrix}">Matrice</div>');
  const editor = page.locator('.tiptap-editor');
  const colors = () => editor.locator('h1,h2,h3').evaluateAll(headings => headings.map(h => getComputedStyle(h).color));
  const original = await colors();
  expect(original[0]).not.toBe('rgb(0, 0, 0)');
  expect(original.slice(1)).toEqual(['rgb(0, 0, 0)', 'rgb(18, 58, 188)']);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c'); await page.keyboard.press('Control+v');
  await expect.poll(colors).toEqual(original);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect.poll(colors).toEqual(original);
  await page.screenshot({ path: info.outputPath('heading-colors-reopened.png') });
});

test('internal image copies retain pixels, alpha, size changes and saved sources', async ({ page }, info) => {
  const src = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#00aa66'; ctx.fillRect(400, 200, 800, 600);
    return canvas.toDataURL('image/png');
  });
  await paste(page, `<p><span data-editor-image data-layout="inline" data-width="20"><img src="${src}" alt="Originale"></span>Prima</p><p>Destinazione</p>`);
  const editor = page.locator('.tiptap-editor');
  await expect(editor.locator('img.editor-image-asset')).toHaveCount(1);
  await editor.getByAltText('Originale').click(); await page.keyboard.press('Control+c');
  const copyImageCount = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const item = items.find(item => item.types.includes('text/html'))!;
    const html = await (await item.getType('text/html')).text();
    return { count: new DOMParser().parseFromString(html, 'text/html').querySelectorAll('img').length, html };
  });
  expect(copyImageCount.count).toBe(1);
  fs.writeFileSync(info.outputPath('copied.html'), copyImageCount.html);
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
  });
  await page.keyboard.press('Control+v');
  fs.writeFileSync(info.outputPath('after-paste.json'), JSON.stringify(await editor.evaluate(root => (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor.getJSON())));
  await expect(editor.locator('img.editor-image-asset')).toHaveCount(2);
  await editor.locator('img.editor-image-asset').last().click();
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    instance.commands.updateAttributes('floatingImage', { width: 90 });
  });
  await page.keyboard.press('Control+c');
  // Start the next paste after ProseMirror's 500ms history grouping interval.
  await page.waitForTimeout(600);
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: import('@tiptap/core').Editor }).editor;
    instance.commands.setTextSelection(instance.state.doc.content.size - 1);
  });
  await page.keyboard.press('Control+v');
  await expect(editor.locator('img.editor-image-asset')).toHaveCount(3);
  const read = () => editor.locator('img.editor-image-asset').evaluateAll(images => images.map(img => ({ src: img.getAttribute('src'), width: (img as HTMLImageElement).naturalWidth, height: (img as HTMLImageElement).naturalHeight })));
  await expect.poll(read).toEqual(Array(3).fill({ src, width: 1600, height: 1000 }));
  await page.keyboard.press('Control+z'); await expect(editor.locator('img.editor-image-asset')).toHaveCount(2);
  await page.keyboard.press('Control+Shift+z'); await expect(editor.locator('img.editor-image-asset')).toHaveCount(3);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect.poll(read).toEqual(Array(3).fill({ src, width: 1600, height: 1000 }));
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

test('Enter adds no automatic gap and a second Enter leaves exactly one blank line', async ({ page }, info) => {
  await paste(page, '<p></p>');
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.type('Prima');
  await page.keyboard.press('Enter'); await page.keyboard.type('Seconda');
  const lines = () => editor.locator('p').evaluateAll(paragraphs => paragraphs.map(p => ({ text: p.textContent, top: p.getBoundingClientRect().top, height: p.getBoundingClientRect().height, gap: getComputedStyle(p).marginBottom })));
  let geometry = await lines();
  expect(geometry.map(p => p.text)).toEqual(['Prima', 'Seconda']);
  expect(geometry[0].gap).toBe('0px');
  expect(Math.abs(geometry[1].top - geometry[0].top - geometry[0].height)).toBeLessThan(1);
  await page.keyboard.press('Enter'); await page.keyboard.press('Enter'); await page.keyboard.type('Terza');
  await page.keyboard.press('Shift+Enter'); await page.keyboard.type('Continua');
  geometry = await lines();
  expect(geometry.map(p => p.text)).toEqual(['Prima', 'Seconda', '', 'TerzaContinua']);
  await expect(editor.locator('br')).toHaveCount(2); // Empty caret line plus explicit soft return.
  expect(Math.abs(geometry[3].top - geometry[1].top - 2 * geometry[1].height)).toBeLessThan(1);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  await page.evaluate(() => {
    const probe = document.createElement('textarea'); probe.id = 'enter-clipboard';
    probe.addEventListener('paste', event => { event.preventDefault(); probe.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)]))); }, { once: true });
    document.body.appendChild(probe); probe.focus();
  });
  await page.keyboard.press('Control+v');
  const clipboard = JSON.parse(await page.locator('#enter-clipboard').inputValue());
  fs.mkdirSync('../_smoke/paragraph-enter', { recursive: true });
  fs.writeFileSync('../_smoke/paragraph-enter/app-clipboard.json', JSON.stringify(clipboard));
  await page.locator('#enter-clipboard').evaluate(probe => probe.remove());
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed').first().getByRole('heading').click();
  await expect.poll(lines).toEqual(geometry);
  await page.screenshot({ path: info.outputPath('enter-spacing.png') });
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

test('captures both copy paths for minimal and representative Docs round trips', async ({ page }) => {
  const directory = '../_smoke/editor-reported-bugs';
  fs.mkdirSync(directory, { recursive: true });
  const src = `data:image/jpeg;base64,${fs.readFileSync('e2e/fixtures/image-layout.jpg').toString('base64')}`;
  const corpora = {
    minimal: '<h1>Verifica editor</h1><p>INIZIO: primo paragrafo.</p><p>FINE: secondo paragrafo.</p>',
    mixed: fs.readFileSync('e2e/fixtures/editor-parity-mixed.html', 'utf8').replace('__IMAGE_SOURCE__', src),
  };
  for (const [name, html] of Object.entries(corpora)) {
    await paste(page, html);
    for (const method of ['button', 'keyboard']) {
      const editor = page.locator('.tiptap-editor');
      if (method === 'button') {
        await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
        await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
      } else {
        await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
      }
      await page.evaluate(() => {
        const input = document.createElement('textarea'); input.id = 'clipboard-format-probe';
        input.addEventListener('paste', event => {
          event.preventDefault();
          input.value = JSON.stringify(Object.fromEntries(Array.from(event.clipboardData!.types, type => [type, event.clipboardData!.getData(type)])));
        }, { once: true });
        document.body.appendChild(input); input.focus();
      });
      await page.keyboard.press('Control+v');
      const formats = JSON.parse(await page.locator('#clipboard-format-probe').inputValue());
      await page.locator('#clipboard-format-probe').evaluate(input => input.remove());
      expect(formats['text/plain']).toContain(name === 'minimal' ? 'FINE: secondo paragrafo.' : 'Fine della lezione sintetica.');
      fs.writeFileSync(`${directory}/${name}-${method}.json`, JSON.stringify(formats));
    }
  }
});

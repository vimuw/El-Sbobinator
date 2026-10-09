import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Editor } from '@tiptap/core';

async function openImageEditor(page: Page, audio: string) {
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  // Vite can become ready before FastAPI; opening the app in that window leaves
  // bootstrap at HTTP 502 and prevents the editor fixture from starting.
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: audio.split(/[\\/]/).pop()! });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  await expect(page.locator('.tiptap-editor')).toBeVisible();
}

test('soft breaks replace selections using the first selected styles and persist through copy', async ({ page, context }, testInfo) => {
  test.setTimeout(240000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_soft_selection.wav'));
  const editor = page.locator('.tiptap-editor');
  const styled = (text: string) => `<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>${text}</s></u></em></strong></mark></span>`;
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    return { document: instance.getJSON(), html: instance.getHTML().replaceAll('data-color="#ffee00"', 'data-color="rgb(255, 238, 0)"'), offset: instance.state.selection.$from.parentOffset,
      geometry: Array.from(root.querySelectorAll('p')).map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })) };
  });
  for (const kind of ['paragraph', 'root', 'nested']) for (const profile of ['uniform', 'mixed', 'boundary', 'reverse-uniform', 'reverse-mixed', 'reverse-boundary', 'start', 'whole', 'reverse-start', 'reverse-whole', 'across-break', 'reverse-across-break', 'from-break', 'reverse-from-break']) {
    const name = `${kind}-${profile}`;
    const originalText = profile.endsWith('break') ? 'Pr\u000bima' : 'Prima';
    const text = profile.endsWith('uniform') ? styled('Prima') : styled(profile.endsWith('break') ? 'Pr<br>' : 'Pr') + 'ima';
    const branch = `<ol${kind === 'nested' ? ' type="a"' : ''}><li><p>${text}</p></li><li><p>Seconda</p></li></ol>`;
    const source = (kind === 'paragraph' ? `<p>${text}</p><p>Seconda</p>` : kind === 'root' ? branch : `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>`) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, source);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await expect(editor.locator('p')).toHaveText(kind === 'nested' ? ['Madre', 'Prima', 'Seconda', 'Ultima', ''] : ['Prima', 'Seconda', '']);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text?.startsWith('Pr')) instance.commands.setTextSelection(pos); });
    });
    await editor.focus();
    const before = await read();
    const from = profile.endsWith('boundary') || profile.endsWith('from-break') ? 2 : ['start', 'whole', 'reverse-start', 'reverse-whole'].includes(profile) ? 0 : 1;
    const to = profile.endsWith('whole') ? 5 : profile.endsWith('start') ? 3 : 4;
    const reverse = profile.startsWith('reverse');
    for (let index = 0; index < (reverse ? to : from); index++) {
      await page.keyboard.press('ArrowRight');
      await expect.poll(async () => (await read()).offset).toBe(index + 1);
    }
    for (let index = 0; index < to - from; index++) {
      await page.keyboard.press(reverse ? 'Shift+ArrowLeft' : 'Shift+ArrowRight');
      await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$head.parentOffset)).toBe(reverse ? to - index - 1 : from + index + 1);
    }
    expect(await editor.evaluate(root => {
      const selection = (root as HTMLElement & { editor: Editor }).editor.state.selection;
      return { anchor: selection.$anchor.parentOffset, head: selection.$head.parentOffset };
    })).toEqual({ anchor: reverse ? to : from, head: reverse ? from : to });
    expect(await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      return instance.state.doc.textBetween(instance.state.selection.from, instance.state.selection.to, '', '\u000b');
    })).toBe(originalText.slice(from, to));
    await page.keyboard.press('Shift+Enter'); await page.keyboard.type('X');
    const typed = await read();
    expect(typed.offset).toBe(from + 2);
    const paragraph = editor.locator('p').nth(kind === 'nested' ? 1 : 0);
    await expect(paragraph).toHaveText(originalText.slice(0, from) + 'X' + originalText.slice(to));
    await expect(paragraph.locator('br')).toHaveCount(1);
    expect(typed.geometry).toHaveLength(before.geometry.length);
    expect(typed.geometry.map(p => p.left)).toEqual(before.geometry.map(p => p.left));
    await page.keyboard.press('Control+z'); expect((await read()).html).toBe(before.html);
    await page.keyboard.press('Control+Shift+z'); expect((await read()).html).toBe(typed.html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const clipboard = await readClipboardFormats(page);
    const native = JSON.parse(JSON.parse(clipboard['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    expect(native.dsl_spacers).toContain(originalText.slice(0, from) + '\u000bX' + originalText.slice(to) + '\n');
    const at = native.dsl_spacers.indexOf('\u000b');
    const styles = native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
    for (const index of [at, at + 1]) expect(styles.slice(0, index + 1).filter(Boolean).at(-1)).toMatchObject(profile.endsWith('boundary')
      ? { ts_bd: false, ts_it: false, ts_un: false, ts_st: false, ts_ff: 'Arial', ts_fs: 11, ts_fgc2: { hclr_color: '#000000' }, ts_bgc2: { hclr_color: null } }
      : { ts_bd: true, ts_it: true, ts_un: true, ts_st: true, ts_ff: 'Georgia', ts_fs: 18, ts_fgc2: { hclr_color: '#123abc' }, ts_bgc2: { hclr_color: '#ffee00' } });
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_soft_selection.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible(); await expect.poll(async () => (await read()).html).toBe(typed.html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const reopenedClipboard = await readClipboardFormats(page);
    reopenedClipboard['text/html'] = reopenedClipboard['text/html'].replaceAll('data-color="rgb(255, 238, 0)"', 'data-color="#ffee00"');
    expect(reopenedClipboard).toEqual(clipboard);
    fs.writeFileSync(testInfo.outputPath(`soft-selection-${name}.json`), JSON.stringify({ before, typed, reopened: await read(), clipboard }));
  }
  await page.screenshot({ path: testInfo.outputPath('soft-selection-editor.png') });
});

test('soft breaks preserve combined styles, list structure, history and saved clipboard', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_soft_break.wav'));
  const editor = page.locator('.tiptap-editor');
  const styled = '<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>Prima</s></u></em></strong></mark></span>';
  const html = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML().replaceAll('data-color="#ffee00"', 'data-color="rgb(255, 238, 0)"'));
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    return { document: instance.getJSON(), html: instance.getHTML().replaceAll('data-color="#ffee00"', 'data-color="rgb(255, 238, 0)"'), position: instance.state.selection.from, offset: instance.state.selection.$from.parentOffset,
      geometry: Array.from(root.querySelectorAll('p')).map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })) };
  });
  for (const kind of ['paragraph', 'root', 'nested']) for (const offset of [0, 2, 5]) for (const count of [1, 2]) {
    const name = `${kind}${offset}x${count}`;
    const branch = `<ol${kind === 'nested' ? ' type="a"' : ''}><li><p>${styled}</p></li><li><p>Seconda</p></li></ol>`;
    const source = (kind === 'paragraph' ? `<p>${styled}</p><p>Seconda</p>` : kind === 'nested' ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, source);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await expect(editor.locator('p')).toHaveText(kind === 'nested' ? ['Madre', 'Prima', 'Seconda', 'Ultima', ''] : ['Prima', 'Seconda', '']);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await editor.evaluate((root, offset) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos + offset); });
    }, offset);
    await editor.focus();
    const before = await read();
    for (let index = 0; index < count; index++) await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('X');
    const typed = await read();
    const paragraph = editor.locator('p').nth(kind === 'nested' ? 1 : 0);
    await expect(paragraph).toHaveText('Prima'.slice(0, offset) + 'X' + 'Prima'.slice(offset));
    await expect(paragraph.locator('br')).toHaveCount(count);
    expect((await paragraph.locator('strong em s u').allTextContents()).join('')).toBe('Prima'.slice(0, offset) + 'X' + 'Prima'.slice(offset));
    for (const span of await paragraph.locator('span').all()) {
      await expect(span).toHaveCSS('font-family', 'Georgia');
      await expect(span).toHaveCSS('font-size', '24px');
      await expect(span).toHaveCSS('color', 'rgb(18, 58, 188)');
    }
    for (const mark of await paragraph.locator('mark').all()) await expect(mark).toHaveCSS('background-color', 'rgb(255, 238, 0)');
    expect(typed.offset).toBe(offset + count + 1);
    expect(typed.geometry).toHaveLength(before.geometry.length);
    expect(typed.geometry[kind === 'nested' ? 1 : 0].height).toBeGreaterThan(before.geometry[kind === 'nested' ? 1 : 0].height);
    await page.keyboard.press('Control+z'); expect(await html()).toBe(before.html);
    await page.keyboard.press('Control+Shift+z'); expect(await html()).toBe(typed.html);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const clipboard = await readClipboardFormats(page);
    const native = JSON.parse(JSON.parse(clipboard['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    expect(native.dsl_spacers).toContain('Prima'.slice(0, offset) + '\u000b'.repeat(count) + 'X' + 'Prima'.slice(offset) + '\n');
    expect(clipboard['text/html']).toContain('<br');
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_soft_break.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible();
    await expect.poll(html).toBe(typed.html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const reopenedClipboard = await readClipboardFormats(page);
    reopenedClipboard['text/html'] = reopenedClipboard['text/html'].replaceAll('data-color="rgb(255, 238, 0)"', 'data-color="#ffee00"');
    expect(reopenedClipboard).toEqual(clipboard);
    fs.writeFileSync(testInfo.outputPath(`soft-break-${name}.json`), JSON.stringify({ before, typed, reopened: await read(), clipboard }));
  }
  await page.screenshot({ path: testInfo.outputPath('soft-break-editor.png') });
});

test('combined empty-line styles survive keyboard return, second Enter, autosave and reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_empty_styles.wav'));
  const editor = page.locator('.tiptap-editor');
  // CSS parsing canonicalizes the equivalent highlight hex value on reopen.
  const html = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML().replaceAll('data-color="#ffee00"', 'data-color="rgb(255, 238, 0)"'));
  const selectNeighbour = async (index: number, direction: 'ArrowUp' | 'ArrowDown') => editor.evaluate((root, { index, direction }) => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    let paragraph = 0;
    instance.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && paragraph++ === index + (direction === 'ArrowUp' ? 1 : -1)) {
        instance.commands.setTextSelection(pos + 1 + (direction === 'ArrowDown' ? node.content.size : 0));
      }
    });
  }, { index, direction });
  const styled = '<span style="font-family:Georgia;font-size:18pt;color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00"><strong><em><u><s>Prima</s></u></em></strong></mark></span>';
  for (const nested of [false, true]) for (const offset of [0, 5]) {
    const name = `${nested ? 'nested' : 'root'}${offset}`;
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p>${styled}</p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const source = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, source);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await expect(editor.locator('p')).toHaveText(nested ? ['Madre', 'Prima', 'Figlia', 'Sorella', 'Seconda', 'Ultima', ''] : ['Prima', 'Figlia', 'Sorella', 'Seconda', '']);
    await editor.evaluate((root, offset) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos + offset); });
    }, offset);
    await page.keyboard.press('Enter');
    await expect(editor.locator('p')).toHaveCount(nested ? 8 : 6);
    if (!offset) { await page.keyboard.press('ArrowUp'); await page.keyboard.press('Home'); }
    fs.writeFileSync(testInfo.outputPath(`empty-styles-${name}-before-exit.json`), JSON.stringify(await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      return { document: instance.getJSON(), position: instance.state.selection.from };
    })));
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parent.textContent)).toBe('');
    await page.keyboard.press('Enter');
    const blankIndex = (nested ? 1 : 0) + (offset ? 1 : 0);
    const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ top: node.getBoundingClientRect().top, height: node.getBoundingClientRect().height })));
    const emptyGeometry = await geometry();
    const emptyHtml = await html();
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`empty-styles-${name}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_empty_styles.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible();
    await expect.poll(html).toBe(emptyHtml);
    let typedHtml = '';
    const navigation = [];
    for (const direction of (blankIndex ? ['ArrowUp', 'ArrowDown'] : ['ArrowUp']) as ('ArrowUp' | 'ArrowDown')[]) {
      await selectNeighbour(blankIndex, direction); await editor.focus(); await page.keyboard.press(direction);
      await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parent.textContent)).toBe('');
      expect(await html()).toBe(emptyHtml);
      const caret = await editor.evaluate(root => {
        const instance = (root as HTMLElement & { editor: Editor }).editor;
        return { position: instance.state.selection.from, offset: instance.state.selection.$from.parentOffset, marks: instance.state.storedMarks?.map(mark => mark.toJSON()) };
      });
      expect(caret.offset).toBe(0);
      await page.keyboard.type('X');
      const paragraph = editor.locator('p').nth(blankIndex);
      await expect(paragraph.locator('strong em s u')).toHaveText('X');
      const css = await paragraph.locator('span').evaluate(node => {
        const style = getComputedStyle(node); return { font: style.fontFamily, size: style.fontSize, color: style.color };
      });
      expect(css).toEqual({ font: 'Georgia', size: '24px', color: 'rgb(18, 58, 188)' });
      await expect(paragraph.locator('mark')).toHaveCSS('background-color', 'rgb(255, 238, 0)');
      expect(await geometry()).toEqual(emptyGeometry);
      typedHtml = await html();
      await page.keyboard.press('Control+z'); expect(await html()).toBe(emptyHtml);
      await page.keyboard.press('Control+Shift+z'); expect(await html()).toBe(typedHtml);
      navigation.push({ direction, caret, css, geometry: await geometry() });
      await page.keyboard.press('Control+z'); expect(await html()).toBe(emptyHtml);
    }
    fs.writeFileSync(testInfo.outputPath(`empty-keyboard-${name}-navigation.json`), JSON.stringify(navigation));
    await page.keyboard.press('Control+Shift+z'); expect(await html()).toBe(typedHtml);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`empty-styles-${name}-typed-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_empty_styles.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible(); await expect.poll(html).toBe(typedHtml);
    await page.screenshot({ path: testInfo.outputPath(`empty-styles-${name}-editor.png`) });
  }
});

test('list second Enter on an empty parent exits one level and retains descendant geometry', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_empty_enter.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
  for (const nested of [false, true]) for (const offset of [0, 5]) {
    const name = `${nested ? 'nested' : 'root'}${offset}`;
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate((root, offset) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos + offset); });
    }, offset);
    await editor.focus(); await page.keyboard.press('Enter');
    if (!offset) { await page.keyboard.press('ArrowUp'); await page.keyboard.press('Home'); }
    const split = await getDocument();
    const before = await geometry();
    await page.keyboard.press('Enter');
    const exited = await getDocument();
    const after = await geometry();
    const blankIndex = (nested ? 1 : 0) + (offset ? 1 : 0);
    expect(after.map(p => ({ text: p.text, left: p.left }))).toEqual(before.map((p, i) => ({ text: p.text, left: p.left - (i === blankIndex ? 48 : 0) })));
    const gap = nested ? 0 : await editor.locator('p').nth(blankIndex).evaluate(p => parseFloat(getComputedStyle(p).marginBottom));
    after.forEach((p, i) => expect(Math.abs(p.top - before[i].top - (i > blankIndex ? gap : 0))).toBeLessThan(0.1));
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    await page.keyboard.type('X');
    expect((await geometry())[blankIndex].text).toBe('X');
    expect((await editor.locator('strong').allTextContents()).join('').replace('X', '')).toBe('Prima');
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(exited);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(split);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(exited);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`empty-enter-${name}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(exited); expect(await geometry()).toEqual(after);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_empty_enter.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible();
    await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.isInitialized)).toBe(true);
    await expect.poll(getDocument).toEqual(exited); expect(await geometry()).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath(`empty-enter-${name}-editor.png`) });
    await editor.evaluate((root, index) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      let paragraph = 0;
      instance.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && paragraph++ === index) instance.commands.setTextSelection(pos + 1); });
    }, blankIndex);
    await editor.focus(); await page.keyboard.type('X');
    await expect(editor.locator('p').nth(blankIndex).locator('strong')).toHaveText('X');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`empty-enter-${name}-typed-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
  }
});

test('list Enter on a parent keeps its child list with the second item and separates undo', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_enter_subtree.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
  for (const nested of [false, true]) for (const offset of [0, 2, 5]) {
    const name = `${nested ? 'nested' : 'root'}${offset}`;
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate((root, offset) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos + offset); });
    }, offset);
    const original = await getDocument();
    const before = await geometry();
    await editor.focus(); await page.keyboard.press('Enter');
    const split = await getDocument();
    const after = await geometry();
    const parentIndex = nested ? 1 : 0;
    expect(after.map(p => p.text)).toEqual([...before.slice(0, parentIndex).map(p => p.text), 'Prima'.slice(0, offset), 'Prima'.slice(offset), ...before.slice(parentIndex + 1).map(p => p.text)]);
    expect(after.map(p => p.left)).toEqual([...before.slice(0, parentIndex).map(p => p.left), before[parentIndex].left, before[parentIndex].left, ...before.slice(parentIndex + 1).map(p => p.left)]);
    expect(after.slice(parentIndex + 2).every((p, i) => p.top > before[parentIndex + i + 1].top)).toBe(true);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    expect((await editor.locator('strong').allTextContents()).join('')).toBe('Prima');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(split);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(original);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(split);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`enter-${name}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(split); expect(await geometry()).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath(`enter-${name}-editor.png`) });
  }
});

test('list child Backspace after ancestor merge releases the last hidden shell and separates undo', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_children.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
  const select = async (text: string) => editor.evaluate((root, label) => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === label) instance.commands.setTextSelection(pos); });
  }, text);
  for (const nested of [false, true]) {
    const name = nested ? 'nested' : 'root';
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await select('Prima'); await editor.focus();
    await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    for (let step = 1; step <= 6; step++) {
      const label = step <= 3 ? 'Figlia' : 'Sorella';
      await select(label); await editor.focus();
      const original = await getDocument();
      const before = await geometry();
      await page.keyboard.press('Backspace');
      const changed = await getDocument();
      const after = await geometry();
      if (step % 3 === 2) expect(after).toEqual(before.map(p => p.text === label ? { ...p, left: p.left - (nested ? 144 : 96) } : p));
      if (step % 3 === 0) {
        expect(after[0]).toEqual({ ...before[0], text: before[0].text! + label });
        expect(after.slice(1).map(p => p.left)).toEqual(before.slice(2).map(p => p.left));
        expect(after.slice(1).every((p, i) => p.top < before[i + 2].top)).toBe(true);
      }
      expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(step % 3 ? 0 : (nested ? 5 : 0) + (step === 3 ? 5 : 11));
      await expect(editor.locator('strong')).toHaveText('Prima');
      await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(changed);
      await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(original);
      await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(changed);
      await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
      fs.writeFileSync(testInfo.outputPath(`child-${name}-step${step}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
      const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
      await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
      expect(await getDocument()).toEqual(changed); expect(await geometry()).toEqual(after);
    }
    await page.screenshot({ path: testInfo.outputPath(`child-${name}-editor.png`) });
  }
});

test('list third Backspace on the first child branch joins ancestor text and preserves child depth', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_first_merge.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const nested of [false, true]) {
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos); });
    });
    await editor.focus(); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    const reset = await getDocument();
    const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
    const before = await geometry();
    await page.keyboard.press('Backspace');
    const joined = await getDocument();
    const after = await geometry();
    if (nested) {
      expect(after.map(p => p.text)).toEqual(['MadrePrima', 'Figlia', 'Sorella', 'Seconda', 'Ultima', '']);
      expect(after[0]).toEqual({ ...before[0], text: 'MadrePrima' });
      const height = before[2].top - before[1].top;
      expect(after.slice(1)).toEqual(before.slice(2).map(p => ({ ...p, top: p.top - height })));
    } else {
      expect(joined).toEqual(reset); expect(after).toEqual(before);
    }
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(nested ? 5 : 0);
    await expect(editor.locator('strong')).toHaveText('Prima');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(joined);
    if (nested) {
      await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(reset);
      await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(joined);
    }
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`first-merge-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(joined); expect(await geometry()).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath(`first-merge-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('list second Backspace on the first child branch resets only its indent and separates undo', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_first_followup.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const nested of [false, true]) {
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos); });
    });
    const original = await getDocument();
    await editor.focus(); await page.keyboard.press('Backspace');
    const unmarked = await getDocument();
    const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
    const before = await geometry();
    await page.keyboard.press('Backspace');
    const reset = await getDocument();
    const after = await geometry();
    expect(after).toEqual(before.map(p => p.text === 'Prima' ? { ...p, left: p.left - (nested ? 96 : 48) } : p));
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    await expect(editor.locator('li[style*="list-style-type: none"]')).toHaveCount(1);
    await expect(editor.locator('strong')).toHaveText('Prima');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(reset);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(unmarked);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(original);
    await page.keyboard.press('Control+Shift+z'); await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(reset);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`first-followup-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(reset);
    expect(await geometry()).toEqual(after);
    await page.screenshot({ path: testInfo.outputPath(`first-followup-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('list Backspace on the first child branch retains geometry and following numbering', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_first_subtree.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const nested of [false, true]) {
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p><strong>Prima</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Prima') instance.commands.setTextSelection(pos); });
    });
    const before = await getDocument();
    const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
    const initialGeometry = await geometry();
    await editor.focus(); await page.keyboard.press('Backspace');
    const removed = await getDocument();
    expect(await geometry()).toEqual(initialGeometry);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    await expect(editor.locator('li[style*="list-style-type: none"]')).toHaveCount(1);
    await expect(editor.locator('strong')).toHaveText('Prima');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(before);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`first-subtree-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(copied));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(removed);
    await page.screenshot({ path: testInfo.outputPath(`first-subtree-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('list Backspace between two child branches retains geometry and continues numbering', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_two_branches.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const nested of [false, true]) {
    const child = (body: string) => `<ol type="${nested ? 'i' : 'a'}">${body}</ol>`;
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p>Prima</p>${child('<li><p>Vecchia</p></li><li><p>Precedente</p></li>')}</li><li><p><strong>Seconda</strong></p>${child('<li><p>Figlia</p></li><li><p>Sorella</p></li>')}</li><li><p>Terza</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Seconda') instance.commands.setTextSelection(pos); });
    });
    const before = await getDocument();
    const geometry = () => editor.locator('p').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
    const initialGeometry = await geometry();
    await editor.focus(); await page.keyboard.press('Backspace');
    const removed = await getDocument();
    expect(await geometry()).toEqual(initialGeometry);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    const list = nested ? editor.locator('ol[type="a"]').first() : editor.locator('ol').first();
    await expect(list.locator(':scope > li')).toHaveCount(2);
    const children = list.locator(':scope > li').first().locator(':scope > ol');
    await expect(children).toHaveCount(2);
    await expect(children.nth(0)).not.toHaveAttribute('start');
    await expect(children.nth(1)).toHaveAttribute('start', '3');
    await expect(children.nth(1)).toHaveAttribute('type', nested ? 'i' : 'a');
    await expect(editor.locator('strong')).toHaveText('Seconda');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(before);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    fs.writeFileSync(testInfo.outputPath(`backspace-two-branches-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(await readClipboardFormats(page)));
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(removed);
    await page.screenshot({ path: testInfo.outputPath(`backspace-two-branches-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('list Backspace retains a child branch and removes only its parent marker', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace_subtree.wav'));
  const editor = page.locator('.tiptap-editor');
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const nested of [false, true]) {
    const branch = `<ol${nested ? ' type="a"' : ''}><li><p>Prima</p></li><li><p><strong>Seconda</strong></p><ol type="${nested ? 'i' : 'a'}"><li><p>Figlia</p></li><li><p>Sorella</p></li></ol></li><li><p>Terza</p></li></ol>`;
    const html = (nested ? `<ol><li><p>Madre</p>${branch}</li><li><p>Ultima</p></li></ol>` : branch) + '<p></p>';
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Seconda') instance.commands.setTextSelection(pos); });
    });
    const before = await getDocument();
    const paragraphs = editor.locator('p').filter({ hasText: /^(Seconda|Figlia|Sorella|Terza)$/ });
    const geometry = () => paragraphs.evaluateAll(nodes => nodes.map(node => ({ text: node.textContent, left: node.getBoundingClientRect().left, top: node.getBoundingClientRect().top })));
    const initialGeometry = await geometry();
    await editor.focus(); await page.keyboard.press('Backspace');
    const removed = await getDocument();
    expect(await geometry()).toEqual(initialGeometry);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(0);
    const list = nested ? editor.locator('ol[type="a"]').first() : editor.locator('ol').first();
    await expect(list.locator(':scope > li')).toHaveCount(2);
    await expect(list.locator(':scope > li').first().locator(':scope > p')).toHaveCount(2);
    await expect(editor.locator('strong')).toHaveText('Seconda');
    await page.keyboard.type('X'); await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(before);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(removed);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`backspace-subtree-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(copied));
    // Reopen the exact saved HTML rather than relying on DOM wrappers alone.
    const saved = await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getHTML());
    await editor.evaluate((root, content) => { (root as HTMLElement & { editor: Editor }).editor.commands.setContent(content); }, saved);
    expect(await getDocument()).toEqual(removed);
    await page.screenshot({ path: testInfo.outputPath(`backspace-subtree-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('cross-level list Delete joins text and continues child numbering with separate history', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_delete_levels.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = '<ol><li><p>Madre</p><ol type="a"><li><p><strong>Figlia</strong></p></li><li><p>Sorella</p></li></ol></li><li><p>Seconda</p><ol type="a"><li><p>Nipote</p></li><li><p>Altra</p></li></ol></li><li><p>Ultima</p></li></ol><p></p>';
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const paste = async (value: string) => {
    await page.evaluate(async text => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([text], { type: 'text/html' }) })]); }, value);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  for (const label of ['Madre', 'Sorella', 'Prima']) {
    await paste(label === 'Prima' ? '<ol><li><p>Prima</p></li><li><p><strong>Seconda</strong></p><ol type="a"><li><p>Nipote</p></li><li><p>Altra</p></li></ol></li><li><p>Ultima</p></li></ol><p></p>' : html);
    await editor.evaluate((root, text) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === text) instance.commands.setTextSelection(pos + node.nodeSize); });
    }, label);
    await editor.focus();
    const original = await getDocument();
    const left = await editor.locator('p').filter({ hasText: new RegExp(`^${label}$`) }).evaluate(node => node.getBoundingClientRect().left);
    await page.keyboard.type('Y'); const typed = await getDocument();
    await page.keyboard.press('Delete'); const merged = await getDocument();
    const joined = editor.locator('p').filter({ hasText: new RegExp(`^${label}Y${label === 'Madre' ? 'Figlia' : 'Seconda'}$`) });
    await expect(joined).toBeVisible();
    expect(await joined.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(left, 1);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(label.length + 1);
    await page.keyboard.type('X');
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(merged);
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(typed);
    await page.keyboard.press('Backspace'); expect(await getDocument()).toEqual(original);
    await page.keyboard.press('Delete'); const result = await getDocument();
    await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(original);
    await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(result);
    await expect(editor.locator('strong')).toHaveText(label === 'Prima' ? 'Seconda' : 'Figlia');
    await expect(editor.locator('ol').first().locator(':scope > li')).toHaveCount(label === 'Madre' ? 3 : 2);
    await expect(editor.locator('ol[type="a"]').first().locator(':scope > li')).toHaveCount(label === 'Madre' ? 1 : label === 'Prima' ? 2 : 4);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`delete-levels-${label}-clipboard.json`), JSON.stringify(copied));
    await paste(copied['text/html']);
    await expect(editor.locator('p').filter({ hasText: new RegExp(`^${label}${label === 'Madre' ? 'Figlia' : 'Seconda'}$`) })).toBeVisible();
    await expect(editor.locator('strong')).toHaveText(label === 'Prima' ? 'Seconda' : 'Figlia');
    await page.screenshot({ path: testInfo.outputPath(`delete-levels-${label}-editor.png`) });
  }
});

test('list Delete joins sibling text with separate typing history and native transfer', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_delete.wav'));
  const editor = page.locator('.tiptap-editor');
  const document = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const paste = async (html: string) => {
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  for (const nested of [false, true]) {
    const list = `<ol${nested ? ' type="a"' : ''}><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol>`;
    await paste(nested ? `<ol><li><p>Prima</p>${list}</li><li><p>Ultima</p></li></ol>` : list);
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Figlia') instance.commands.setTextSelection(pos + node.nodeSize); });
    });
    await editor.focus();
    const source = await document();
    const left = await editor.locator('p').filter({ hasText: /^Figlia$/ }).evaluate(node => node.getBoundingClientRect().left);
    await page.keyboard.type('Y'); const typed = await document();
    await page.keyboard.press('Delete');
    const joined = editor.locator('p').filter({ hasText: /^FigliaYX?Seconda$/ });
    await expect(joined).toBeVisible();
    await expect(joined.locator('strong')).toHaveText('Seconda');
    const merged = await document();
    await page.keyboard.type('X'); await expect(joined).toHaveText('FigliaYXSeconda');
    await expect(joined.locator('strong')).toHaveText('Seconda');
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(merged);
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(typed);
    await page.keyboard.press('Backspace'); expect(await document()).toEqual(source);
    // Repeat from the clean source for the Docs comparison corpus.
    await page.keyboard.press('Delete');
    const clean = editor.locator('p').filter({ hasText: /^FigliaSeconda$/ });
    await expect(clean).toBeVisible();
    expect(await clean.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(left, 1);
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(6);
    const result = await document();
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(source);
    await page.keyboard.press('Control+Shift+z'); expect(await document()).toEqual(result);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`delete-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(copied));
    await paste(copied['text/html']);
    await expect(clean).toBeVisible(); await expect(clean.locator('strong')).toHaveText('Seconda');
    await expect(editor.locator('ol').last().locator(':scope > li')).toHaveCount(2);
    await expect(editor.locator('p').filter({ hasText: /^Continuazione$/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`delete-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('third list Backspace joins previous text with independent undo and persistent list structure', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_third_backspace.wav'));
  const editor = page.locator('.tiptap-editor');
  const document = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const paste = async (html: string) => {
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  for (const nested of [false, true]) {
    const list = '<ol type="A" start="4"><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol>';
    await paste(nested ? `<ol><li><p>Prima</p>${list}</li><li><p>Ultima</p></li></ol>` : list);
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Seconda') instance.commands.setTextSelection(pos); });
    });
    await editor.focus(); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace');
    const twice = await document();
    const previous = editor.locator('p').filter({ hasText: /^Figlia$/ });
    const left = await previous.evaluate(node => node.getBoundingClientRect().left);
    await page.keyboard.press('Backspace');
    const joined = editor.locator('p').filter({ hasText: /^FigliaX?Seconda$/ });
    await expect(joined).toBeVisible();
    expect(await joined.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(left, 1);
    await expect(joined.locator('strong')).toHaveText('Seconda');
    await expect(editor.locator('p').filter({ hasText: /^Continuazione$/ })).toHaveCSS('margin-left', '48px');
    await expect(editor.locator('ol').last()).toHaveAttribute('start', '5');
    expect(await editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.$from.parentOffset)).toBe(6);
    const third = await document();
    await page.keyboard.type('X'); await expect(joined).toHaveText('FigliaXSeconda');
    await expect(joined.locator('strong')).toHaveText('Seconda');
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(third);
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(twice);
    await page.keyboard.press('Control+Shift+z'); expect(await document()).toEqual(third);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`third-backspace-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(copied));
    await paste(copied['text/html']);
    await expect(joined).toBeVisible(); await expect(joined.locator('strong')).toHaveText('Seconda');
    await expect(editor.locator('ol').last()).toHaveAttribute('start', '5');
    await page.screenshot({ path: testInfo.outputPath(`third-backspace-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('second list Backspace resets root and nested indents without joining text', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_second_backspace.wav'));
  const editor = page.locator('.tiptap-editor');
  const document = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  const paste = async (html: string) => {
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  for (const nested of [false, true]) {
    const list = '<ol type="A" start="4"><li><p>Figlia</p></li><li><p><strong>Seconda</strong></p><p>Continuazione</p></li><li><p>Terza</p></li></ol>';
    await paste(nested ? `<ol><li><p>Prima</p>${list}</li><li><p>Ultima</p></li></ol>` : list);
    await editor.evaluate(root => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Seconda') instance.commands.setTextSelection(pos); });
    });
    await editor.focus(); await page.keyboard.press('Backspace');
    const once = await document();
    const beforeLeft = await editor.getByText('Seconda', { exact: true }).evaluate(node => node.getBoundingClientRect().left);
    await page.keyboard.press('Backspace');
    const paragraph = editor.locator('p').filter({ hasText: /^X?Seconda$/ });
    const baseLeft = await editor.evaluate(root => root.getBoundingClientRect().left + parseFloat(getComputedStyle(root).paddingLeft));
    expect(await paragraph.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(baseLeft, 1);
    expect(beforeLeft - baseLeft).toBeCloseTo(nested ? 96 : 48, 1);
    await expect(paragraph).toHaveCSS('margin-left', nested ? '-48px' : '0px');
    await expect(paragraph.locator('strong')).toHaveText('Seconda');
    await expect(editor.locator('ol').last()).toHaveAttribute('start', '5');
    const twice = await document();
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(once);
    await page.keyboard.press('Control+Shift+z'); expect(await document()).toEqual(twice);
    // Typing resumes at the original caret with the original character marks.
    await page.keyboard.type('X'); await expect(paragraph.locator('strong')).toHaveText('XSeconda');
    await page.keyboard.press('Control+z'); expect(await document()).toEqual(twice);
    await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    fs.writeFileSync(testInfo.outputPath(`second-backspace-${nested ? 'nested' : 'root'}-clipboard.json`), JSON.stringify(copied));
    const native = JSON.parse(JSON.parse(copied['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
    const styles = Object.fromEntries(native.dsl_styleslices.map((slice: { stsl_type: string; stsl_styles: unknown[] }) => [slice.stsl_type, slice.stsl_styles]));
    const at = native.dsl_spacers.indexOf('Seconda') + 'Seconda'.length;
    expect(styles.paragraph[at]).toMatchObject({ ps_il: 0, ps_ifl: 0 });
    expect(styles.list[at]?.ls_id ?? null).toBeNull();
    await paste(copied['text/html']);
    expect(await editor.locator('p').filter({ hasText: /^Seconda$/ }).evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(baseLeft, 1);
    await expect(editor.locator('ol').last()).toHaveAttribute('start', '5');
    await page.screenshot({ path: testInfo.outputPath(`second-backspace-${nested ? 'nested' : 'root'}-editor.png`) });
  }
});

test('list Backspace removes a marker while preserving paragraphs, indents and numbering', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_backspace.wav'));
  const editor = page.locator('.tiptap-editor');
  const paste = async (html: string) => {
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  const locate = async (label: string) => {
    await editor.evaluate((root, value) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === value) instance.commands.setTextSelection(pos);
      });
    }, label);
    await editor.focus();
  };
  const getDocument = () => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.getJSON());
  await paste('<ol type="A" start="4"><li><p>Prima</p></li><li><p><strong>Seconda</strong></p></li><li><p>Terza</p></li></ol>');
  await locate('Seconda');
  const original = await getDocument();
  const left = await editor.getByText('Seconda', { exact: true }).evaluate(node => node.getBoundingClientRect().left);
  await page.keyboard.press('Backspace');
  const removed = editor.locator(':scope > p').filter({ hasText: /^Seconda$/ });
  await expect(removed).toBeVisible();
  await expect(removed).toHaveCSS('margin-left', '48px');
  expect(await removed.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(left, 1);
  await expect(editor.locator(':scope > ol').last()).toHaveAttribute('start', '5');
  await expect(removed.locator('strong')).toHaveText('Seconda');
  const result = await getDocument();
  await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(original);
  await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(result);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const rootCopy = await readClipboardFormats(page);
  fs.writeFileSync(testInfo.outputPath('backspace-root-clipboard.json'), JSON.stringify(rootCopy));
  await paste(rootCopy['text/html']);
  await expect(editor.locator(':scope > p').filter({ hasText: /^Seconda$/ })).toHaveCSS('margin-left', '48px');
  await expect(editor.locator(':scope > ol').last()).toHaveAttribute('start', '5');
  await editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    instance.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Seconda') instance.commands.setTextSelection({ from: pos, to: pos + node.nodeSize });
    });
  });
  await editor.focus(); await page.keyboard.press('Control+c');
  const wordCopy = await readClipboardFormats(page);
  expect(wordCopy['text/html']).not.toContain('margin-left');
  expect(wordCopy['text/plain']).toBe('Seconda');
  fs.writeFileSync(testInfo.outputPath('backspace-word-clipboard.json'), JSON.stringify(wordCopy));

  await paste('<ol><li><p>Prima</p><ol type="a" start="4"><li><p>Figlia</p></li><li><p>Seconda</p></li><li><p>Terza</p></li></ol></li><li><p>Ultima</p></li></ol>');
  await locate('Seconda');
  const nestedOriginal = await getDocument();
  const nestedLeft = await editor.getByText('Seconda', { exact: true }).evaluate(node => node.getBoundingClientRect().left);
  await page.keyboard.press('Backspace');
  const continuation = editor.locator(':scope > ol > li > p').filter({ hasText: /^Seconda$/ });
  await expect(continuation).toHaveCSS('margin-left', '48px');
  expect(await continuation.evaluate(node => node.getBoundingClientRect().left)).toBeCloseTo(nestedLeft, 1);
  await expect(editor.locator(':scope > ol > li')).toHaveCount(2);
  await expect(editor.locator('ol ol').last()).toHaveAttribute('start', '5');
  const nestedResult = await getDocument();
  await page.keyboard.press('Control+z'); expect(await getDocument()).toEqual(nestedOriginal);
  await page.keyboard.press('Control+Shift+z'); expect(await getDocument()).toEqual(nestedResult);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const nestedCopy = await readClipboardFormats(page);
  fs.writeFileSync(testInfo.outputPath('backspace-nested-clipboard.json'), JSON.stringify(nestedCopy));
  const model = JSON.parse(JSON.parse(nestedCopy['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const at = model.dsl_spacers.indexOf('Seconda') + 'Seconda'.length;
  expect(model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles[at]).toMatchObject({ ps_il: 72, ps_ifl: 72 });
  expect(model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'list').stsl_styles[at].ls_id).toBeNull();
  await paste(nestedCopy['text/html']);
  await expect(editor.locator(':scope > ol > li > p').filter({ hasText: /^Seconda$/ })).toHaveCSS('margin-left', '48px');
  await expect(editor.locator('ol ol').last()).toHaveAttribute('start', '5');
  await page.screenshot({ path: testInfo.outputPath('backspace-editor.png') });
});

test('ordered lists preserve markers, continuation paragraphs and keyboard history', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_lists.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = fs.readFileSync(new URL('./fixtures/editor-parity-lists.html', import.meta.url), 'utf8');
  const paste = async (value: string) => {
    await page.evaluate(async markup => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([markup], { type: 'text/html' }) })]); }, value);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  };
  await paste(html);
  await expect(editor.locator(':scope > ol').first()).toHaveCSS('list-style-type', 'upper-alpha');
  await expect(editor.locator(':scope > ol').first()).toHaveCSS('padding-left', '48px');
  await expect(editor.locator(':scope > ol > li > ol').first()).toHaveCSS('list-style-type', 'lower-roman');
  const original = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await readClipboardFormats(page);
  const native = JSON.parse(JSON.parse(copied['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const lists = native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'list').stsl_styles;
  for (const label of ['Continuazione prima', 'Continuazione dopo figlia']) expect(lists[native.dsl_spacers.indexOf(label) + label.length].ls_id).toBeNull();
  fs.writeFileSync(testInfo.outputPath('lists-clipboard.json'), JSON.stringify(copied));
  await page.screenshot({ path: testInfo.outputPath('lists-editor.png') });
  await editor.focus(); await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+x');
  expect(await readClipboardFormats(page)).toEqual(copied);
  await expect(editor).toHaveText('');
  await editor.focus();
  await page.keyboard.press('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);
  await paste(copied['text/html']);
  const topology = (node: import('@tiptap/core').JSONContent): unknown => ({
    type: node.type, text: node.text,
    ...(node.type === 'orderedList' ? { start: node.attrs?.start, marker: node.attrs?.type } : {}),
    content: node.content?.map(topology),
  });
  expect(topology(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON()))).toEqual(topology(original));
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const restored = await readClipboardFormats(page);
  const restoredNative = JSON.parse(JSON.parse(restored['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(restoredNative.dsl_spacers).toBe(native.dsl_spacers);
  expect(restoredNative.dsl_entitymap).toEqual(native.dsl_entitymap);

  const key = async (value: string) => {
    await page.keyboard.press(value);
    // Navigation/undo changes the native selection after the editor redraws.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  // Real keys, from an empty document: nested Enter exits one level, then the list.
  await editor.focus(); await key('Control+a'); await key('Backspace');
  await key('Control+Shift+7'); await page.keyboard.type('Prima');
  await key('Enter'); await page.keyboard.type('Seconda');
  await key('Home');
  const beforeIndent = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await key('Tab');
  await expect(editor.locator('ol ol')).toHaveCount(1);
  await expect(editor.locator('ol ol')).toHaveCSS('list-style-type', 'lower-alpha');
  await key('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(beforeIndent);
  await key('Control+Shift+z'); await expect(editor.locator('ol ol')).toHaveCount(1);
  await key('Shift+Tab'); await expect(editor.locator('ol ol')).toHaveCount(0);
  await key('Tab'); await key('End');
  await key('Shift+Enter'); await page.keyboard.type('Riga morbida');
  await expect(editor.locator('ol ol br')).toHaveCount(1);
  await key('Enter'); await page.keyboard.type('Terza');
  await key('Enter'); await key('Enter'); await page.keyboard.type('Quarta');
  await key('Enter'); await key('Enter'); await page.keyboard.type('Fuori');
  fs.writeFileSync(testInfo.outputPath('lists-keyboard.json'), JSON.stringify(await editor.evaluate(element => ({ html: element.innerHTML, doc: (element as HTMLElement & { editor: Editor }).editor.getJSON() }))));
  await expect(editor.locator(':scope > ol > li')).toHaveCount(2);
  await expect(editor.locator(':scope > ol > li ol > li')).toHaveCount(2);
  await expect(editor.locator(':scope > p').filter({ hasText: /^Fuori$/ })).toHaveCount(1);
});

test('new nested markers and partial list copies follow the selected text and numbering', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('list_selections.wav'));
  const editor = page.locator('.tiptap-editor');
  const key = async (value: string) => {
    await page.keyboard.press(value);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await editor.focus(); await key('Control+a'); await key('Backspace');
  await key('Control+Shift+7'); await page.keyboard.type('Prima');
  await key('Enter'); await page.keyboard.type('Seconda'); await key('Home'); await key('Tab');
  await expect(editor.locator('ol ol')).toHaveCSS('list-style-type', 'lower-alpha');
  await key('End'); await key('Enter'); await page.keyboard.type('Terza'); await key('Home'); await key('Tab');
  await expect(editor.locator('ol ol ol')).toHaveCSS('list-style-type', 'lower-roman');
  await key('End'); await key('Enter'); await page.keyboard.type('Quarta'); await key('Home'); await key('Shift+Tab');
  await key('Control+a'); await key('Control+c');
  fs.writeFileSync(testInfo.outputPath('new-lists-clipboard.json'), JSON.stringify(await readClipboardFormats(page)));
  await page.screenshot({ path: testInfo.outputPath('new-lists-editor.png') });
  await editor.locator('p').filter({ hasText: /^Quarta$/ }).click(); await key('End');
  const beforeTab = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await key('Tab');
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getText())).toContain('Quarta\t');
  const withTab = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getHTML());
  await key('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(beforeTab);
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, withTab);
  await editor.focus(); await key('Control+a'); await key('Control+v');
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getText())).toContain('Quarta\t');

  const source = '<ol type="A" start="4"><li><p>Prima</p></li><li><p>Seconda</p></li><li><p>Terza</p></li></ol>';
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, source);
  await editor.focus(); await key('Control+a'); await key('Control+v');
  await key('Control+Home'); await key('Control+ArrowDown'); await key('Home'); await key('Control+Shift+End');
  await key('Control+c');
  const subset = await readClipboardFormats(page);
  expect(subset['text/plain'].trim()).toBe('Seconda\nTerza');
  expect(subset['text/html']).toContain('start="5"');
  fs.writeFileSync(testInfo.outputPath('selected-list-clipboard.json'), JSON.stringify(subset));
  await editor.focus();
  const beforeCut = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await key('Control+x'); expect(await readClipboardFormats(page)).toEqual(subset);
  await editor.focus();
  await key('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(beforeCut);
  await key('ArrowLeft'); await key('Home'); await key('Control+Shift+ArrowRight'); await key('Control+c');
  const word = await readClipboardFormats(page);
  expect(word['text/plain']).toBe('Seconda');
  expect(word['text/html']).not.toMatch(/<(ol|li|p)\b/);
  fs.writeFileSync(testInfo.outputPath('selected-word-clipboard.json'), JSON.stringify(word));
  const wordSlice = JSON.parse(JSON.parse(word['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(wordSlice.dsl_spacers).toBe('Seconda');
});

test('native equations retain named functions, operator limits and surrounding formatting', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_equations.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = fs.readFileSync(new URL('./fixtures/editor-parity-equations.html', import.meta.url), 'utf8');
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('h2')).toHaveText('Funzioni e limiti');
  const original = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await readClipboardFormats(page);
  const native = JSON.parse(JSON.parse(copied['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const functions = native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'equation_function').stsl_styles;
  expect(functions.filter(Boolean).map((value: { eqfs_c: string }) => value.eqfs_c)).toEqual([
    '\\sin', '\\cos', '\\tan', '\\arcsin', '\\arccos', '\\arctan', '\\sinh', '\\cosh', '\\tanh', '\\coth', '\\csc', '\\sec', '\\cot', '\\ln', '\\log', '\\exp',
    '\\lima', '\\sumab', '\\intab', '\\prodab', '\\frac', '\\superscript', '\\sin', '\\subscript', '\\log', '\\lima',
  ]);
  functions.forEach((value: unknown, index: number) => { if (value) expect(['\u0019', '\u001f']).toContain(native.dsl_spacers[index]); });
  fs.writeFileSync(testInfo.outputPath('equations-clipboard.json'), JSON.stringify(copied));
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
  expect(await readClipboardFormats(page)).toEqual(copied);
  await expect(editor).toHaveText('');
  await editor.focus(); await page.keyboard.press('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);
  // Reload the HTML copy through the real paste parser: formula source survives.
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, copied['text/html']);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const restoredMath = await editor.evaluate(element => {
    const result: Array<{ type: string; latex: string }> = [];
    (element as HTMLElement & { editor: Editor }).editor.state.doc.descendants(node => {
      if (node.type.name === 'mathInline' || node.type.name === 'mathBlock') result.push({ type: node.type.name, latex: node.attrs.latex });
    });
    return result;
  });
  const sourceMath = await page.evaluate(value => Array.from(new DOMParser().parseFromString(value, 'text/html').querySelectorAll('[data-math], [data-math-block]')).map(node => ({
    type: node.hasAttribute('data-math') ? 'mathInline' : 'mathBlock', latex: node.getAttribute('data-math') ?? node.getAttribute('data-math-block'),
  })), html);
  expect(restoredMath).toEqual(sourceMath);
  await expect(editor.locator('mark')).toHaveCSS('background-color', 'rgb(255, 238, 0)');
  await expect(editor.locator('mark')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const restoredFormats = await readClipboardFormats(page);
  const restoredNative = JSON.parse(JSON.parse(restoredFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(restoredNative.dsl_spacers).toBe(native.dsl_spacers);
  for (const type of ['equation_function', 'paragraph']) {
    expect(restoredNative.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === type)).toEqual(native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === type));
  }
  await page.screenshot({ path: testInfo.outputPath('equations-editor.png') });
});

test('representative mixed document preserves edits, merged table widths, image and equation after save and reopen', async ({ page, context }, testInfo) => {
  test.setTimeout(90000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_representative.wav'));
  const editor = page.locator('.tiptap-editor');
  const imageSource = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const source = fs.readFileSync(new URL('./fixtures/editor-parity-mixed.html', import.meta.url), 'utf8').replace('__IMAGE_SOURCE__', imageSource);
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, source);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('h1')).toHaveText('Lezione sintetica: energia e misure');
  await expect(editor.getByAltText('Campione sintetico')).toBeVisible();
  await expect.poll(() => editor.getByAltText('Campione sintetico').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(editor.locator('td[colspan="2"]')).toHaveText('Conclusione comune alle due colonne');
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    // The backend sanitizer canonicalizes link rel independently of formatting.
    return { html: instance.getHTML().replaceAll('noopener noreferrer nofollow', 'noopener noreferrer'),
      cells: Array.from(root.querySelectorAll('th,td')).map(cell => ({ text: cell.textContent, colspan: cell.getAttribute('colspan'), colwidth: cell.getAttribute('colwidth'), width: cell.getBoundingClientRect().width })),
      image: Array.from(root.querySelectorAll('img')).map(img => ({ sourceWidth: img.naturalWidth, sourceHeight: img.naturalHeight, width: img.getBoundingClientRect().width, height: img.getBoundingClientRect().height })),
    };
  });
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  const original = await read();
  await editor.getByText('Misura da correggere', { exact: true }).click();
  await page.keyboard.press('End'); await page.keyboard.type(': confermata');
  const edited = await read();
  await page.keyboard.press('Control+z'); expect((await read()).html).toBe(original.html);
  await page.keyboard.press('Control+Shift+z'); expect((await read()).html).toBe(edited.html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await readClipboardFormats(page);
  const native = (formats: Record<string, string>) => JSON.parse(JSON.parse(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const resolved = native(copied);
  const table = resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'tbl').stsl_styles.filter(Boolean);
  expect(table).toHaveLength(1);
  expect(table[0].tbls_cols.cv.opValue).toEqual([{ col_wt: 0, col_wv: 157.5 }, { col_wt: 0, col_wv: 292.5 }]);
  expect(resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'cell').stsl_styles.filter(Boolean).map((cell: { cell_cs: number }) => cell.cell_cs)).toEqual([1, 1, 1, 1, 2, 0]);
  expect(resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'equation_function').stsl_styles.filter(Boolean).map((value: { eqfs_c: string }) => value.eqfs_c)).toEqual(['\\frac', '\\superscript']);
  const pixels = await page.evaluate(async value => {
    const img = new Image(); img.src = new DOMParser().parseFromString(value, 'text/html').querySelector('img')!.src; await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, copied['text/html']);
  expect(pixels.width).toBe(222);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
  expect(await readClipboardFormats(page)).toEqual(copied);
  await editor.focus(); await page.keyboard.press('Control+z'); expect((await read()).html).toBe(edited.html);
  await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
  await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
  await page.locator('.queue-card.is-completed', { hasText: 'parity_representative.wav' }).getByRole('heading').click();
  await expect(editor).toBeVisible();
  const reopened = await read();
  expect(reopened.html.replaceAll('rgb(255, 238, 0)', '#ffee00')).toBe(edited.html.replaceAll('rgb(255, 238, 0)', '#ffee00'));
  expect(reopened.cells).toEqual(edited.cells);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const reopenedClipboard = await readClipboardFormats(page);
  expect(native(reopenedClipboard).dsl_spacers).toBe(resolved.dsl_spacers);
  expect(native(reopenedClipboard).dsl_styleslices).toEqual(resolved.dsl_styleslices);
  await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
  const button = await readClipboardFormats(page);
  expect(native(button).dsl_spacers).toBe(resolved.dsl_spacers);
  expect(native(button).dsl_styleslices).toEqual(resolved.dsl_styleslices);
  fs.writeFileSync(testInfo.outputPath('representative-clipboard.json'), JSON.stringify(reopenedClipboard));
  fs.writeFileSync(testInfo.outputPath('representative-app-readback.json'), JSON.stringify({ original, edited, reopened, pixels }));
  await page.screenshot({ path: testInfo.outputPath('representative-app.png') });
});

test('mixed wrap images and captions preserve surrounding content through history, save and clipboard fallback', async ({ page, context }, testInfo) => {
  test.setTimeout(180000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_mixed_wrap.wav'));
  const editor = page.locator('.tiptap-editor');
  const imageSource = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const fixture = fs.readFileSync(new URL('./fixtures/editor-parity-mixed.html', import.meta.url), 'utf8');
  const nativeMime = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    const images: Record<string, unknown>[] = [];
    instance.state.doc.descendants(node => { if (node.type.name === 'floatingImage') images.push(node.attrs); });
    return { html: instance.getHTML().replaceAll('noopener noreferrer nofollow', 'noopener noreferrer').replaceAll('rgb(255, 238, 0)', '#ffee00'),
      images,
      cells: Array.from(root.querySelectorAll('th,td')).map(cell => ({ text: cell.textContent, colspan: cell.getAttribute('colspan'), colwidth: cell.getAttribute('colwidth') })),
    };
  });
  for (const variant of [
    { name: 'wrap-right', position: 100, offsetY: 18, caption: '', native: true },
    { name: 'caption-left', position: 0, offsetY: 18, caption: 'Figura 1: campione sintetico', native: true },
    { name: 'caption-left-negative', position: 0, offsetY: -20, caption: 'Figura 1: campione sintetico', native: true },
    { name: 'caption-left-zero', position: 0, offsetY: 0, caption: 'Figura 1: campione sintetico', native: true },
    { name: 'caption-right-html', position: 100, offsetY: 18, caption: 'Figura 1: campione sintetico', native: false },
  ]) {
    const source = fixture.replace(/<p>Figura del campione:.*?<\/p>/, `<div data-editor-image="true" data-layout="wrap" data-align="${variant.position ? 'right' : 'left'}" data-position="${variant.position}" data-offset-y="${variant.offsetY}" data-width="35" data-caption="${variant.caption}"><img src="__IMAGE_SOURCE__" alt="Campione sintetico"></div><p>Figura del campione: il testo continua accanto alla figura. Le misure restano confrontabili e la didascalia descrive il campione.</p>`).replace('__IMAGE_SOURCE__', imageSource);
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, source);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    await expect.poll(() => editor.getByAltText('Campione sintetico').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await expect(editor.locator('td[colspan="2"]')).toHaveText('Conclusione comune alle due colonne');
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    const original = await read();
    expect(original.images).toHaveLength(1);
    expect(original.images![0]).toMatchObject({ layout: 'wrap', position: variant.position, offsetY: variant.offsetY, caption: variant.caption });
    await expect.poll(() => editor.evaluate(root => root.getBoundingClientRect().height)).toBeLessThan(5000);
    await expect(editor.locator('table .image-wrap-gap')).toHaveCount(0);
    await editor.getByText('Misura da correggere', { exact: true }).click();
    await page.keyboard.press('End'); await page.keyboard.type(': confermata');
    const edited = await read();
    await page.keyboard.press('Control+z'); expect((await read()).html).toBe(original.html);
    await page.keyboard.press('Control+Shift+z'); expect((await read()).html).toBe(edited.html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const copied = await readClipboardFormats(page);
    expect(Boolean(copied[nativeMime])).toBe(variant.native);
    if (variant.native && variant.caption) {
      const resolved = JSON.parse(JSON.parse(copied[nativeMime]).data).resolved;
      expect(resolved.dsl_spacers).toContain('\u0011\n\u0010');
      expect(resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'tbl').stsl_styles.filter(Boolean)[1]).toMatchObject({
        tbls_ftp: { ft_p: { p_vp: { vp_to: variant.offsetY * 0.75 } } },
      });
    }
    expect(copied['text/plain']).toContain('Misura da correggere: confermata');
    if (variant.caption) expect(copied['text/plain']).toContain(variant.caption);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
    expect(await readClipboardFormats(page)).toEqual(copied);
    await editor.focus(); await page.keyboard.press('Control+z'); expect((await read()).html).toBe(edited.html);
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await page.locator('.queue-card.is-completed', { hasText: 'parity_mixed_wrap.wav' }).getByRole('heading').click();
    await expect(editor).toBeVisible();
    await expect.poll(() => editor.evaluate(root => Boolean((root as HTMLElement & { editor?: Editor }).editor))).toBe(true);
    const reopened = await read();
    expect(reopened).toEqual(edited);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
    const reopenedClipboard = await readClipboardFormats(page);
    expect(Boolean(reopenedClipboard[nativeMime])).toBe(variant.native);
    const comparable = (formats: Record<string, string>) => variant.native
      ? JSON.parse(JSON.parse(formats[nativeMime]).data).resolved.dsl_styleslices
      : formats['text/html'].replaceAll('rgb(255, 238, 0)', '#ffee00').replaceAll('noopener noreferrer nofollow', 'noopener noreferrer').replace(/<\/?(?:html|body)>|<head><\/head>/g, '');
    expect(comparable(reopenedClipboard)).toEqual(comparable(copied));
    await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
    const button = await readClipboardFormats(page);
    expect(Boolean(button[nativeMime])).toBe(variant.native);
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-copy-comparison.json`), JSON.stringify({ keyboard: reopenedClipboard, button }));
    expect(comparable(button)).toEqual(comparable(reopenedClipboard));
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-clipboard.json`), JSON.stringify(reopenedClipboard));
    fs.writeFileSync(testInfo.outputPath(`${variant.name}-app-readback.json`), JSON.stringify({ original, edited, reopened }));
    await page.screenshot({ path: testInfo.outputPath(`${variant.name}-app.png`) });
  }
});

test('copy and cut keep the same formats for a mixed document and undo restores it', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_cut.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = '<h2><span style="font-family:Georgia;font-size:18pt;color:#123abc">Titolo scelto</span></h2><p>ana<strong>tom</strong>ia<br>seconda riga</p><ol start="4"><li><p>Quarta voce</p></li><li><p><mark data-color="#ffee00" style="background-color:#ffee00">Evidenziato</mark></p></li></ol><table><tr><td><p>Cella uno</p></td><td><p>Cella due</p></td></tr></table>';
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('h2 span')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await expect(editor.locator('h2 span')).toHaveCSS('font-size', '24px');
  const original = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await readClipboardFormats(page);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+x');
  const cut = await readClipboardFormats(page);
  expect(cut).toEqual(copied);
  await expect(editor).toHaveText('');
  await editor.focus(); await page.keyboard.press('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);
  await page.keyboard.press('Control+f');
  await page.getByPlaceholder('Trova nel documento...').fill('anatomia');
  await expect(page.locator('.find-bar-count')).toHaveText('0 di 1');
  await page.getByTitle('Chiudi (Esc)').click();
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  fs.writeFileSync(testInfo.outputPath('parity-mixed-clipboard.json'), JSON.stringify(await readClipboardFormats(page)));
  await page.screenshot({ path: testInfo.outputPath('parity-mixed-editor.png') });
});

test('context paste preserves HTML and plain paste preserves angle brackets', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_paste.wav'));
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace');
  await page.keyboard.type('Da sostituire'); await page.keyboard.press('Control+a');
  await page.evaluate(async () => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob(['<p><span style="color:#123abc;font-size:16pt"><strong>Testo dal menu</strong></span></p>'], { type: 'text/html' }), 'text/plain': new Blob(['Testo dal menu'], { type: 'text/plain' }) })]); });
  await editor.locator('p').click({ button: 'right', position: { x: 10, y: 10 } });
  await page.locator('.editor-context-menu').getByRole('button', { name: /^Incolla\s*Ctrl/ }).click();
  await expect(editor).toHaveText('Testo dal menu');
  await expect(editor.locator('strong')).toHaveCSS('font-size', '21.3333px');
  await expect(editor.locator('span[style]')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await editor.focus(); await page.keyboard.press('Control+a');
  await page.evaluate(async () => { await navigator.clipboard.writeText('a < b e <testo>'); });
  await editor.locator('strong').click({ button: 'right' });
  await page.locator('.editor-context-menu').getByRole('button', { name: /Incolla senza formattazione/ }).click();
  await expect(editor).toHaveText('a < b e <testo>');
});

test('document defaults and direct colors agree with clipboard and all clear formatting controls preserve structure', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_profile.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = '<h2>Titolo predefinito</h2><p><span style="color:#123abc"><mark data-color="#ffee00" style="background-color:#ffee00">Blu evidenziato</mark></span></p><h4>Quarto livello</h4><h2 style="font-family:Georgia;font-size:24px;font-weight:700;color:#bc321a;line-height:2;margin:30pt 0 12pt">Esplicito</h2><p>Fine</p>';
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('h2').first()).toHaveCSS('font-weight', '700');
  await expect(editor.locator('h2').first()).toHaveCSS('letter-spacing', 'normal');
  await expect(editor.locator('h4')).toHaveCSS('font-size', '16px');
  await expect(editor.locator('p').first()).toHaveCSS('margin-top', '0px');
  await expect(editor.locator('mark')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await expect(editor.getByText('Esplicito', { exact: true })).toHaveCSS('font-size', '24px');
  await expect(editor.getByText('Esplicito', { exact: true })).toHaveCSS('line-height', '48px');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const formats = await readClipboardFormats(page);
  const model = JSON.parse(JSON.parse(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const paragraphs = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean);
  expect(paragraphs[0]).toMatchObject({ ps_ls: 1.15, ps_hd: 2, ps_sb: 18, ps_sa: 6 });
  expect(paragraphs[1]).toMatchObject({ ps_ls: 1.15, ps_sb: 0, ps_sa: 0 });
  await page.screenshot({ path: testInfo.outputPath('profile-explicit-editor.png') });

  const clearHtml = '<h2 style="text-align:center"><strong>Titolo</strong></h2><ol start="4"><li><p><mark data-color="#ffee00"><em>Voce</em></mark></p></li></ol><table><tr><td><p><a href="https://example.com"><b>Link</b></a></p></td></tr></table><p>Fine</p>';
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, clearHtml);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('table')).toBeVisible();
  const original = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  for (const control of ['toolbar', 'keyboard', 'context', 'bubble']) {
    await editor.locator('h2 strong').click();
    await page.keyboard.press('Control+Home');
    // Flush the browser selectionchange from navigation before selecting all.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    await page.keyboard.press('Control+a');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    if (control === 'toolbar') await page.locator('.editor-toolbar [title="Rimuovi formattazione"]').click();
    else if (control === 'keyboard') await page.keyboard.press('Control+Backslash');
    else if (control === 'context') {
      const selected = await editor.evaluate(element => { const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection; return { from, to }; });
      expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.selection.empty), 'document is selected before right click').toBe(false);
      await editor.locator('h2 strong').click({ button: 'right' });
      expect(await editor.evaluate(element => { const { from, to } = (element as HTMLElement & { editor: Editor }).editor.state.selection; return { from, to }; }), 'context keeps the complete selection').toEqual(selected);
      expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.selection.empty), 'context menu keeps the selected document').toBe(false);
      await page.locator('.editor-context-menu').getByRole('button', { name: 'Rimuovi formattazione' }).click();
    } else await page.locator('.editor-bubble-menu [title="Rimuovi formattazione"]').click();
    await expect(editor.locator('h2')).toHaveText('Titolo');
    await expect(editor.locator('h2'), control).toHaveCSS('text-align', 'start');
    await expect(editor.locator('ol')).toHaveAttribute('start', '4');
    await expect(editor.locator('a')).toHaveAttribute('href', /^https:\/\/example\.com\/?$/);
    await expect(editor.locator('strong,em,mark'), control).toHaveCount(0);
    await expect(editor.locator('table')).toHaveCount(1);
    await editor.focus(); await page.keyboard.press('Control+z');
    expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);
  }
});

test('partial clear and empty caret preserve paragraph layout, future typing and undo', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('parity_partial_clear.wav'));
  const editor = page.locator('.tiptap-editor');
  const html = '<p data-document-line-spacing="1.6" style="font-family:Georgia;font-size:18pt;font-weight:700;font-style:italic;color:#123abc;text-align:center;line-height:1.92;margin-top:8pt;margin-bottom:10pt">Prima SCELTA dopo</p>';
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const original = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  const originalHeight = (await editor.locator('p').boundingBox())!.height;
  await page.keyboard.press('Control+Home');
  for (let n = 0; n < 6; n++) await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+Shift+ArrowRight');
  await expect.poll(() => editor.evaluate(element => { const { state } = (element as HTMLElement & { editor: Editor }).editor; return state.doc.textBetween(state.selection.from, state.selection.to); })).toBe('SCELTA ');
  await page.keyboard.press('Control+Backslash');
  await expect(editor.locator('p')).toHaveCSS('text-align', 'center');
  await expect(editor.locator('p')).toHaveCSS('margin-top', '10.6667px');
  await expect(editor.locator('p')).toHaveCSS('margin-bottom', '13.3333px');
  expect((await editor.locator('p').boundingBox())!.height).toBeCloseTo(originalHeight, 1);
  await expect(editor.locator('p span').first()).toHaveCSS('font-family', 'Georgia');
  const partial = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const copied = await readClipboardFormats(page);
  fs.writeFileSync(testInfo.outputPath('partial-clear-clipboard.json'), JSON.stringify(copied));
  await editor.focus(); await page.keyboard.press('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);

  await page.keyboard.press('Control+Home');
  for (let n = 0; n < 6; n++) await page.keyboard.press('ArrowRight');
  await expect.poll(() => editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.state.selection.empty)).toBe(true);
  await page.keyboard.press('Control+Backslash'); await page.keyboard.type('NUOVO');
  await expect(editor).toHaveText('Prima NUOVOSCELTA dopo');
  const typed = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON().content![0].content!);
  expect(typed.find(node => node.text === 'NUOVO')?.marks).toBeUndefined();
  await expect(editor.locator('p')).toHaveCSS('text-align', 'center');
  expect((await editor.locator('p').boundingBox())!.height).toBeCloseTo(originalHeight, 1);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  fs.writeFileSync(testInfo.outputPath('caret-clear-clipboard.json'), JSON.stringify(await readClipboardFormats(page)));
  await editor.focus(); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
  expect(await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON())).toEqual(original);

  // Restore the partial result through the editor's real formatted paste path.
  await page.evaluate(async formats => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([formats['text/html']], { type: 'text/html' }) })]); }, copied);
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const restored = await editor.evaluate(element => (element as HTMLElement & { editor: Editor }).editor.getJSON());
  expect(restored.content![0].content).toEqual(partial.content![0].content);
  await expect(editor.locator('p')).toHaveCSS('text-align', 'center');
  expect((await editor.locator('p').boundingBox())!.height).toBeCloseTo(originalHeight, 1);
  await page.screenshot({ path: testInfo.outputPath('partial-clear-editor.png') });
});

for (const layout of ['inline', 'wrap']) {
  test(`${layout} resize keeps opposite edges fixed for all eight handles`, async ({ page, context }, testInfo) => {
    test.setTimeout(120000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openImageEditor(page, testInfo.outputPath(`${layout}_anchors.wav`));
    const editor = page.locator('.tiptap-editor');
    const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
    const html = `<p>Paragrafo prima dell'immagine.</p><p>Prima <span data-editor-image data-layout="${layout}" data-width="35" data-position="45" data-offset-y="${layout === 'wrap' ? 80 : 0}"><img src="${src}" alt="Resize ancorato"></span>${' Testo attorno alla figura.'.repeat(20)}</p><p>Fine documento.</p>`;
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    const image = editor.getByAltText('Resize ancorato');
    const node = editor.locator('.editor-image-node');
    await image.click();
    const accentColor = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent-bg)';
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    const close = (actual: number, expected: number) => expect(Math.abs(actual - expected)).toBeLessThan(1.2);
    for (const handleName of ['tl', 'tc', 'tr', 'ml', 'mr', 'bl', 'bc', 'br']) {
      for (const delta of [15, -15]) {
        const initial = (await image.boundingBox())!;
        const handle = (await node.locator(`.editor-image-resize-handle-${handleName}`).boundingBox())!;
        const x = handle.x + handle.width / 2, y = handle.y + handle.height / 2;
        const dx = handleName.endsWith('l') ? -delta : delta;
        const dy = handleName.startsWith('t') ? -delta : delta;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy, { steps: 4 });
        const ghost = page.locator('.editor-image-resize-preview');
        const preview = (await ghost.locator('img').boundingBox())!;
        if (handleName === 'tc' || handleName === 'bc') close(preview.width, initial.width);
        else if (handleName === 'ml' || handleName === 'mr') close(preview.height, initial.height);
        else close(preview.width / preview.height, initial.width / initial.height);
        close(handleName.endsWith('l') ? preview.x + preview.width : preview.x, handleName.endsWith('l') ? initial.x + initial.width : initial.x);
        close(handleName.startsWith('t') ? preview.y + preview.height : preview.y, handleName.startsWith('t') ? initial.y + initial.height : initial.y);
        expect(await ghost.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
        expect(await ghost.evaluate(el => getComputedStyle(el).outlineColor)).toBe(accentColor);
        if (handleName === 'br' && delta > 0) await page.screenshot({ path: testInfo.outputPath(`${layout}-anchored-resize.png`) });
        await page.mouse.up();
        await expect(ghost).toHaveCount(0);
        await expect.poll(async () => Math.abs((await image.boundingBox())!.width - preview.width)).toBeLessThan(1.2);
        const final = (await image.boundingBox())!;
        close(final.height, preview.height);
        close(final.x, preview.x);
        expect(Math.abs(final.y - preview.y), JSON.stringify({ handleName, delta, initial, preview, final, offsets: await node.evaluate(el => ({ x: el.getAttribute('data-offset-x'), y: el.getAttribute('data-offset-y') })) })).toBeLessThan(1.2);
        await page.keyboard.press('Control+z');
        await expect(node).toHaveAttribute('data-width', '35');
        await expect(node).not.toHaveAttribute('data-aspect-ratio');
        await expect.poll(async () => Math.abs((await image.boundingBox())!.y - initial.y)).toBeLessThan(1.2);
      }
    }
  });

  test(`${layout} resize previews without changing document layout until release`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openImageEditor(page, testInfo.outputPath(`${layout}_resize.wav`));
    const editor = page.locator('.tiptap-editor');
    const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
    const html = `<p><span data-editor-image data-layout="${layout}" data-width="35"><img src="${src}" alt="Resize fluido"></span>${'Testo attorno alla figura. '.repeat(40)}</p>${`<p>${'Documento lungo da impaginare. '.repeat(30)}</p>`.repeat(25)}`;
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    const image = editor.getByAltText('Resize fluido');
    const node = editor.locator('.editor-image-node');
    await image.click();
    if (layout === 'wrap') await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
    const initial = (await image.boundingBox())!;
    const handle = (await node.locator('.editor-image-resize-handle-mr').boundingBox())!;
    const startX = handle.x + handle.width / 2, startY = handle.y + handle.height / 2;
    await page.mouse.move(startX, startY); await page.mouse.down();
    await editor.evaluate(root => {
      const original = root.cloneNode.bind(root);
      root.dataset.resizeClones = '0';
      root.cloneNode = deep => { root.dataset.resizeClones = String(Number(root.dataset.resizeClones) + 1); return original(deep); };
    });
    await page.mouse.move(startX + 40, startY, { steps: 8 });
    await expect(node).toHaveAttribute('data-width', '35');
    expect((await image.boundingBox())!.width).toBeCloseTo(initial.width, 1);
    await expect(editor).toHaveAttribute('data-resize-clones', '0');
    const preview = page.locator('.editor-image-resize-preview img');
    expect((await preview.boundingBox())!.width).toBeGreaterThan(initial.width + 35);
    await page.screenshot({ path: testInfo.outputPath(`${layout}-resize-preview.png`) });
    await page.mouse.up();
    await expect(page.locator('.editor-image-resize-preview')).toHaveCount(0);
    await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(initial.width + 35);
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('data-width', '35');
    const cancelHandle = (await node.locator('.editor-image-resize-handle-mr').boundingBox())!;
    await page.mouse.move(cancelHandle.x + 4, cancelHandle.y + 4); await page.mouse.down();
    await page.mouse.move(cancelHandle.x + 35, cancelHandle.y + 4, { steps: 4 });
    await expect(page.locator('.editor-image-resize-preview')).toHaveCount(1);
    await page.keyboard.press('Escape'); await page.mouse.up();
    await expect(page.locator('.editor-image-resize-preview')).toHaveCount(0);
    await expect(node).toHaveAttribute('data-width', '35');
    await expect(editor).toBeVisible();
  });
}

test('wrap guides snap to all three text alignments and clear on drop and Escape', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('alignment_guides.wav'));
  const editor = page.locator('.tiptap-editor');
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const html = `<p><span data-editor-image data-layout="wrap" data-width="35"><img src="${src}" alt="Guide allineamento"></span>${'Testo attorno alla figura. '.repeat(30)}</p><p>Fine documento</p>`;
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const image = editor.getByAltText('Guide allineamento');
  const node = editor.locator('.editor-image-node');
  await image.click();
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  const content = (await editor.locator('p').first().boundingBox())!;
  for (const [align, position] of [['left', '0'], ['center', '50'], ['right', '100']] as const) {
    const start = (await image.boundingBox())!;
    const left = content.x + (content.width - start.width) * Number(position) / 100;
    const x = left + 25 + (align === 'right' ? -4 : 4);
    await page.mouse.move(start.x + 25, start.y + 30); await page.mouse.down();
    await page.mouse.move(x, start.y + 50, { steps: 5 });
    const guide = page.locator('.editor-image-alignment-guide');
    await expect(guide).toHaveAttribute('data-align', align);
    const preview = (await page.locator('.editor-image-drag-preview img').boundingBox())!;
    expect(preview.x).toBeCloseTo(left, 0);
    const line = (await guide.boundingBox())!;
    const expectedLine = align === 'left' ? content.x : align === 'right' ? content.x + content.width : content.x + content.width / 2;
    expect(line.x).toBeCloseTo(expectedLine, 0);
    const viewport = (await page.locator('.editor-page-container').boundingBox())!;
    expect(line.y).toBeGreaterThanOrEqual(viewport.y - 1);
    expect(line.y + line.height).toBeLessThanOrEqual(viewport.y + viewport.height + 1);
    if (align === 'center') await page.screenshot({ path: testInfo.outputPath('wrap-center-guide.png') });
    await page.mouse.up();
    await expect(guide).toHaveCount(0);
    await expect(node).toHaveAttribute('data-position', position);
    await expect.poll(async () => (await image.boundingBox())!.x).toBeCloseTo(left, 0);
    await page.keyboard.press('Control+z');
    await expect(node).toHaveAttribute('data-position', '50');
    await expect(node).toHaveAttribute('data-offset-y', '0');
  }
  const start = (await image.boundingBox())!;
  await page.mouse.move(start.x + 25, start.y + 30); await page.mouse.down();
  await page.mouse.move(content.x + 29, start.y + 50, { steps: 5 });
  await expect(page.locator('.editor-image-alignment-guide')).toHaveCount(1);
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect(page.locator('.editor-image-alignment-guide, .editor-image-drag-preview')).toHaveCount(0);
  await expect(node).toHaveAttribute('data-position', '50');
  await expect(editor).toContainText('Fine documento');
});

for (const layout of ['inline', 'wrap']) {
  test(`${layout} image drag scrolls both edges with a stationary pointer and stops on release`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openImageEditor(page, testInfo.outputPath(`${layout}_scroll.wav`));
    const editor = page.locator('.tiptap-editor');
    const viewport = page.locator('.editor-page-container');
    const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
    const html = `<p><span data-editor-image data-layout="${layout}" data-width="35"><img src="${src}" alt="Scroll drag"></span>${'Testo iniziale. '.repeat(20)}</p>${`<p>${'Contenuto del documento lungo. '.repeat(20)}</p>`.repeat(35)}`;
    await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
    await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
    const image = editor.getByAltText('Scroll drag');
    await image.click();
    await expect(page.getByRole('button', { name: 'In-line', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wrap', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${layout}-toolbar.png`) });
    await viewport.evaluate(el => { el.scrollTop = 0; });
    const start = (await image.boundingBox())!;
    const bounds = (await viewport.boundingBox())!;
    const x = start.x + 25;
    const scrollTop = () => viewport.evaluate(el => el.scrollTop);
    await page.mouse.move(x, start.y + 30); await page.mouse.down();
    await page.mouse.move(x + 10, start.y + 40, { steps: 3 });
    await page.mouse.move(x, bounds.y + bounds.height - 2, { steps: 6 });
    await expect.poll(scrollTop).toBeGreaterThan(150);
    const first = await scrollTop();
    await expect.poll(scrollTop).toBeGreaterThan(first + 150);
    const lower = await scrollTop();
    await page.mouse.move(x, bounds.y + 2, { steps: 6 });
    await expect.poll(scrollTop).toBeLessThan(lower - 100);
    await page.mouse.move(x, bounds.y + bounds.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(editor.locator('.editor-image-node')).toHaveCount(1);
    await expect(page.locator('.editor-image-drag-preview')).toHaveCount(0);
    const stopped = await scrollTop();
    await page.waitForTimeout(250);
    expect(await scrollTop()).toBeCloseTo(stopped, 0);
    await page.keyboard.press('Control+z');
    await expect(editor.locator('p').first().getByAltText('Scroll drag')).toHaveCount(1);
    await expect(editor.locator('.editor-image-node')).toHaveCount(1);
  });
}

test('inline selection keeps the image and its handles at the same position after wrap', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('selection.wav'));
  const editor = page.locator('.tiptap-editor');
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const html = `<p>Prima della figura</p><p><span data-editor-image data-width="35"><img src="${src}" alt="Selezione stabile"></span>${' Dopo la figura. '.repeat(30)}</p><p>Paragrafo seguente</p>`;
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const image = editor.getByAltText('Selezione stabile');
  const before = (await image.boundingBox())!;
  await image.click();
  const selected = (await image.boundingBox())!;
  expect(Math.max(Math.abs(selected.x - before.x), Math.abs(selected.y - before.y))).toBeLessThan(1);
  await page.getByRole('button', { name: 'Wrap', exact: true }).click();
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  await page.getByRole('button', { name: 'In-line', exact: true }).click();
  await expect(editor.locator('.image-wrap-gap')).toHaveCount(0);
  const handle = (await editor.locator('.editor-image-resize-handles').boundingBox())!;
  const inline = (await image.boundingBox())!;
  expect(Math.max(Math.abs(handle.x - inline.x), Math.abs(handle.y - inline.y))).toBeLessThan(1);
  expect(Math.abs(inline.x - before.x)).toBeLessThan(1);
  expect(Math.abs(inline.y - before.y)).toBeLessThan(1);
  await editor.locator('p').last().click();
  const deselected = (await image.boundingBox())!;
  await image.click();
  const reselected = (await image.boundingBox())!;
  expect(Math.max(Math.abs(reselected.x - deselected.x), Math.abs(reselected.y - deselected.y))).toBeLessThan(1);
  await page.evaluate(() => {
    const original = DataTransfer.prototype.setDragImage;
    DataTransfer.prototype.setDragImage = function(element, x, y) {
      document.body.dataset.inlineGhost = JSON.stringify({ x, y, width: (element as HTMLElement).getBoundingClientRect().width, controls: !!element.querySelector('.editor-image-resize-handles, .editor-image-toolbar') });
      return original.call(this, element, x, y);
    };
  });
  const destination = (await editor.locator('p').last().boundingBox())!;
  await page.mouse.move(reselected.x + 25, reselected.y + 30); await page.mouse.down();
  await page.mouse.move(reselected.x + 35, reselected.y + 35, { steps: 3 });
  await page.mouse.move(destination.x + 25, destination.y + 10, { steps: 5 });
  const nativeGhost = JSON.parse((await page.locator('body').getAttribute('data-inline-ghost'))!);
  expect(nativeGhost.controls).toBe(false);
  expect(nativeGhost.width).toBeCloseTo(reselected.width, 0);
  expect(nativeGhost.x).toBeGreaterThan(0);
  expect(nativeGhost.x).toBeLessThan(reselected.width);
  expect(nativeGhost.y).toBeGreaterThan(0);
  expect(nativeGhost.y).toBeLessThan(reselected.height);
  const duringNativeDrag = (await image.boundingBox())!;
  expect(duringNativeDrag.x).toBeCloseTo(reselected.x, 1);
  expect(duringNativeDrag.y).toBeCloseTo(reselected.y, 1);
  await page.mouse.up();
  await expect(editor.locator('p').last().getByAltText('Selezione stabile')).toHaveCount(1);
  await expect(editor.locator('.editor-image-node')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('p').nth(1).getByAltText('Selezione stabile')).toHaveCount(1);
});

test('wrap dragging moves immediately without cloning the document on pointer movement', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('drag_preview.wav'));
  const editor = page.locator('.tiptap-editor');
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const html = `<p><span data-editor-image data-layout="wrap" data-width="35"><img src="${src}" alt="Anteprima fluida"></span>${'Testo vicino alla figura. '.repeat(40)}</p>${`<p>${'Documento lungo da impaginare. '.repeat(40)}</p>`.repeat(30)}`;
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  const image = editor.getByAltText('Anteprima fluida');
  await image.click();
  await editor.evaluate(root => {
    const original = root.cloneNode.bind(root);
    root.dataset.previewClones = '0';
    root.cloneNode = deep => { root.dataset.previewClones = String(Number(root.dataset.previewClones) + 1); return original(deep); };
  });
  const start = (await image.boundingBox())!;
  await page.mouse.move(start.x + 25, start.y + 30); await page.mouse.down();
  await page.mouse.move(start.x + 75, start.y + 90, { steps: 8 });
  const preview = (await page.locator('.editor-image-drag-preview img').boundingBox())!;
  expect(Math.abs(preview.x - start.x - 50)).toBeLessThan(2);
  expect(Math.abs(preview.y - start.y - 60)).toBeLessThan(2);
  await expect(editor).toHaveAttribute('data-preview-clones', '0');
  const original = (await image.boundingBox())!;
  expect(original.x).toBeCloseTo(start.x, 1);
  expect(original.y).toBeCloseTo(start.y, 1);
  await expect(page.locator('.editor-image-drag-preview .editor-image-resize-handles, .editor-image-drag-preview .editor-image-toolbar')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('image-drag-shadow.png') });
  await page.mouse.up();
  await expect(page.locator('.editor-image-drag-preview')).toHaveCount(0);
  await expect(editor.locator('.editor-image-node')).not.toHaveAttribute('data-drag-top', /.+/);
  await expect.poll(async () => Number(await editor.getAttribute('data-preview-clones'))).toBeGreaterThan(0);
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

for (const native of [true, false]) {
  test(`Ctrl+C resamples image pixels synchronously for ${native ? 'native format' : 'HTML fallback'} copy`, async ({ page, context }, testInfo) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openImageEditor(page, testInfo.outputPath(`resample_${native}.wav`));
    const source = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 1600;
      canvas.height = 1000;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#4D96FF';
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.85);
    });
    // A centered wrapping caption deliberately selects the HTML fallback.
    const html = `<p>Prima <span data-editor-image="true" data-layout="${native ? 'inline' : 'wrap'}" data-position="50" data-width="20"><img src="${source}" alt="Figura da ricampionare">${native ? '' : '<span class="editor-image-caption">Didascalia</span>'}</span> dopo.</p>`;
    await page.evaluate(async value => {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]);
    }, html);
    const editor = page.locator('.tiptap-editor');
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+v');
    const original = editor.getByAltText('Figura da ricampionare');
    await expect(original).toBeVisible();
    await expect.poll(() => original.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1600);
    await editor.focus();
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    const keyboardFormats = await readClipboardFormats(page);
    const sliceMime = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
    expect(Boolean(keyboardFormats[sliceMime])).toBe(native);
    const dimensions = (html: string) => page.evaluate(async value => {
      const copied = new DOMParser().parseFromString(value, 'text/html').querySelector('img')!;
      const image = new Image();
      image.src = copied.getAttribute('src')!;
      await image.decode();
      return { declaredWidth: copied.getAttribute('width'), width: image.naturalWidth, height: image.naturalHeight };
    }, html);
    expect(await dimensions(keyboardFormats['text/html'])).toEqual({ declaredWidth: '127', width: 127, height: 79 });
    await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
    const buttonFormats = await readClipboardFormats(page);
    expect(await dimensions(buttonFormats['text/html'])).toEqual(await dimensions(keyboardFormats['text/html']));
    expect(Boolean(buttonFormats[sliceMime])).toBe(native);
    expect(await original.getAttribute('src') === source).toBe(true);
    expect(await original.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1600);
    // A later clipboard write must remain intact after the copy event finishes.
    await page.evaluate(async () => {
      await navigator.clipboard.writeText('Copia successiva');
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Copia successiva');
  });
}

test('text-only copy exports standalone styles through keyboard, button and browser paste', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('portable_text.wav'));
  const html = '<h3>Sezione portabile</h3><p>Primo <strong>grassetto</strong> e <span style="font-family:Georgia;font-size:16pt;color:#123abc">personalizzato</span>.</p><p>Secondo paragrafo</p><ul><li><p>Voce uno</p></li><li><p>Voce due</p></li></ul><table><tr><td><p>Cella A</p><p>Cella B</p></td><td><p>Cella C</p></td></tr></table>';
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByText('personalizzato')).toBeVisible();
  await expect(editor.getByText('personalizzato')).toHaveCSS('color', 'rgb(18, 58, 188)');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const keyboardFormats = await readClipboardFormats(page);
  const sliceMime = 'application/x-vnd.google-docs-document-slice-clip+wrapped';
  expect(keyboardFormats[sliceMime]).toBeTruthy();
  await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
  const buttonFormats = await readClipboardFormats(page);
  expect(buttonFormats['text/html']).toBe(keyboardFormats['text/html']);
  const resolved = (formats: Record<string, string>) => JSON.parse(JSON.parse(formats[sliceMime]).data).resolved;
  expect(resolved(buttonFormats).dsl_spacers).toBe(resolved(keyboardFormats).dsl_spacers);
  expect(resolved(buttonFormats).dsl_styleslices).toEqual(resolved(keyboardFormats).dsl_styleslices);
  fs.writeFileSync(testInfo.outputPath('portable-text-clipboard.json'), JSON.stringify(buttonFormats));
  // A separate document with no app stylesheet verifies the portable HTML path.
  const destination = await context.newPage();
  await destination.goto('/');
  await destination.setContent('<html><body><div contenteditable="true" id="destination"></div></body></html>');
  await destination.locator('#destination').focus();
  await destination.keyboard.press('Control+v');
  await expect(destination.getByText('Sezione portabile')).toBeVisible();
  const pasted = await destination.locator('#destination').evaluate(root => {
    const title = root.querySelector('h3')!;
    const custom = Array.from(root.querySelectorAll('span')).find(el => el.textContent === 'personalizzato')!;
    return { titleSize: getComputedStyle(title).fontSize, font: getComputedStyle(custom).fontFamily,
      size: getComputedStyle(custom).fontSize, color: getComputedStyle(custom).color,
      paragraphs: root.querySelectorAll('p').length, cells: root.querySelectorAll('td').length,
      bold: Array.from(root.querySelectorAll('*')).some(el => el.textContent === 'grassetto' && Number(getComputedStyle(el).fontWeight) >= 700) };
  });
  expect(pasted).toMatchObject({ titleSize: '18.6667px', font: 'Georgia', size: '21.3333px', color: 'rgb(18, 58, 188)', paragraphs: 8, cells: 2, bold: true });
  await destination.screenshot({ path: testInfo.outputPath('portable-browser-paste.png') });
  await destination.close();
});

test('native copy retains body leading and a small vertical wrap offset', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('leading_wrap.wav'));
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const text = 'Il documento di prova contiene un paragrafo abbastanza lungo per osservare come il testo scorre accanto alla figura. La conversione conserva il font, la distanza fra le righe e la separazione dei paragrafi. Le prime righe devono occupare lo stesso spazio previsto nell’editor, anche quando la figura parte poco sotto l’inizio del paragrafo. La verifica comprende il titolo successivo e un elenco con voci di lunghezza diversa.';
  const html = `<h1>Verifica formattazione comune</h1><h2>Testo e immagine</h2><p><span data-editor-image data-layout="wrap" data-align="right" data-position="100" data-width="56" data-offset-y="18"><img src="${src}" alt="Figura per interlinea"></span>${text}</p><p></p><h3>Sezione successiva</h3><p>Il testo continua dopo il primo paragrafo e conserva la stessa interlinea.</p><ul><li><p>Prima voce con testo breve.</p></li><li><p>Seconda voce con testo abbastanza lungo da andare a capo nella pagina e verificare anche l’interlinea degli elenchi.</p></li></ul>`;
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByAltText('Figura per interlinea')).toBeVisible();
  await expect(editor.locator('.image-wrap-gap').first()).toBeAttached();
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const formats = await readClipboardFormats(page);
  const model = JSON.parse(JSON.parse(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const paragraphs = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean);
  expect(paragraphs[2].ps_ls).toBe(1.15);
  expect(Object.values(model.dsl_entitymap)).toContainEqual(expect.objectContaining({ pe_to: 10.5, pe_lo: 197.25 }));
  await page.keyboard.press('ArrowLeft');
  fs.writeFileSync(testInfo.outputPath('leading-wrap-metrics.json'), JSON.stringify(await editor.evaluate(root => Array.from(root.querySelectorAll('h1,h2,h3,p,.editor-image-surface')).map(el => ({tag:el.tagName, rect:el.getBoundingClientRect().toJSON(),font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,weight:getComputedStyle(el).fontWeight,lineHeight:getComputedStyle(el).lineHeight, text:el.textContent?.slice(0,35)})))));
  await page.screenshot({ path: testInfo.outputPath('leading-wrap-editor.png') });
  fs.writeFileSync(testInfo.outputPath('leading-wrap-clipboard.json'), JSON.stringify(Object.entries(formats).map(([mimeType, text]) => ({ mimeType, text }))));
});

test('native copy preserves paragraph and list gaps with converted line spacing', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openImageEditor(page, testInfo.outputPath('paragraph_spacing.wav'));
  const src = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const html = `<h3>Struttura e Filosofia dell'Esame</h3><p>${'Gli esami si svolgono in una sessione orale. Le domande collegano le diverse discipline e richiedono una comprensione dei meccanismi. '.repeat(3)}</p><p>L'esame consiste in tre domande: due con risposta dettagliata e una con risposta concisa.</p><ul><li><p><strong>Esempio di domanda breve:</strong> descrivere un deficit vitaminico.</p></li><li><p><strong>Esempio di domanda grande:</strong> descrivere un processo e le sue conseguenze, collegando gli argomenti del corso.</p></li></ul><p><span data-editor-image="true" data-layout="wrap" data-align="right" data-position="100" data-width="20"><img src="${src}" alt="Figura di prova"></span>${'Alcuni argomenti vengono introdotti in anticipo. Gli studenti devono collegare i contenuti delle lezioni e ripassare i vari argomenti. '.repeat(2)}</p><p>${'Per gli studenti in difficoltà sono previste altre possibilità di concordare un esame. La preparazione richiede una comprensione completa dei contenuti. '.repeat(2)}</p>`;
  await page.evaluate(async value => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([value], { type: 'text/html' }) })]); }, html);
  const editor = page.locator('.tiptap-editor');
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByAltText('Figura di prova')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('paragraph-spacing-editor.png') });
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const formats = await readClipboardFormats(page);
  const model = JSON.parse(JSON.parse(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const paragraphs = model.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean);
  expect(paragraphs).toHaveLength(7);
  for (const paragraph of paragraphs.slice(1)) {
    expect(paragraph.ps_ls).toBe(1.15);
  }
  expect(paragraphs[0]).toMatchObject({ ps_ls: 1.15, ps_sb: 16, ps_sa: 4 });
  for (const paragraph of paragraphs.slice(1, -1)) expect(paragraph).toMatchObject({ ps_ls: 1.15, ps_sb: 0, ps_sa: 0 });
  for (const paragraph of paragraphs.slice(3, 5)) expect(paragraph).toMatchObject({ ps_sm: 1 });
  expect(paragraphs.at(-1)).toMatchObject({ ps_ls: expect.any(Number), ps_sb: 0, ps_sa: 0 });
  fs.writeFileSync(testInfo.outputPath('paragraph-spacing-clipboard.json'), JSON.stringify(Object.entries(formats).map(([mimeType, text]) => ({ mimeType, text }))));
  await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
  const buttonFormats = await readClipboardFormats(page);
  const buttonModel = JSON.parse(JSON.parse(buttonFormats['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(buttonModel.dsl_spacers).toBe(model.dsl_spacers);
  expect(buttonModel.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean)).toEqual(paragraphs);
});

test('inline and arbitrary image wrap preserve text, editing, undo and native clipboard', async ({ page, context }, testInfo) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('image_layout.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await page.goto('/');
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooserPromise).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'image_layout.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await expect(completed).toHaveClass(/cursor-pointer/);
  await completed.getByRole('heading', { name: 'image_layout.wav' }).click();
  const editor = page.locator('.tiptap-editor');
  await expect(editor).toBeVisible();
  const imageSrc = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/image-layout.jpg', import.meta.url)).toString('base64')}`;
  const source = `<p>Prima dell'immagine</p><p><span data-editor-image="true" data-width="35"><img alt="Immagine di verifica" src="${imageSrc}"></span>${'Testo che deve scorrere a fianco della figura, mantenendo la leggibilita. '.repeat(12)}</p><p>Ultimo paragrafo</p>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, source);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
  const image = editor.getByAltText('Immagine di verifica');
  const node = editor.locator('.editor-image-node');
  await expect(node).toHaveAttribute('data-layout', 'inline');
  await image.click();
  await page.getByRole('button', { name: 'Wrap', exact: true }).click();
  await expect(node).toHaveAttribute('data-position', '50');
  await expect.poll(async () => editor.evaluate(root => {
    const img = root.querySelector('img')!.getBoundingClientRect();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let left = 0, right = 0, collisions = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[contenteditable="false"], [data-editor-image]')) continue;
      for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        for (const r of range.getClientRects()) {
          if (r.bottom <= img.top || r.top >= img.bottom) continue;
          if (r.right <= img.left) left++;
          else if (r.left >= img.right) right++;
          else collisions++;
        }
      }
    }
    return { left: left > 0, right: right > 0, collisions };
  })).toEqual({ left: true, right: true, collisions: 0 });
  await page.screenshot({ path: testInfo.outputPath('image-wrap-center.png') });
  await page.evaluate(() => { document.body.dataset.imageNativeDrags = '0'; document.addEventListener('dragstart', () => { document.body.dataset.imageNativeDrags = String(Number(document.body.dataset.imageNativeDrags) + 1); }); });
  const from = (await image.boundingBox())!;
  const grabX = from.width * 0.17, grabY = from.height * 0.31;
  const cursor = { x: from.x + grabX + 70, y: from.y + grabY + 65 };
  await page.mouse.move(from.x + grabX, from.y + grabY);
  await page.mouse.down();
  expect((await image.boundingBox())!.x).toBeCloseTo(from.x, 0);
  expect((await image.boundingBox())!.y).toBeCloseTo(from.y, 0);
  await page.mouse.move(cursor.x, cursor.y, { steps: 15 });
  await expect.poll(async () => { const rect = (await page.locator('.editor-image-drag-preview img').boundingBox())!; return Math.max(Math.abs(rect.x + grabX - cursor.x), Math.abs(rect.y + grabY - cursor.y)); }).toBeLessThan(2);
  await expect(page.locator('.prosemirror-dropcursor-block, .prosemirror-dropcursor-inline')).toHaveCount(0);
  await expect(page.locator('body')).toHaveAttribute('data-image-native-drags', '0');
  await expect(page.getByRole('toolbar', { name: 'Disposizione immagine' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('image-drag-aligned.png') });
  await page.mouse.up();
  await expect.poll(async () => { const rect = (await image.boundingBox())!; return Math.max(Math.abs(rect.x + grabX - cursor.x), Math.abs(rect.y + grabY - cursor.y)); }).toBeLessThan(3);
  await expect(node).toHaveCount(1);
  await expect(node).not.toHaveAttribute('data-position', '50');
  await expect(editor).toContainText('Ultimo paragrafo');
  await page.keyboard.press('Control+z');
  await expect(node).toHaveAttribute('data-position', '50');
  await expect(node).toHaveAttribute('data-offset-y', '0');

  // Moving into a later paragraph must preserve the same grab point despite
  // reflow above the destination. The gesture commits as one undo operation.
  const nextTarget = (await editor.locator('p').last().boundingBox())!;
  const secondStart = (await image.boundingBox())!;
  const secondCursor = { x: secondStart.x + 25 + grabX, y: nextTarget.y + 8 + grabY };
  await page.mouse.move(secondStart.x + grabX, secondStart.y + grabY);
  await page.mouse.down(); await page.mouse.move(secondCursor.x, secondCursor.y, { steps: 12 });
  await expect.poll(async () => { const rect = (await page.locator('.editor-image-drag-preview img').boundingBox())!; return Math.max(Math.abs(rect.x + grabX - secondCursor.x), Math.abs(rect.y + grabY - secondCursor.y)); }).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(async () => { const rect = (await image.boundingBox())!; return Math.max(Math.abs(rect.x + grabX - secondCursor.x), Math.abs(rect.y + grabY - secondCursor.y)); }).toBeLessThan(3);
  await page.keyboard.press('Control+z');
  await expect(node).toHaveAttribute('data-position', '50');
  await expect(node).toHaveAttribute('data-offset-y', '0');
  const cancelled = (await image.boundingBox())!;
  await page.mouse.move(cancelled.x + grabX, cancelled.y + grabY); await page.mouse.down();
  await page.mouse.move(cancelled.x + grabX - 40, cancelled.y + grabY + 55, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => { const rect = (await image.boundingBox())!; return Math.max(Math.abs(rect.x - cancelled.x), Math.abs(rect.y - cancelled.y)); }).toBeLessThan(2);
  await expect(page.locator('.editor-image-drag-preview')).toHaveCount(0);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const nativeCopy = await readClipboardFormats(page);
  const nativeSlice = JSON.parse(JSON.parse(nativeCopy['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(nativeSlice.dsl_spacers).toContain('Ultimo paragrafo');
  const paragraphStyles = nativeSlice.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean);
  expect(paragraphStyles.length).toBeGreaterThan(0);
  expect(paragraphStyles).toEqual([
    expect.objectContaining({ ps_ls: 1.15, ps_sb: 0, ps_sa: 0 }),
    expect.objectContaining({ ps_ls: 1.15, ps_sb: 0, ps_sa: 0 }),
    expect.objectContaining({ ps_ls: expect.any(Number), ps_sb: 0, ps_sa: 0 }),
  ]);
  expect(Object.values(nativeSlice.dsl_entitymap)).toEqual([expect.objectContaining({ pe_l: 0, pe_lo: 142.5 })]);
  expect(nativeCopy['text/html']).not.toContain('image-wrap-gap');
  fs.writeFileSync(testInfo.outputPath('native-center-clipboard.json'), JSON.stringify(Object.entries(nativeCopy).map(([mimeType, text]) => ({ mimeType, text }))));
  await image.click();
  await page.getByRole('button', { name: 'In-line', exact: true }).click();
  await expect(node).toHaveAttribute('data-layout', 'inline');
  await expect(editor.locator('.image-wrap-gap')).toHaveCount(0);
  await image.click();
  await page.keyboard.press('Control+c');
  const inlineCopy = await readClipboardFormats(page);
  const inlineSlice = JSON.parse(JSON.parse(inlineCopy['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(Object.values(inlineSlice.dsl_entitymap)).toEqual([expect.not.objectContaining({ pe_l: expect.anything() })]);
  expect(inlineSlice.dsl_spacers).toContain('*');
  await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
  const buttonSlice = JSON.parse(JSON.parse((await readClipboardFormats(page))['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  const buttonParagraphs = buttonSlice.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'paragraph').stsl_styles.filter(Boolean);
  expect(buttonParagraphs.length).toBeGreaterThan(0);
  expect(buttonParagraphs).toEqual(paragraphStyles);

  const editableSource = `<h2>Contenuti modificabili</h2><div data-editor-image="true" data-width="35" data-layout="wrap" data-align="left"><img src="${imageSrc}" alt="Figura con didascalia"><figcaption>Figura 1: didascalia modificabile</figcaption></div><p>${'Testo attorno al gruppo immagine e didascalia. '.repeat(5)}</p><p>Formula inline <span data-math="x_i^2+\\sqrt{y}">formula</span> e testo normale.</p><div data-math-block="\\frac{\\alpha+\\sqrt{x}}{y^2}">formula</div><div data-math-block="\\sum_{i=0}^{n}i">formula</div>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, editableSource);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+v');
  await expect(editor.locator('.editor-image-caption')).toContainText('Figura 1: didascalia modificabile');
  await expect(editor.locator('.math-node-wrapper')).toHaveCount(1);
  await expect(editor.locator('.math-block-wrapper')).toHaveCount(2);
  await editor.focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const editableCopy = await readClipboardFormats(page);
  const editableSlice = JSON.parse(JSON.parse(editableCopy['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(editableSlice.dsl_spacers).toContain('Figura 1: didascalia modificabile');
  expect(editableSlice.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'equation').stsl_styles.filter(Boolean)).toHaveLength(3);
  expect(editableSlice.dsl_entitytypemap).toEqual({ 'kix.sbobinator1': 'inline' });
  expect(editableCopy['text/plain']).toContain('x_i^2+\\sqrt{y}');
  fs.writeFileSync(testInfo.outputPath('native-editable-clipboard.json'), JSON.stringify(Object.entries(editableCopy).map(([mimeType, text]) => ({ mimeType, text }))));
  await page.getByRole('button', { name: 'Copia formattata', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copia formattata' })).toHaveAttribute('title', 'Copiato!');
  const editableButton = await readClipboardFormats(page);
  expect(editableButton['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeTruthy();
  const buttonModel = JSON.parse(JSON.parse(editableButton['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(buttonModel.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'equation').stsl_styles.filter(Boolean)).toHaveLength(3);

  // Exercise layout across marks, inline equations, headings, tables and a second
  // anchor. These must not be hidden by a figure or leak layout gaps into HTML.
  const complex = `<p>Prima <span data-editor-image data-layout="wrap" data-width="35" data-position="42" data-offset-y="25"><img src="${imageSrc}" alt="Wrap complesso"></span><b>${'Testo in grassetto accanto alla figura. '.repeat(4)}</b><i>${'Testo corsivo. '.repeat(4)}</i><span data-math="x^2">formula</span></p><h2>Titolo successivo</h2><table><tr><td><p>Cella A</p></td><td><p>Cella B</p></td></tr></table><p><span data-editor-image data-layout="wrap" data-position="70" data-width="25"><img src="${imageSrc}" alt="Seconda figura"></span>${'Testo della seconda figura. '.repeat(12)}</p>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, complex);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByAltText('Seconda figura')).toBeVisible();
  await expect.poll(async () => editor.evaluate(root => {
    const images = Array.from(root.querySelectorAll('img')).map(img => img.getBoundingClientRect());
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null, collisions = 0;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('[contenteditable="false"], [data-editor-image]')) continue;
      for (const word of (node.textContent ?? '').matchAll(/\S+/g)) {
        const range = document.createRange(); range.setStart(node, word.index); range.setEnd(node, word.index + word[0].length);
        for (const r of range.getClientRects()) if (images.some(img => r.bottom > img.top && r.top < img.bottom && r.right > img.left && r.left < img.right)) collisions++;
      }
    }
    for (const atom of root.querySelectorAll('table, .math-node-wrapper')) {
      const r = atom.getBoundingClientRect();
      if (images.some(img => r.bottom > img.top && r.top < img.bottom && r.right > img.left && r.left < img.right)) collisions++;
    }
    return collisions;
  })).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('image-wrap-complex.png') });
  await editor.getByAltText('Wrap complesso').click();
  const beforeWidth = await editor.locator('[alt="Wrap complesso"]').evaluate(img => img.getBoundingClientRect().width);
  const handle = await editor.locator('[data-editor-image]').first().locator('.editor-image-resize-handle-mr').boundingBox();
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
  await page.mouse.down(); await page.mouse.move(handle!.x + 25, handle!.y, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => editor.locator('[alt="Wrap complesso"]').evaluate(img => img.getBoundingClientRect().width)).toBeGreaterThan(beforeWidth);
  await page.keyboard.press('Control+z');
  await expect(editor.locator('[data-editor-image]').first()).toHaveAttribute('data-width', '35');

  const cellHtml = `<table><tr><td><p><span data-editor-image data-layout="wrap" data-width="35" data-position="50"><img src="${imageSrc}" alt="Immagine in cella"></span>${'Testo in cella attorno alla figura. '.repeat(8)}</p></td><td><p>Altra cella</p></td></tr></table>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, cellHtml);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByAltText('Immagine in cella')).toBeVisible();
  await expect.poll(async () => editor.locator('.image-wrap-gap').count()).toBeGreaterThan(0);
  await expect(editor.locator('.image-wrap-gap')).not.toHaveCount(1000);
  await expect(editor.locator('table')).toHaveCount(1);
  await expect(editor).toContainText('Altra cella');

  const listHtml = `<p>Prima della lista</p><ul><li><p><span data-editor-image data-layout="wrap" data-width="35" data-position="50"><img src="${imageSrc}" alt="Figura in elenco"></span>${'Testo nella voce dell’elenco. '.repeat(6)}</p></li><li><p>Seconda voce</p></li></ul><p>Paragrafo dopo l’elenco</p>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, listHtml);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const listImage = editor.getByAltText('Figura in elenco');
  const listStart = (await listImage.boundingBox())!;
  const listTarget = (await editor.locator('p').last().boundingBox())!;
  const listCursor = { x: listStart.x + 25, y: listTarget.y + 8 + 30 };
  await page.mouse.move(listStart.x + 25, listStart.y + 30); await page.mouse.down();
  await page.mouse.move(listCursor.x, listCursor.y, { steps: 10 });
  await expect.poll(async () => Math.abs((await page.locator('.editor-image-drag-preview img').boundingBox())!.y + 30 - listCursor.y)).toBeLessThan(2);
  await page.mouse.up();
  await expect.poll(async () => { const rect = (await listImage.boundingBox())!; return Math.max(Math.abs(rect.x + 25 - listCursor.x), Math.abs(rect.y + 30 - listCursor.y), Math.abs(rect.width - listStart.width)); }).toBeLessThan(3);
  await expect(editor).toContainText('Seconda voce');
  await page.keyboard.press('Control+z');
  await expect(editor.locator('li [data-editor-image]')).toHaveCount(1);

  // Clicking a figure whose text anchor is well above the viewport must not
  // scroll back to the invisible anchor or shift the visible image.
  const farHtml = `<p><span data-editor-image data-layout="wrap" data-offset-y="800" data-width="35" data-position="50"><img src="${imageSrc}" alt="Figura lontana dall’ancora"></span>${'Contenuto iniziale. '.repeat(20)}</p><p>Testo seguente</p>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, farHtml);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  const farImage = editor.getByAltText('Figura lontana dall’ancora');
  await farImage.scrollIntoViewIfNeeded();
  const farBefore = (await farImage.boundingBox())!;
  await farImage.click({ position: { x: 25, y: 25 } });
  await expect(page.getByRole('button', { name: 'Wrap', exact: true })).toBeVisible();
  await expect.poll(async () => { const rect = (await farImage.boundingBox())!; return Math.max(Math.abs(rect.x - farBefore.x), Math.abs(rect.y - farBefore.y)); }).toBeLessThan(2);

  const inlineHtml = `<p>Parola <span data-editor-image data-width="20"><img src="${imageSrc}" alt="Inline fra parole"></span> finale.</p>`;
  await page.evaluate(async html => { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }) })]); }, inlineHtml);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+v');
  await expect(editor.getByAltText('Inline fra parole')).toBeVisible();
  await page.keyboard.press('Control+End'); await page.keyboard.type(' Aggiunta.');
  await expect(editor).toContainText('finale. Aggiunta.');
  await expect(editor.locator('p [data-editor-image]')).toHaveCount(1);
  await expect(editor.locator('.image-wrap-gap')).toHaveCount(0);
  await editor.focus(); await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  const inlineDocument = await readClipboardFormats(page);
  const inlineModel = JSON.parse(JSON.parse(inlineDocument['application/x-vnd.google-docs-document-slice-clip+wrapped']).data).resolved;
  expect(inlineModel.dsl_spacers).toBe('Parola * finale. Aggiunta.\n');
  fs.writeFileSync(testInfo.outputPath('native-inline-clipboard.json'), JSON.stringify(Object.entries(inlineDocument).map(([mimeType, text]) => ({ mimeType, text }))));
});

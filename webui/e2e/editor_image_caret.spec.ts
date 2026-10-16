import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import type { Editor } from '@tiptap/core';

test('native caret beside images keeps text height, blinks, and preserves editing', async ({ page, context }, testInfo) => {
  test.setTimeout(120000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const audio = testInfo.outputPath('image-caret.wav');
  fs.writeFileSync(audio, Buffer.from('524946462400000057415645666d7420100000000100010044ac000088580100020010006461746100000000', 'hex'));
  await expect.poll(async () => (await page.request.get('/api/bootstrap')).status()).toBe(200);
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Trascina i file qui o clicca per sfogliare/i }).click();
  await (await chooser).setFiles(audio);
  await page.getByRole('button', { name: /Avvia sbobinatura/i }).click();
  const completed = page.locator('.queue-card.is-completed', { hasText: 'image-caret.wav' });
  await expect(completed).toBeVisible({ timeout: 15000 });
  await completed.getByRole('heading').click();
  const editor = page.locator('.tiptap-editor');
  const source = fs.readFileSync('e2e/fixtures/image-layout.jpg').toString('base64');
  const cdp = await context.newCDPSession(page);
  const read = () => editor.evaluate(root => {
    const instance = (root as HTMLElement & { editor: Editor }).editor;
    return { doc: instance.getJSON(), html: instance.getHTML(), image: root.querySelector('.editor-image-asset')!.getBoundingClientRect().toJSON(), paragraph: root.querySelector('p')!.getBoundingClientRect().toJSON() };
  });
  for (const mixed of [false, true]) {
    await page.emulateMedia({ reducedMotion: mixed ? 'no-preference' : 'reduce' });
    await editor.evaluate((root, { source, mixed }) => {
      const instance = (root as HTMLElement & { editor: Editor }).editor;
      instance.chain().setContent(`<p>${mixed ? 'Prima' : ''}<span data-editor-image="true" data-layout="inline" data-width="56"><img src="data:image/jpeg;base64,${source}"></span>${mixed ? 'Dopo' : ''}</p><p>Fine</p>`).setMeta('addToHistory', false).run();
      instance.commands.setTextSelection(instance.state.doc.firstChild!.nodeSize + 1);
    }, { source, mixed });
    await editor.locator('.editor-image-asset').evaluate(async image => { await (image as HTMLImageElement).decode(); });
    const before = await read();
    for (const side of ['before', 'after']) {
      await editor.evaluate((root, side) => {
        const instance = (root as HTMLElement & { editor: Editor }).editor;
        instance.state.doc.descendants((node, pos) => {
          if (node.type.name === 'floatingImage') instance.commands.setTextSelection(pos + (side === 'after' ? node.nodeSize : 0));
        });
      }, side);
      await editor.focus();
      await expect(editor.locator('.editor-script-caret')).toHaveCount(0);
      const metrics = await editor.evaluate(root => {
        const anchor = root.querySelector('.editor-image-caret-anchor')!;
        const rect = anchor.getBoundingClientRect();
        const image = root.querySelector('.editor-image-node')!.getBoundingClientRect();
        const instance = (root as HTMLElement & { editor: Editor }).editor;
        const selection = document.getSelection()!;
        return { height: rect.height, x: rect.x, bottom: rect.bottom, image: image.toJSON(), font: Number.parseFloat(getComputedStyle(root.querySelector('p')!).fontSize), nativeHidden: getComputedStyle(root).caretColor === 'rgba(0, 0, 0, 0)', inAnchor: anchor.contains(selection.anchorNode), dom: selection.anchorNode?.nodeName, offset: selection.anchorOffset, state: instance.state.selection.toJSON(), domPos: instance.view.posAtDOM(selection.anchorNode!, selection.anchorOffset), composing: instance.view.composing, focus: instance.view.hasFocus() };
      });
      expect(metrics.height).toBeGreaterThan(0);
      expect(metrics.height).toBeLessThan(metrics.font * 2);
      expect(Math.abs(metrics.x - (side === 'before' ? metrics.image.left : metrics.image.right))).toBeLessThan(1);
      expect(Math.abs(metrics.bottom - metrics.image.bottom)).toBeLessThan(metrics.font);
      expect(metrics.nativeHidden).toBe(false);
      expect(await read()).toEqual(before);

      // Inspect painted pixels over time. Playwright otherwise hides carets in
      // screenshots, and reduced-motion CSS must not freeze the native blink.
      const color = await page.addStyleTag({ content: '.tiptap-editor { caret-color: #ff0000 !important; }' });
      const clip = { x: Math.floor(metrics.x) - 3, y: Math.floor(metrics.image.top) - 2, width: 7, height: Math.ceil(metrics.image.height) + 24 };
      const frames: number[] = [];
      for (let frame = 0; frame < 14; frame++) {
        const png = await page.screenshot({ clip, caret: 'initial' });
        frames.push(await page.evaluate(async base64 => {
          const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'image/png' }));
          const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
          const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const rows = new Set<number>();
          for (let i = 0; i < data.length; i += 4) if (data[i] > 120 && data[i] > data[i + 1] * 2 && data[i] > data[i + 2] * 1.5) rows.add(Math.floor(i / 4 / canvas.width));
          return rows.size;
        }, png.toString('base64')));
        await page.waitForTimeout(150);
      }
      expect(Math.max(...frames)).toBeGreaterThan(0);
      expect(Math.max(...frames)).toBeLessThan(metrics.font * 2);
      expect(Math.min(...frames)).toBe(0);
      expect(frames.filter((height, i) => i > 0 && Boolean(height) !== Boolean(frames[i - 1])).length).toBeGreaterThanOrEqual(2);
      await testInfo.attach(`native-caret-${mixed}-${side}`, { body: JSON.stringify(frames), contentType: 'application/json' });
      await color.evaluate(style => style.remove());
      await page.keyboard.type('X');
      await expect(editor.locator('p').first()).toHaveText(mixed ? 'PrimaXDopo' : 'X');
      await page.keyboard.press('Control+z');
      expect((await read()).doc).toEqual(before.doc);
    }
    await page.screenshot({ path: testInfo.outputPath(`native-caret-${mixed}.png`), caret: 'initial' });
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => editor.evaluate(root => (root as HTMLElement & { editor: Editor }).editor.state.selection.toJSON().type)).toBe('node');
    await page.keyboard.press('ArrowRight');
    await cdp.send('Input.insertText', { text: '\u00e8' });
    await expect(editor.locator('p').first()).toHaveText(mixed ? 'Prima\u00e8Dopo' : '\u00e8');
    await page.keyboard.press('Control+z');
    expect((await read()).doc).toEqual(before.doc);
    await page.keyboard.press('Enter');
    await page.keyboard.type('Sotto');
    await expect(editor.locator('p')).toHaveText(mixed ? ['Prima', 'SottoDopo', 'Fine'] : ['', 'Sotto', 'Fine']);
    await expect(editor.locator('.editor-image-caret-anchor')).toHaveCount(0);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+c');
    const html = await page.evaluate(async () => (await (await navigator.clipboard.read())[0].getType('text/html')).text());
    expect(html).not.toContain('editor-image-caret-anchor');
    expect(html).not.toContain('\u200b');
    await expect(page.locator('.editor-autosave-badge')).toHaveText('Salvato');
    const saved = (await read()).doc;
    await page.getByRole('button', { name: 'Torna indietro', exact: true }).click();
    await completed.getByRole('heading').click();
    expect((await read()).doc).toEqual(saved);
  }
});

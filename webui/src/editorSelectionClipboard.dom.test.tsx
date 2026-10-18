import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { RichTextEditor } from './components/RichTextEditor';
import { prepareSelectionClipboard } from './editorSelectionClipboard';

async function openEditor() {
  render(<RichTextEditor initialContent="<p></p>" />);
  const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(element.editor).toBeTruthy());
  return element.editor;
}

describe('preparePastedEditorHtml', () => {
  it.each(['rgb(255, 255, 255)', '#ffffff', 'white'])('does not turn a copied page background (%s) into a highlight', async background => {
    const editor = await openEditor();
    // Docs keeps authored ink; the page's white background is still no highlight.
    act(() => {
      editor.view.pasteHTML(`<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><span style="color: rgb(32, 33, 34); font-family: sans-serif; background-color: ${background}; display: inline !important;">Testo dal web </span><span style="background-color: #fef08a">evidenziato</span></b>`, new Event('paste') as ClipboardEvent);
    });
    const text = (label: string) => (editor.getJSON() as JSONContent).content![0].content!.find(node => node.text === label)!;
    expect(text('Testo dal web ').marks?.some(mark => mark.type === 'highlight')).toBeFalsy();
    expect(text('evidenziato').marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'highlight', attrs: { color: 'rgb(254, 240, 138)' } })]));
    expect(text('Testo dal web ').marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'textStyle', attrs: expect.objectContaining({ color: 'rgb(32, 33, 34)' }) })]));
    expect(editor.getHTML()).not.toContain('rgb(255, 255, 255)');
  });

  it.each([
    ['light', 'rgb(32, 33, 34)', 'rgb(255, 255, 255)'],
    ['dark', '#e3e3e3', '#1f1f1f'],
  ])('stores no colours from a %s web page', async (_theme, color, background) => {
    const editor = await openEditor();
    act(() => {
      // Chromium page copy: the page's computed style is inlined on the selection.
      editor.view.pasteHTML(`<meta charset="utf-8"><p style="color: ${color}; font-family: sans-serif; font-size: 14px; font-style: normal; font-variant-ligatures: normal; font-weight: 400; letter-spacing: normal; orphans: 2; text-align: start; text-indent: 0px; text-transform: none; widows: 2; word-spacing: 0px; -webkit-text-stroke-width: 0px; white-space: normal; background-color: ${background};"><span style="color: ${color}; background-color: ${background};">Testo dal web</span> <font color="${color}">e font</font> <mark style="background-color: ${background}">segnato</mark></p>`, new Event('paste') as ClipboardEvent);
    });
    const html = editor.getHTML();
    expect(html).toContain('Testo dal web');
    expect(html).not.toMatch(/color|rgb|#e3e3e3|#1f1f1f/i);
  });

  it('keeps the colours of authored HTML that is not a page copy', async () => {
    const editor = await openEditor();
    act(() => {
      editor.view.pasteHTML('<p><span style="color:#123abc">Blu</span> <mark style="background-color:#ffee00">giallo</mark></p>', new Event('paste') as ClipboardEvent);
    });
    expect(editor.getHTML()).toContain('color: rgb(18, 58, 188)');
    expect(editor.getHTML()).toMatch(/background-color: (#ffee00|rgb\(255, 238, 0\))/);
  });
});

describe('internal copy and paste', () => {
  it('keeps profile defaults out of direct formatting across a block type change', async () => {
    const editor = await openEditor();
    act(() => { editor.commands.setContent('<h2>Titolo</h2><p>Testo</p>'); });
    act(() => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, editor.state.doc.content.size - 1))); });
    const copied = prepareSelectionClipboard(editor.view)!;
    expect(copied.html).toContain('16pt');
    act(() => { editor.commands.setContent('<p></p>'); });
    act(() => { editor.view.pasteHTML(copied.html, new Event('paste') as ClipboardEvent); });
    const blocks = () => (editor.getJSON() as JSONContent).content!.filter(node => node.content?.length);
    expect(blocks().map(node => [node.type, node.attrs?.documentStyle ?? null])).toEqual([['heading', null], ['paragraph', null]]);
    expect(JSON.stringify(blocks())).not.toContain('"bold"');
    // Swap the types: neither block may keep the other type's size, weight or spacing.
    let heading = 0, paragraph = 0;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'heading') heading = offset + 1;
      else if (node.textContent === 'Testo') paragraph = offset + 1;
    });
    act(() => { editor.chain().setTextSelection(heading).setParagraph().run(); });
    act(() => { editor.chain().setTextSelection(paragraph).setHeading({ level: 2 }).run(); });
    // The profile's native line spacing is the same for both types.
    const html = editor.getHTML().replace(/ data-document-line-spacing="1.15"/g, '');
    expect(html).toContain('<p>Titolo</p>');
    expect(html).toContain('<h2>Testo</h2>');
    expect(html).not.toMatch(/font-size|font-weight|margin|inherit|<strong>/);
    act(() => { editor.chain().selectAll().clearDocumentColor().run(); });
    expect(editor.getHTML()).not.toContain('inherit');
  });
});

describe('pasted image width', () => {
  const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9N0AAAAASUVORK5CYII=';
  it.each([
    ['a wide width attribute', `<p>Prima<img src="${src}" width="1600">Dopo</p>`, 100],
    ['a px style without width attribute', `<p>Prima<img src="${src}" style="width:800px">Dopo</p>`, 100],
    ['a narrow width attribute', `<p>Prima<img src="${src}" width="301">Dopo</p>`, 50],
    ['a percentage over the page', `<p>Prima<img src="${src}" style="width:180%">Dopo</p>`, 100],
    ['our own resize past the text area', `<p>Prima<span data-editor-image data-width="150"><img src="${src}"></span>Dopo</p>`, 150],
  ])('fits %s', async (_case, html, width) => {
    const editor = await openEditor();
    act(() => { editor.view.pasteHTML(html, new Event('paste') as ClipboardEvent); });
    const images: number[] = [];
    editor.state.doc.descendants(node => { if (node.type.name === 'floatingImage') images.push(node.attrs.width); });
    expect(images).toEqual([width]);
  });
});

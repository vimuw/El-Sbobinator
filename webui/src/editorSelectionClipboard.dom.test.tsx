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
  it.each(['rgb(255, 255, 255)', '#ffffff', 'white'])('does not turn a copied web page background (%s) into a highlight', async background => {
    const editor = await openEditor();
    // Chromium web copy: the selection wrapper carries the page background.
    act(() => {
      editor.view.pasteHTML(`<meta charset="utf-8"><span style="color: rgb(32, 33, 34); font-family: sans-serif; background-color: ${background}; display: inline !important;">Testo dal web </span><span style="background-color: #fef08a">evidenziato</span>`, new Event('paste') as ClipboardEvent);
    });
    const text = (label: string) => (editor.getJSON() as JSONContent).content![0].content!.find(node => node.text === label)!;
    expect(text('Testo dal web ').marks?.some(mark => mark.type === 'highlight')).toBeFalsy();
    expect(text('evidenziato').marks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'highlight', attrs: { color: 'rgb(254, 240, 138)' } })]));
    expect(editor.getHTML()).not.toContain('rgb(255, 255, 255)');
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

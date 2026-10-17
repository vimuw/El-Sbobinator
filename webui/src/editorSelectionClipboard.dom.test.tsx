import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Editor, JSONContent } from '@tiptap/core';
import { RichTextEditor } from './components/RichTextEditor';

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

import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { RichTextEditor } from './components/RichTextEditor';
import { NATIVE_SLICE_MIME } from './editorClipboard';
import { editorIsBold } from './editorBold';
import { normalizePreviewHtmlContent } from './previewHtml';

type TextStyle = { ts_bd?: boolean } | null;

async function openEditor(content: string) {
  const { container } = render(<RichTextEditor initialContent={content} />);
  const element = container.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(element.editor).toBeTruthy());
  return { element, editor: element.editor };
}

function copy(element: HTMLElement) {
  const formats: Record<string, string> = {};
  const event = new Event('copy', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    setData: (mime: string, text: string) => { formats[mime] = text; },
    clearData: () => { Object.keys(formats).forEach(mime => { delete formats[mime]; }); },
  } });
  act(() => { element.dispatchEvent(event); });
  return formats;
}

/** Docs keeps a text style from the index where it starts until the next one. */
function nativeBold(formats: Record<string, string>, index: number): boolean | undefined {
  const styles: TextStyle[] = JSON.parse(JSON.parse(formats[NATIVE_SLICE_MIME]).data).resolved.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
  for (let i = index; i >= 0; i--) if (styles[i]) return styles[i]!.ts_bd;
  return undefined;
}

const textNodes = (editor: Editor, block = 0) => (editor.getJSON() as JSONContent).content![block].content!;
const marksOf = (editor: Editor, text: string, block = 0) => (textNodes(editor, block).find(node => node.text === text)?.marks ?? []).map(mark => mark.type);
// Docs spans also parse as an empty text style; only the weight marks matter here.
const weightOf = (editor: Editor, text: string, block = 0) => marksOf(editor, text, block).filter(type => type === 'bold' || type === 'unbold');

describe('Docs-style bold on headings', () => {
  it('reports heading text as bold through its style and paragraph text as normal', async () => {
    const { editor } = await openEditor('<h2>Titolo prova</h2><p>Testo normale</p>');
    act(() => { editor.commands.setTextSelection(4); });
    expect(editorIsBold(editor)).toBe(true);
    expect(editor.isActive('bold')).toBe(false);
    act(() => { editor.commands.setTextSelection(18); });
    expect(editorIsBold(editor)).toBe(false);
    act(() => { editor.commands.setTextSelection({ from: 1, to: 7 }); });
    expect(editorIsBold(editor)).toBe(true);
  });

  it('keeps bold as the outermost mark, as StarterKit ordered it', async () => {
    const { editor } = await openEditor('<p>Testo</p>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 6 }); editor.commands.toggleItalic(); editor.commands.toggleStrike(); editor.commands.toggleBold(); });
    expect(editor.getHTML()).toContain('<strong><em><s>Testo</s></em></strong>');
  });

  it('removes and restores the weight of selected heading text without adding a bold mark', async () => {
    const { editor } = await openEditor('<h2>Titolo prova</h2>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 7 }); editor.commands.toggleBold(); });
    expect(marksOf(editor, 'Titolo')).toEqual(['unbold']);
    expect(marksOf(editor, ' prova')).toEqual([]);
    expect(editorIsBold(editor)).toBe(false);
    expect(editor.getHTML()).toMatch(/<h2><span style="font-weight: 400;?">Titolo<\/span> prova<\/h2>/);
    act(() => { editor.commands.toggleBold(); });
    expect(textNodes(editor)).toEqual([{ type: 'text', text: 'Titolo prova' }]);
    expect(editorIsBold(editor)).toBe(true);
    act(() => { editor.commands.undo(); });
    expect(marksOf(editor, 'Titolo')).toEqual(['unbold']);
  });

  it('makes a mixed heading and paragraph selection uniformly bold, then uniformly normal', async () => {
    const { editor } = await openEditor('<h2>Titolo</h2><p>Testo</p>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 14 }); });
    expect(editorIsBold(editor)).toBe(false);
    act(() => { editor.commands.toggleBold(); });
    expect(marksOf(editor, 'Titolo', 0)).toEqual([]);
    expect(marksOf(editor, 'Testo', 1)).toEqual(['bold']);
    expect(editorIsBold(editor)).toBe(true);
    act(() => { editor.commands.toggleBold(); });
    expect(marksOf(editor, 'Titolo', 0)).toEqual(['unbold']);
    expect(marksOf(editor, 'Testo', 1)).toEqual([]);
    expect(editorIsBold(editor)).toBe(false);
  });

  it('applies a caret toggle to future typing in a heading and on an empty heading after reopening', async () => {
    const { editor } = await openEditor('<h2>Titolo</h2><h3></h3>');
    act(() => { editor.commands.setTextSelection(7); editor.commands.toggleBold(); });
    expect(editorIsBold(editor)).toBe(false);
    act(() => { editor.commands.insertContent(' nuovo'); });
    expect(marksOf(editor, ' nuovo')).toEqual(['unbold']);
    act(() => { editor.commands.setTextSelection(15); editor.commands.toggleBold(); });
    expect((editor.getJSON() as JSONContent).content![1].attrs?.emptyTextMarks).toEqual([{ type: 'unbold' }]);
    const reopened = (await openEditor(normalizePreviewHtmlContent(editor.getHTML()))).editor;
    act(() => { reopened.commands.setTextSelection(15); });
    expect(editorIsBold(reopened)).toBe(false);
  });

  it('keeps normal heading text through save and reopen but ignores normal weight in normal text', async () => {
    const { editor } = await openEditor('<h2>Titolo prova</h2>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 7 }); editor.commands.toggleBold(); });
    const reopened = (await openEditor(`${normalizePreviewHtmlContent(editor.getHTML())}<p><span style="font-weight: 400">Testo</span></p>`)).editor;
    expect(marksOf(reopened, 'Titolo')).toEqual(['unbold']);
    const paragraph = (reopened.getJSON() as JSONContent).content!.findIndex(block => block.content?.some(node => node.text === 'Testo'));
    expect(weightOf(reopened, 'Testo', paragraph)).toEqual([]);
  });

  it('imports normal-weight Docs heading text as unbold but leaves bold and normal paragraphs alone', async () => {
    const { editor } = await openEditor('<p></p>');
    act(() => { editor.view.pasteHTML('<b style="font-weight:normal" id="docs-internal-guid-test"><h2><span style="font-size:16pt;font-weight:400">Normale</span><span style="font-size:16pt;font-weight:700"> Grassetto</span></h2><p><span style="font-weight:400">Testo</span></p></b>', new Event('paste') as ClipboardEvent); });
    const blocks = (editor.getJSON() as JSONContent).content!;
    const heading = blocks.findIndex(block => block.type === 'heading');
    const paragraph = blocks.findIndex(block => block.type === 'paragraph' && block.content?.some(node => node.text === 'Testo'));
    expect(weightOf(editor, 'Normale', heading)).toEqual(['unbold']);
    expect(weightOf(editor, ' Grassetto', heading)).not.toContain('unbold');
    expect(weightOf(editor, 'Testo', paragraph)).toEqual([]);
  });

  it('copies normal heading text as not bold to Docs and pastes it back unchanged', async () => {
    const { editor, element } = await openEditor('<h2>Titolo prova</h2><p></p>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 7 }); editor.commands.toggleBold(); editor.commands.selectAll(); });
    const formats = copy(element);
    expect(nativeBold(formats, 0)).toBe(false);
    expect(nativeBold(formats, 6)).toBe(true);
    expect(formats['text/html']).toContain('font-weight: 400');
    act(() => { editor.commands.setContent('<p></p>'); editor.commands.setTextSelection(1); editor.view.pasteHTML(formats['text/html'], new Event('paste') as ClipboardEvent); });
    const heading = (editor.getJSON() as JSONContent).content!.findIndex(block => block.type === 'heading');
    // Portable HTML spells out inherited typography on inline spans, as for
    // any styled run; only the weight is under test here.
    expect(weightOf(editor, 'Titolo', heading)).toEqual(['unbold']);
    expect(weightOf(editor, ' prova', heading)).toEqual([]);
  });

  it('restores the heading weight on clear formatting and keeps a normal heading normal outside a partial clear', async () => {
    const { editor } = await openEditor('<h2>Titolo prova</h2><h2 style="font-weight: 400">Leggero testo</h2>');
    act(() => { editor.commands.setTextSelection({ from: 1, to: 7 }); editor.commands.toggleBold(); editor.commands.clearDocumentFormatting(); });
    expect(textNodes(editor)).toEqual([{ type: 'text', text: 'Titolo prova' }]);
    expect(editorIsBold(editor)).toBe(true);
    act(() => { editor.commands.setTextSelection({ from: 15, to: 22 }); });
    expect(editorIsBold(editor)).toBe(false);
    act(() => { editor.commands.clearDocumentFormatting(); });
    expect(marksOf(editor, 'Leggero', 1)).toEqual([]);
    expect(marksOf(editor, ' testo', 1)).toContain('unbold');
    expect(editorIsBold(editor)).toBe(true);
  });
});

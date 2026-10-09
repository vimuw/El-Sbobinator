import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { RichTextEditor } from './components/RichTextEditor';
import { prepareSelectionClipboard } from './editorSelectionClipboard';
import { NATIVE_SLICE_MIME } from './editorClipboard';
import { normalizePreviewHtmlContent } from './previewHtml';

async function openEditor(content = '<p>Ciao12 fine</p>') {
  render(<RichTextEditor initialContent={content} />);
  const element = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(element.editor).toBeTruthy());
  return { element, editor: element.editor };
}

describe('Apice e pedice', () => {
  it('previews typing marks without changing text, saved HTML or clipboard, and hides for a range', async () => {
    const { element, editor } = await openEditor('<p>Ciao</p>');
    act(() => { editor.commands.setTextSelection(5); });
    const original = editor.getJSON();
    const saved = editor.getHTML();
    fireEvent.keyDown(element, { key: '.', ctrlKey: true });
    expect(element.querySelector('.editor-script-caret')?.closest('sup')).toBeTruthy();
    expect(element.textContent).toBe('Ciao');
    expect(editor.getJSON()).toEqual(original);
    expect(editor.getHTML()).toBe(saved);
    fireEvent.keyDown(element, { key: ',', ctrlKey: true });
    expect(element.querySelector('.editor-script-caret')?.closest('sub')).toBeTruthy();
    expect(element.querySelector('.editor-script-caret')?.closest('sup')).toBeNull();
    fireEvent.compositionStart(element);
    expect(element.hasAttribute('data-editor-script-composing')).toBe(true);
    fireEvent.compositionEnd(element);
    expect(element.hasAttribute('data-editor-script-composing')).toBe(false);
    act(() => { editor.commands.selectAll(); });
    expect(element.querySelector('.editor-script-caret')).toBeNull();
    expect(element.hasAttribute('data-editor-script-caret')).toBe(false);
    const clipboard = prepareSelectionClipboard(editor.view)!;
    expect(clipboard.plainText.trim()).toBe('Ciao');
    expect(clipboard.html).not.toContain('editor-script-caret');
    expect(clipboard.html).not.toContain('\u200b');
    expect(screen.getByRole('group', { name: 'Apice e pedice' }).querySelectorAll('button')).toHaveLength(2);
  });

  it.each([
    ['superscript', '.', 'Apice (Ctrl+.)', 'sup'],
    ['subscript', ',', 'Pedice (Ctrl+,)', 'sub'],
  ])('toggles %s on a selection through both shortcut and toolbar, with history', async (mark, key, label, tag) => {
    const { element, editor } = await openEditor();
    act(() => { editor.commands.setTextSelection({ from: 5, to: 7 }); });
    const original = editor.getJSON();
    fireEvent.keyDown(element, { key, ctrlKey: true });
    expect(editor.state.doc.nodeAt(5)?.marks.map(value => value.type.name)).toEqual([mark]);
    expect(editor.getHTML()).toContain(`<${tag}>12</${tag}>`);
    expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true');
    const styled = editor.getJSON();
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); });
    expect(editor.getJSON()).toEqual(styled);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(editor.getJSON()).toEqual(original);
  });

  it('switches the typing style exclusively while preserving other character formatting', async () => {
    const { element, editor } = await openEditor('<p><strong><span style="font-size:18pt;color:#123abc">x</span></strong></p>');
    act(() => { editor.commands.setTextSelection(2); });
    fireEvent.keyDown(element, { key: '.', ctrlKey: true });
    act(() => { editor.commands.insertContent('2'); });
    fireEvent.keyDown(element, { key: ',', ctrlKey: true });
    expect(editor.isActive('superscript')).toBe(false);
    expect(editor.isActive('subscript')).toBe(true);
    act(() => { editor.commands.insertContent('i'); });
    fireEvent.keyDown(element, { key: ',', ctrlKey: true });
    act(() => { editor.commands.insertContent('N'); });
    const marks = (pos: number) => editor.state.doc.nodeAt(pos)!.marks.map(mark => mark.type.name);
    expect(marks(2)).toEqual(expect.arrayContaining(['bold', 'textStyle', 'superscript']));
    expect(marks(3)).toEqual(expect.arrayContaining(['bold', 'textStyle', 'subscript']));
    expect(marks(3)).not.toContain('superscript');
    expect(marks(4)).toEqual(expect.arrayContaining(['bold', 'textStyle']));
    expect(marks(4)).not.toContain('superscript');
    expect(marks(4)).not.toContain('subscript');
    expect(editor.getAttributes('textStyle')).toMatchObject({ fontSize: '18pt', color: '#123abc' });
  });

  it('replaces the opposite style on a range in one undoable operation', async () => {
    const { element, editor } = await openEditor('<p>A<sup>12</sup>B</p>');
    act(() => { editor.commands.setTextSelection({ from: 2, to: 4 }); });
    const original = editor.getJSON();
    fireEvent.keyDown(element, { key: ',', ctrlKey: true });
    expect(editor.getHTML()).toContain('A<sub>12</sub>B');
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(original);
    act(() => { editor.commands.redo(); });
    expect(editor.getHTML()).toContain('A<sub>12</sub>B');
  });

  it('preserves editable marks through saved HTML and exports the Docs native baseline styles', async () => {
    const { editor } = await openEditor('<p>x<sup>2</sup> H<sub>2</sub>O normale</p>');
    const original = editor.getJSON();
    const saved = normalizePreviewHtmlContent(editor.getHTML());
    const reopened = new Editor({ extensions: editor.options.extensions, content: saved });
    try {
      expect(reopened.getJSON()).toEqual(original);
      reopened.commands.selectAll();
      const clipboard = prepareSelectionClipboard(reopened.view)!;
      const html = new DOMParser().parseFromString(clipboard.html, 'text/html');
      for (const tag of ['sup', 'sub']) {
        const script = html.querySelector<HTMLElement>(tag)!;
        expect(script.textContent).toBe('2');
        expect(script.style.fontSize).toBe('');
      }
      const native = JSON.parse(JSON.parse(clipboard.formats[NATIVE_SLICE_MIME]).data).resolved;
      const styles = native.dsl_styleslices.find((slice: { stsl_type: string }) => slice.stsl_type === 'text').stsl_styles;
      const styleAt = (index: number) => styles.slice(0, index + 1).filter(Boolean).at(-1);
      expect(styleAt(native.dsl_spacers.indexOf('2'))).toMatchObject({ ts_va: 'sup', ts_fs: 11 });
      expect(styleAt(native.dsl_spacers.lastIndexOf('2'))).toMatchObject({ ts_va: 'sub', ts_fs: 11 });
      expect(styleAt(native.dsl_spacers.indexOf('O'))).toMatchObject({ ts_va: 'nor', ts_fs: 11 });
      reopened.commands.setTextSelection({ from: 2, to: 3 });
      reopened.commands.clearDocumentFormatting();
      expect(reopened.getHTML()).not.toContain('<sup>');
      expect(reopened.getHTML()).toContain('<sub>2</sub>');
      reopened.commands.undo();
      expect(reopened.getJSON()).toEqual(original);
    } finally {
      reopened.destroy();
    }
  });
});

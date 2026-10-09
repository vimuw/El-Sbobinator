import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { RichTextEditor } from './RichTextEditor';

async function setup() {
  const rendered = render(<RichTextEditor initialContent="<p>Prima dopo</p>" />);
  const root = document.querySelector('.tiptap-editor') as HTMLElement & { editor: Editor };
  await waitFor(() => expect(root.editor).toBeTruthy());
  act(() => root.editor.commands.setTextSelection({ from: 1, to: 6 }));
  return { ...rendered, editor: root.editor, root };
}

describe('editor math insertion', () => {
  it.each(['toolbar', 'context', 'shortcut'])('opens the same empty field inside the document from %s and preserves the selection until confirmation', async route => {
    const { editor, root } = await setup();
    const original = editor.getJSON();
    const prompt = vi.spyOn(window, 'prompt');
    if (route === 'toolbar') fireEvent.click(screen.getByTitle('Inserisci formula matematica (LaTeX)'));
    if (route === 'context') {
      fireEvent.contextMenu(root, { clientX: 800, clientY: 700 });
      fireEvent.click(screen.getByText('Inserisci formula LaTeX'));
    }
    if (route === 'shortcut') fireEvent.keyDown(root, { ctrlKey: true, key: 'm' });
    const input = screen.getByLabelText('Formula LaTeX');
    expect((input as HTMLInputElement).value).toBe('');
    expect(editor.getJSON()).toEqual(original);
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '\\frac{a}{b}' } });
    expect(root.querySelector('.math-editor-field .katex')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma formula' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Formula LaTeX' })).toBeNull());
    expect(editor.state.doc.firstChild?.firstChild?.attrs.latex).toBe('\\frac{a}{b}');
    expect(editor.getText()).toBe(' dopo');
    const inserted = editor.getJSON();
    act(() => editor.commands.undo()); expect(editor.getJSON()).toEqual(original);
    act(() => editor.commands.redo()); expect(editor.getJSON()).toEqual(inserted);
  });

  it('keeps invalid input out of the document and cancels without changing content', async () => {
    const { editor } = await setup();
    const original = editor.getJSON();
    fireEvent.click(screen.getByTitle('Inserisci formula matematica (LaTeX)'));
    const input = screen.getByLabelText('Formula LaTeX');
    fireEvent.change(input, { target: { value: '\\unknown{x}' } });
    expect((screen.getByRole('button', { name: 'Conferma formula' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Controlla la sintassi LaTeX.')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Formula LaTeX' })).toBeNull();
    expect(editor.getJSON()).toEqual(original);
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(6);
  });

  it('dismisses a stale composer if the document changes', async () => {
    const { editor } = await setup();
    fireEvent.click(screen.getByTitle('Inserisci formula matematica (LaTeX)'));
    fireEvent.change(screen.getByLabelText('Formula LaTeX'), { target: { value: 'x^2' } });
    act(() => editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' nuovo'));
    expect(screen.queryByRole('textbox', { name: 'Formula LaTeX' })).toBeNull();
    expect(editor.getText()).toBe('Prima dopo nuovo');
  });

  it('commits on leaving a valid draft and never serializes editor controls', async () => {
    const { editor, root } = await setup();
    fireEvent.click(screen.getByTitle('Inserisci formula matematica (LaTeX)'));
    const input = screen.getByLabelText('Formula LaTeX');
    expect(root.contains(input)).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(input, { target: { value: 'x^2' } });
    expect(editor.getHTML()).not.toContain('math-editor');
    fireEvent.blur(input);
    expect(editor.state.doc.firstChild?.firstChild?.attrs.latex).toBe('x^2');
    expect(screen.queryByRole('textbox', { name: 'Formula LaTeX' })).toBeNull();
  });

  it.each(['mathInline', 'mathBlock'])('edits %s in the same compact field, cancels with Esc and isolates history', async type => {
    const { editor, root } = await setup();
    act(() => editor.commands.setContent({ type: 'doc', content: type === 'mathInline'
      ? [{ type: 'paragraph', content: [{ type, attrs: { latex: 'x^2' } }, { type: 'text', text: ' dopo' }] }]
      : [{ type, attrs: { latex: 'x^2' } }, { type: 'paragraph', content: [{ type: 'text', text: 'dopo' }] }] }));
    const original = editor.getJSON();
    await waitFor(() => expect(root.querySelector('.math-rendered')).toBeTruthy());
    fireEvent.click(root.querySelector('.math-rendered')!);
    let input = screen.getByLabelText('Formula LaTeX');
    fireEvent.change(input, { target: { value: 'y^3' } });
    expect(editor.getJSON()).toEqual(original);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(editor.getJSON()).toEqual(original);
    await waitFor(() => expect(root.querySelector('.math-rendered')).toBeTruthy());
    fireEvent.click(root.querySelector('.math-rendered')!);
    input = screen.getByLabelText('Formula LaTeX');
    fireEvent.change(input, { target: { value: '\\unknown{x}' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByLabelText('Formula LaTeX')).toBeTruthy();
    expect(editor.getJSON()).toEqual(original);
    fireEvent.change(input, { target: { value: '\\frac{a}{b}' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByLabelText('Formula LaTeX')).toBeNull();
    const final = editor.getJSON();
    expect(editor.getHTML()).toContain('data-math');
    expect(editor.getHTML()).not.toContain('math-editor-field');
    act(() => editor.commands.undo()); expect(editor.getJSON()).toEqual(original);
    act(() => editor.commands.redo()); expect(editor.getJSON()).toEqual(final);
  });
});

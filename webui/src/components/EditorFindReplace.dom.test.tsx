import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color } from '@tiptap/extension-text-style';
import { SearchHighlight } from '../editorExtensions';
import { FindReplacePanel } from './EditorFindReplace';

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach(editor => editor.destroy());
});

function openReplacement(content: string, replacement = 'potenza') {
  const editor = new Editor({ extensions: [StarterKit, TextStyle, Color, SearchHighlight], content });
  editors.push(editor);
  render(<FindReplacePanel editor={editor} onClose={vi.fn()} initialMode="replace" />);
  fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'energia' } });
  fireEvent.change(screen.getByPlaceholderText('Sostituisci con...'), { target: { value: replacement } });
  return editor;
}

describe('FindReplacePanel formatting and history', () => {
  it('preserves each match style and restores the entire document with one undo/redo', () => {
    const editor = openReplacement('<h1>energia</h1><p>Prima <strong>energia</strong>, <em>energia</em> e <a href="https://example.com/lezione"><span style="color: #123abc">energia</span></a>.</p>');
    const baseline = editor.getJSON();
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci tutto' }));
    expect(editor.getHTML()).toContain('<strong>potenza</strong>');
    expect(editor.getHTML()).toContain('<em>potenza</em>');
    expect(editor.getHTML()).toContain('href="https://example.com/lezione"');
    expect(editor.getHTML()).toContain('color: rgb(18, 58, 188)');
    expect(editor.getText()).not.toContain('energia');
    const replaced = editor.getJSON();
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(baseline);
    act(() => { editor.commands.redo(); });
    expect(editor.getJSON()).toEqual(replaced);
  });

  it('preserves the first selected character style for a single replacement at a mark boundary', () => {
    const editor = openReplacement('<p>Prima <strong>energia</strong> dopo</p>');
    act(() => { editor.commands.setTextSelection({ from: 7, to: 14 }); });
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci' }));
    expect(editor.getHTML()).toBe('<p>Prima <strong>potenza</strong> dopo</p>');
  });

  it('inherits the first matched character when a match crosses differently styled runs', () => {
    const editor = openReplacement('<p>Prima <em>ene</em><strong>rgia</strong> dopo</p>');
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci tutto' }));
    expect(editor.getHTML()).toBe('<p>Prima <em>potenza</em> dopo</p>');
  });

  it('keeps empty replacements undoable without changing unrelated text or marks', () => {
    const editor = openReplacement('<p><strong>energia</strong> e <em>testo conservato</em></p>', '');
    const baseline = editor.getJSON();
    fireEvent.click(screen.getByRole('button', { name: 'Sostituisci tutto' }));
    expect(editor.getHTML()).toBe('<p> e <em>testo conservato</em></p>');
    act(() => { editor.commands.undo(); });
    expect(editor.getJSON()).toEqual(baseline);
  });
});

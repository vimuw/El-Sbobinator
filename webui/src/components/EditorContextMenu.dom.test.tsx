import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { EditorContextMenu } from './EditorContextMenu';
import type { Editor as TiptapEditor } from '@tiptap/core';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import * as clipboard from '../editorClipboard';
import { EditorDocumentStyle } from '../editorDocumentStyle';

describe('EditorContextMenu', () => {
  it('does not render when contextMenu is null', () => {
    const { container } = render(
      <EditorContextMenu
        contextMenu={null}
        onClose={vi.fn()}
        editor={null}
        onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
        onOpenFind={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders menu items when position and editor are provided', () => {
    const onClose = vi.fn();
    const onOpenFind = vi.fn();
    const mockEditor = {
      state: { selection: { empty: true, from: 0, to: 0 }, doc: { textBetween: () => '' } },
      chain: () => ({
        focus: () => ({
          toggleBold: () => ({ run: vi.fn() }),
        }),
      }),
      commands: { insertContent: vi.fn() },
    } as unknown as TiptapEditor;

    render(
      <EditorContextMenu
        contextMenu={{ x: 100, y: 100 }}
        onClose={onClose}
        editor={mockEditor}
        onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
        onOpenFind={onOpenFind}
      />,
    );

    expect(screen.getByText('Taglia')).toBeTruthy();
    expect(screen.getByText('Copia')).toBeTruthy();
    expect(screen.getByText('Grassetto')).toBeTruthy();
    expect(screen.getByText('Trova e sostituisci')).toBeTruthy();

    const findBtn = screen.getByText('Trova e sostituisci').closest('button');
    if (findBtn) fireEvent.click(findBtn);
    expect(onOpenFind).toHaveBeenCalled();
  });

  it('handles Copia and Taglia clicks gracefully', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock, write: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });

    const deleteSelectionMock = vi.fn().mockReturnValue({ run: vi.fn() });
    const mockEditor = {
      state: {
        selection: { empty: false, from: 0, to: 5, content: () => ({ content: [] }) },
        doc: { textBetween: () => 'Hello' },
      },
      schema: {},
      chain: () => ({
        focus: () => ({
          deleteSelection: deleteSelectionMock,
        }),
      }),
      commands: { insertContent: vi.fn() },
    } as unknown as TiptapEditor;

    render(
      <EditorContextMenu
        contextMenu={{ x: 50, y: 50 }}
        onClose={vi.fn()}
        editor={mockEditor}
        onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
        onOpenFind={vi.fn()}
      />,
    );

    const copyBtn = screen.getByText('Copia').closest('button');
    if (copyBtn) fireEvent.click(copyBtn);

    const cutBtn = screen.getByText('Taglia').closest('button');
    if (cutBtn) fireEvent.click(cutBtn);
  });
  it('frames the menu and its rows with the shared menu rules, tinting only the delete row', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Hello</p>' });
    editor.commands.selectAll();
    try {
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} />);
      const menu = document.querySelector('.editor-context-menu');
      expect(menu?.classList.contains('kebab-panel')).toBe(true);
      expect(menu?.querySelectorAll('.kebab-separator').length).toBeGreaterThan(0);

      const rows = Array.from(menu?.querySelectorAll('button') ?? []);
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every(row => row.classList.contains('kebab-item'))).toBe(true);
      expect(rows.filter(row => row.classList.contains('is-danger')).map(row => row.textContent)).toEqual([
        expect.stringContaining('Elimina selezione'),
      ]);
    } finally {
      editor.destroy();
    }
  });
  it('does not delete the selection when the clipboard transfer fails', async () => {
    const write = vi.spyOn(clipboard, 'writeEditorClipboard').mockRejectedValue(new Error('Clipboard unavailable'));
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Hello</p>' });
    editor.commands.selectAll();
    const original = editor.getJSON();
    try {
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Taglia/ }));
      await waitFor(() => expect(write).toHaveBeenCalledOnce());
      expect(editor.getJSON()).toEqual(original);
    } finally {
      write.mockRestore();
      editor.destroy();
    }
  });

  it('does not cut a new selection while the original clipboard write is pending', async () => {
    let finish!: () => void;
    const write = vi.spyOn(clipboard, 'writeEditorClipboard').mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Prima dopo</p>' });
    editor.commands.setTextSelection({ from: 1, to: 6 });
    const original = editor.getJSON();
    try {
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Taglia/ }));
      expect(write.mock.calls[0][1]).toContain('Prima');
      editor.commands.setTextSelection({ from: 7, to: 11 });
      await act(async () => { finish(); });
      expect(editor.getJSON()).toEqual(original);
    } finally { write.mockRestore(); editor.destroy(); }
  });

  it('pastes HTML through the editor schema and keeps literal text in plain paste', async () => {
    const editor = new Editor({ extensions: [StarterKit, TextStyle, Color], content: '<p></p>' });
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const html = '<p><span style="color:#123abc"><strong>Colorato</strong></span><script>bad()</script><img src="bad" onerror="bad()"></p>';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      read: vi.fn().mockResolvedValue([{ types: ['text/html', 'text/plain'], getType: () => Promise.resolve({ text: () => Promise.resolve(html) }) }]),
      readText: vi.fn().mockResolvedValue('a < b e <testo>'),
    } });
    try {
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /^Incolla\s*Ctrl/ }));
      await waitFor(() => expect(editor.getHTML()).toContain('rgb(18, 58, 188)'));
      expect(editor.getHTML()).toContain('<strong>Colorato</strong>');
      expect(editor.getHTML()).not.toMatch(/script|onerror|bad\(\)/);
      editor.commands.selectAll();
      fireEvent.click(screen.getByRole('button', { name: /Incolla senza formattazione/ }));
      await waitFor(() => expect(editor.getText()).toBe('a < b e <testo>'));
      expect(editor.getHTML()).not.toMatch(/<strong>|style=/);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
      editor.destroy();
    }
  });

  it('clears the typing formatting at a caret, like the toolbar and Ctrl+\\', () => {
    const editor = new Editor({ extensions: [StarterKit, TextStyle, Color, EditorDocumentStyle], content: '<p><strong>Grassetto</strong></p>' });
    try {
      editor.commands.setTextSelection(4);
      expect(editor.isActive('bold')).toBe(true);
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} />);
      fireEvent.click(screen.getByRole('button', { name: /Rimuovi formattazione/ }));
      editor.commands.insertContent('x');
      expect(editor.getHTML()).toBe('<p><strong>Gra</strong>x<strong>ssetto</strong></p>');
    } finally { editor.destroy(); }
  });

  it('asks the editor to open its link panel instead of a native prompt', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const onOpenLink = vi.fn();
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Testo</p>' });
    try {
      render(<EditorContextMenu contextMenu={{ x: 50, y: 50 }} onClose={vi.fn()} editor={editor} onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()} onOpenFind={vi.fn()} onOpenLink={onOpenLink} />);
      fireEvent.click(screen.getByRole('button', { name: /Inserisci link/ }));
      expect(onOpenLink).toHaveBeenCalledOnce();
      expect(prompt).not.toHaveBeenCalled();
    } finally { prompt.mockRestore(); editor.destroy(); }
  });

  it('labels Trova e sostituisci with its Ctrl+H shortcut', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Testo</p>' });
    try {
      render(
        <EditorContextMenu
          contextMenu={{ x: 10, y: 10 }}
          onClose={vi.fn()}
          editor={editor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          onOpenFind={vi.fn()}
        />,
      );
      expect(screen.getByText('Trova e sostituisci').closest('button')?.textContent).toContain('Ctrl+H');
    } finally { editor.destroy(); }
  });

  it('closes on Esc without reaching the editor page', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Testo</p>' });
    const onClose = vi.fn();
    const pageEscape = vi.fn();
    window.addEventListener('keydown', pageEscape);
    try {
      render(
        <EditorContextMenu
          contextMenu={{ x: 10, y: 10 }}
          onClose={onClose}
          editor={editor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          onOpenFind={vi.fn()}
        />,
      );
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(pageEscape).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', pageEscape);
      editor.destroy();
    }
  });
});

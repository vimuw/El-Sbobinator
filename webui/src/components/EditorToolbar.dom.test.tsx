import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import { EditorDocumentStyle } from '../editorDocumentStyle';
import { MenuBar } from './EditorToolbar';
import type { Editor as TiptapEditor } from '@tiptap/core';

const createMockEditor = (canUndo = true, canRedo = true) => {
  const undoRun = vi.fn().mockReturnValue(true);
  const redoRun = vi.fn().mockReturnValue(true);

  const editor = {
    isActive: vi.fn().mockReturnValue(false),
    can: vi.fn(() => ({
      undo: () => canUndo,
      redo: () => canRedo,
    })),
    getAttributes: vi.fn().mockReturnValue({}),
    chain: vi.fn(() => ({
      focus: vi.fn().mockReturnThis(),
      undo: vi.fn(() => ({ run: undoRun })),
      redo: vi.fn(() => ({ run: redoRun })),
      toggleBold: vi.fn().mockReturnThis(),
      toggleItalic: vi.fn().mockReturnThis(),
      toggleUnderline: vi.fn().mockReturnThis(),
      toggleStrike: vi.fn().mockReturnThis(),
      unsetAllMarks: vi.fn().mockReturnThis(),
      clearNodes: vi.fn().mockReturnThis(),
      toggleBulletList: vi.fn().mockReturnThis(),
      toggleOrderedList: vi.fn().mockReturnThis(),
      toggleBlockquote: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    })),
    on: vi.fn(),
    off: vi.fn(),
  };

  return { editor, undoRun, redoRun };
};

describe('EditorToolbar MenuBar', () => {
  it('renders zoom dropdown after undo/redo and before heading select', () => {
    const { editor } = createMockEditor();
    const onZoomChange = vi.fn();

    const { container } = render(
      <MenuBar
        editor={editor as unknown as TiptapEditor}
        onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
        showFindReplace={false}
        onToggleFindReplace={vi.fn()}
        onOpenLink={vi.fn()}
        zoomLevel={100}
        onZoomChange={onZoomChange}
      />
    );

    const toolbar = container.querySelector('.editor-toolbar');
    expect(toolbar).not.toBeNull();

    // Check elements order
    const undoBtn = screen.getByTitle('Annulla (Ctrl+Z)');
    const redoBtn = screen.getByTitle('Ripeti (Ctrl+Y)');
    const zoomSelect = screen.getByTitle('Livello di zoom');
    const headingSelect = screen.getByTitle('Stile paragrafo');
    const findBtn = screen.getByTitle('Trova e sostituisci (Ctrl+H)');

    // Verify DOM hierarchy / ordering
    expect(undoBtn.compareDocumentPosition(redoBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(redoBtn.compareDocumentPosition(zoomSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(zoomSelect.compareDocumentPosition(headingSelect) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(headingSelect.compareDocumentPosition(findBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens zoom dropdown and triggers onZoomChange with selected value', () => {
    const { editor } = createMockEditor();
    const onZoomChange = vi.fn();

    render(
      <MenuBar
        editor={editor as unknown as TiptapEditor}
        onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
        showFindReplace={false}
        onToggleFindReplace={vi.fn()}
        onOpenLink={vi.fn()}
        zoomLevel={100}
        onZoomChange={onZoomChange}
      />
    );

    const zoomBtn = screen.getByTitle('Livello di zoom');
    expect(zoomBtn.textContent).toContain('100%');

    fireEvent.click(zoomBtn);

    const opt150 = screen.getByRole('button', { name: '150%' });
    fireEvent.click(opt150);

    expect(onZoomChange).toHaveBeenCalledWith(150);
  });

  it('renders safely and disables buttons when editor.can() lacks undo and redo functions', () => {
    const editorWithoutUndo = {
      isActive: vi.fn().mockReturnValue(false),
      can: vi.fn(() => ({})), // no undo or redo defined
      getAttributes: vi.fn().mockReturnValue({}),
      chain: vi.fn(() => ({
        focus: vi.fn().mockReturnThis(),
        run: vi.fn().mockReturnValue(true),
      })),
      on: vi.fn(),
      off: vi.fn(),
    };

    expect(() => {
      render(
        <MenuBar
          editor={editorWithoutUndo as unknown as TiptapEditor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
        onOpenLink={vi.fn()}
        />
      );
    }).not.toThrow();

    const undoBtn = screen.getByTitle('Annulla (Ctrl+Z)') as HTMLButtonElement;
    const redoBtn = screen.getByTitle('Ripeti (Ctrl+Y)') as HTMLButtonElement;

    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Clicking does not crash
    expect(() => {
      fireEvent.click(undoBtn);
      fireEvent.click(redoBtn);
    }).not.toThrow();
  });

  it('refreshes the font control between paragraphs that differ only in paragraph style', () => {
    const editor = new Editor({ extensions: [StarterKit, TextStyle, FontFamily, EditorDocumentStyle], content: '<p style="font-family: Georgia, serif">Uno</p><p>Due</p>' });
    try {
      editor.commands.setTextSelection(2);
      render(
        <MenuBar
          editor={editor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
          zoomLevel={100}
          onZoomChange={vi.fn()}
        />
      );
      expect(screen.getByTitle('Carattere').textContent).toContain('Georgia');
      act(() => { editor.commands.setTextSelection(7); });
      expect(screen.getByTitle('Carattere').textContent).toContain('Arial');
    } finally { editor.destroy(); }
  });

  it('keeps the editor focused when toolbar and dropdown buttons are pressed', () => {
    const editor = new Editor({ extensions: [StarterKit], content: '<p>Uno</p>' });
    try {
      render(
        <MenuBar
          editor={editor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
        />
      );
      const list = screen.getByTitle('Elenco puntato');
      // fireEvent returns false once the default (moving focus to the button) is cancelled.
      expect(fireEvent.mouseDown(list)).toBe(false);
      expect(fireEvent.mouseDown(list.querySelector('svg')!)).toBe(false);
      // Secondary buttons keep their native behaviour.
      expect(fireEvent.mouseDown(list, { button: 2 })).toBe(true);
      fireEvent.click(list);
      expect(editor.isActive('bulletList')).toBe(true);

      // Portalled dropdown items bubble through React to the toolbar.
      fireEvent.click(screen.getByTitle('Allineamento testo'));
      expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Al centro' }))).toBe(false);

      // Text fields inside toolbar panels still take focus.
      fireEvent.click(screen.getByTitle('Inserisci link (Ctrl+K)'));
      const input = screen.getByPlaceholderText('https://...');
      expect(fireEvent.mouseDown(input)).toBe(true);
    } finally { editor.destroy(); }
  });

  it('keeps one row on a phone, with the index and the other tools behind "Aa"', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const { editor } = createMockEditor();
      const onTocToggle = vi.fn();
      const { container } = render(
        <MenuBar
          editor={editor as unknown as TiptapEditor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
          zoomLevel={100}
          onZoomChange={vi.fn()}
          isTocOpen={false}
          onTocToggle={onTocToggle}
        />
      );

      const row = container.querySelector('.editor-toolbar-row')!;
      expect(row.querySelector('[title^="Grassetto"]')).toBeTruthy();
      expect(row.querySelector('[title="Elenco puntato"]')).toBeTruthy();
      // Font, size and the insert buttons wait under "Aa".
      expect(screen.queryByTitle('Barrato')).toBeNull();
      expect(container.querySelector('.font-family-dropdown-btn')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Indice' }));
      expect(onTocToggle).toHaveBeenCalledTimes(1);

      const more = screen.getByRole('button', { name: 'Altri strumenti' });
      fireEvent.click(more);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      const panel = screen.getByRole('group', { name: 'Altri strumenti' });
      expect(panel.querySelector('[title="Barrato"]')).toBeTruthy();
      expect(panel.querySelector('.font-family-dropdown-btn')).toBeTruthy();
      expect(panel.querySelector('[title^="Trova e sostituisci"]')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the full toolbar without the index button above phone width', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    try {
      const { editor } = createMockEditor();
      const { container } = render(
        <MenuBar
          editor={editor as unknown as TiptapEditor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
          onTocToggle={vi.fn()}
        />
      );
      expect(container.querySelector('.editor-toolbar-row')).toBeNull();
      expect(screen.getByTitle('Barrato')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Indice' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

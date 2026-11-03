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

  it('keeps one row on a phone, with redo by undo and the other tools behind the arrow', () => {
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
      // Redo sits right after undo, not in the second row.
      const rowTitles = Array.from(row.children).map(child => child.getAttribute('title'));
      expect(rowTitles.slice(0, 2)).toEqual(['Annulla (Ctrl+Z)', 'Ripeti (Ctrl+Y)']);
      // Font, size and the insert buttons wait under the arrow.
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
      expect(panel.querySelector('[title="Elenco numerato"]')).toBeTruthy();
      expect(panel.querySelector('[title^="Ripeti"]')).toBeNull();
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
  // jsdom has no layout: groups from wrapFrom on report a second line, and the stubbed
  // ResizeObserver lets the test resize the window. Like a real one, it only reports for an
  // element it observes that is still on the page, until it is disconnected.
  const stubToolbarLayout = () => {
    let wrapFrom = Infinity;
    const observers: Array<{ callback: () => void; targets: Element[] }> = [];
    vi.stubGlobal('ResizeObserver', class {
      private entry: { callback: () => void; targets: Element[] };
      constructor(callback: () => void) {
        this.entry = { callback, targets: [] };
        observers.push(this.entry);
      }
      observe(target: Element) { this.entry.targets.push(target); }
      disconnect() { this.entry.targets = []; }
    });
    const offsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const parent = this.parentElement;
        if (!parent?.classList.contains('editor-toolbar-groups')) return 0;
        return Array.from(parent.children).indexOf(this) >= wrapFrom ? 40 : 0;
      },
    });
    const resize = (from: number) => {
      wrapFrom = from;
      act(() => observers
        .filter(({ targets }) => targets.some(target => target.isConnected))
        .forEach(({ callback }) => callback()));
    };
    const restore = () => {
      if (offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTop);
      vi.unstubAllGlobals();
    };
    return { resize, restore };
  };

  it('folds the toolbar groups that wrap behind the arrow and opens them on request', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { resize, restore } = stubToolbarLayout();
    try {
      const { editor } = createMockEditor();
      const { container } = render(
        <MenuBar
          editor={editor as unknown as TiptapEditor}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
        />
      );
      const toolbar = container.querySelector('.editor-toolbar-full')!;
      const groups = Array.from(container.querySelector('.editor-toolbar-groups')!.children);
      const groupOf = (title: string) => groups.find(group => group.querySelector(`[title^="${title}"]`))!;

      // Everything fits: one line and no arrow, as on a wide desktop window.
      expect(screen.queryByRole('button', { name: 'Altri strumenti' })).toBeNull();

      // A narrower window: the lists and search wrap and fold, bold stays on the first line.
      resize(groups.indexOf(groupOf('Elenco puntato')));
      const more = screen.getByRole('button', { name: 'Altri strumenti' });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      expect(groupOf('Elenco puntato').hasAttribute('data-wrapped')).toBe(true);
      expect(groupOf('Elenco puntato').hasAttribute('data-line-start')).toBe(true);
      expect(groupOf('Trova e sostituisci').hasAttribute('data-wrapped')).toBe(true);
      expect(groupOf('Grassetto').hasAttribute('data-wrapped')).toBe(false);
      expect(toolbar.classList.contains('is-expanded')).toBe(false);

      fireEvent.click(more);
      expect(more.getAttribute('aria-expanded')).toBe('true');
      expect(toolbar.classList.contains('is-expanded')).toBe(true);

      // Wide again: the arrow goes and the lines close, so the next overflow starts folded.
      resize(Infinity);
      expect(screen.queryByRole('button', { name: 'Altri strumenti' })).toBeNull();
      expect(toolbar.classList.contains('is-expanded')).toBe(false);
      expect(groupOf('Elenco puntato').hasAttribute('data-wrapped')).toBe(false);
    } finally {
      restore();
    }
  });

  it('watches the groups row that appears after the toolbar mounts', () => {
    // A fresh load renders the toolbar before TipTap creates the editor, and a phone turned
    // sideways swaps the phone row for the full one: a resize must still fold what wraps.
    let phone = false;
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: phone && query === '(max-width: 640px)' }));
    const { resize, restore } = stubToolbarLayout();
    try {
      const { editor } = createMockEditor();
      const menuBar = (current: TiptapEditor | null) => (
        <MenuBar
          editor={current}
          onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
        />
      );
      const arrow = () => screen.queryByRole('button', { name: 'Altri strumenti' });
      const { container, rerender } = render(menuBar(null));
      expect(container.querySelector('.editor-toolbar-groups')).toBeNull();

      rerender(menuBar(editor as unknown as TiptapEditor));
      expect(arrow()).toBeNull();
      resize(5);
      expect(arrow()).toBeTruthy();
      resize(Infinity);
      expect(arrow()).toBeNull();

      // Phone and back: the new row is watched, not the one the phone layout dropped.
      phone = true;
      rerender(menuBar(editor as unknown as TiptapEditor));
      expect(container.querySelector('.editor-toolbar-groups')).toBeNull();
      phone = false;
      rerender(menuBar(editor as unknown as TiptapEditor));
      expect(arrow()).toBeNull();
      resize(5);
      expect(arrow()).toBeTruthy();
    } finally {
      restore();
    }
  });
});

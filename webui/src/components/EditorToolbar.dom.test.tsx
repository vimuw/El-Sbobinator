import { fireEvent, render, screen, within } from '@testing-library/react';
import { act, useState } from 'react';
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

    // From the most used tools to the least used: a narrow window folds font, size and zoom first.
    const order = [
      'Annulla (Ctrl+Z)', 'Ripeti (Ctrl+Y)', 'Stile paragrafo', 'Grassetto (Ctrl+B)',
      'Evidenziatore', 'Elenco puntato', 'Trova e sostituisci (Ctrl+H)', 'Inserisci link (Ctrl+K)',
      'Inserisci immagine', 'Inserisci formula matematica (LaTeX)', 'Inserisci link a un video YouTube',
      'Allineamento testo', 'Citazione', 'Barrato', 'Rimuovi formattazione (Ctrl+\\)', 'Livello di zoom',
    ].map(title => screen.getByTitle(title));
    order.slice(1).forEach((control, index) => {
      expect(order[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    const fontFamily = container.querySelector('.font-family-dropdown-btn')!;
    expect(screen.getByTitle('Barrato').compareDocumentPosition(fontFamily) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fontFamily.compareDocumentPosition(screen.getByTitle('Livello di zoom')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('puts every phone tool on one scrolling row in the desktop order, with "+" beside it', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const { editor } = createMockEditor();
      const onOpenMath = vi.fn();
      const onOpenImagePicker = vi.fn();
      const { container } = render(
        <MenuBar
          editor={editor as unknown as TiptapEditor}
          onOpenMath={onOpenMath} onOpenImagePicker={onOpenImagePicker}
          showFindReplace={false}
          onToggleFindReplace={vi.fn()}
          onOpenLink={vi.fn()}
          zoomLevel={100}
          onZoomChange={vi.fn()}
        />
      );

      // One row, no arrow and no second row: like Google Docs, it scrolls sideways.
      const row = container.querySelector<HTMLElement>('.editor-toolbar-row')!;
      expect(screen.queryByRole('button', { name: 'Altri strumenti' })).toBeNull();
      const order = [
        'Annulla (Ctrl+Z)', 'Ripeti (Ctrl+Y)', 'Stile paragrafo', 'Grassetto (Ctrl+B)',
        'Sottolineato (Ctrl+U)', 'Evidenziatore', 'Elenco puntato', 'Elenco numerato',
        'Allineamento testo', 'Citazione', 'Barrato', 'Rimuovi formattazione (Ctrl+\\)', 'Livello di zoom',
      ].map(title => within(row).getByTitle(title));
      order.slice(1).forEach((control, index) => {
        expect(order[index].compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      });
      expect(row.querySelector('.font-family-dropdown-btn')).toBeTruthy();
      // Search is in the header menu and the inserts under "+", not on the row.
      expect(within(row).queryByTitle('Trova e sostituisci (Ctrl+H)')).toBeNull();
      expect(row.querySelector('[title^="Inserisci"]')).toBeNull();

      // The edge fades only where tools hide (jsdom has no layout: fake the scroller's sizes).
      Object.defineProperties(row, {
        scrollWidth: { configurable: true, value: 700 },
        clientWidth: { configurable: true, value: 300 },
        scrollLeft: { configurable: true, writable: true, value: 0 },
      });
      fireEvent.scroll(row);
      expect(row.hasAttribute('data-more-right')).toBe(true);
      expect(row.hasAttribute('data-more-left')).toBe(false);
      row.scrollLeft = 400;
      fireEvent.scroll(row);
      expect(row.hasAttribute('data-more-right')).toBe(false);
      expect(row.hasAttribute('data-more-left')).toBe(true);

      // The index moved to the header menu; links, images, formulas and videos are listed by
      // name under "+".
      expect(screen.queryByRole('button', { name: 'Indice' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Inserisci' }));
      for (const label of ['Link', 'Immagine', 'Formula', 'Video YouTube']) {
        expect(screen.getByRole('button', { name: label })).toBeTruthy();
      }
      fireEvent.click(screen.getByRole('button', { name: 'Formula' }));
      expect(onOpenMath).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('button', { name: 'Inserisci' }));
      fireEvent.click(screen.getByRole('button', { name: 'Immagine' }));
      expect(onOpenImagePicker).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('opens the link panel under "+" on a phone, where the link button is hidden', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const { editor } = createMockEditor();
      // Like RichTextEditor: "+" → Link, "+" → Video YouTube, Ctrl+K and the context menu all
      // bump the request the toolbar's hidden link button answers.
      const Harness = () => {
        const [linkRequest, setLinkRequest] = useState(0);
        return (
          <MenuBar
            editor={editor as unknown as TiptapEditor}
            onOpenMath={vi.fn()} onOpenImagePicker={vi.fn()}
            showFindReplace={false}
            onToggleFindReplace={vi.fn()}
            linkRequest={linkRequest}
            onOpenLink={() => setLinkRequest(request => request + 1)}
          />
        );
      };
      const { container } = render(<Harness />);
      expect(screen.queryByTitle('Inserisci link (Ctrl+K)')).toBeNull();
      expect(document.querySelector('.link-panel')).toBeNull();

      // jsdom has no layout: place "+" at the right end of the toolbar.
      const anchor = container.querySelector<HTMLElement>('.editor-insert-menu')!;
      anchor.getBoundingClientRect = () => ({ top: 8, bottom: 44, left: 330, right: 366, width: 36, height: 36, x: 330, y: 8, toJSON: () => ({}) });

      fireEvent.click(screen.getByRole('button', { name: 'Inserisci' }));
      fireEvent.click(screen.getByRole('button', { name: 'Link' }));
      const panel = document.querySelector<HTMLElement>('.link-panel')!;
      expect(panel).toBeTruthy();
      expect(within(panel).getByPlaceholderText('https://...')).toBeTruthy();
      expect(panel.style.top).toBe('50px');
      expect(panel.style.left).toBe('330px');

      // Closed by a tap elsewhere, the video entry opens it again.
      fireEvent.mouseDown(document.body);
      expect(document.querySelector('.link-panel')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Inserisci' }));
      fireEvent.click(screen.getByRole('button', { name: 'Video YouTube' }));
      expect(document.querySelector('.link-panel')).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the full toolbar without the phone insert menu above phone width', () => {
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
        />
      );
      expect(container.querySelector('.editor-toolbar-row')).toBeNull();
      expect(screen.getByTitle('Barrato')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Inserisci' })).toBeNull();
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

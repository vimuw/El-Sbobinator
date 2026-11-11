import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorFullPage } from './EditorFullPage';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
import { WEB_CAPABILITIES } from '../web/webHost';

const editorMockState = vi.hoisted(() => ({ html: '<p>editor content</p>' }));
const audioPlayerProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_: unknown, tag: string) => {
      return React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
        const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, variants: _v, ...rest } = props;
        return React.createElement(tag, { ...rest, ref: ref as React.Ref<unknown> });
      });
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('./RichTextEditor', () => ({
  RichTextEditor: ({
    onEditorReady,
    onChange,
    bottomInset,
    isTocOpen,
    findRequest,
    zoomLevel,
    zoomInHeaderMenu,
  }: {
    onEditorReady?: (getHtml: () => string) => void;
    onChange?: () => void;
    bottomInset?: number;
    isTocOpen?: boolean;
    findRequest?: number;
    zoomLevel?: number;
    zoomInHeaderMenu?: boolean;
  }) => {
    React.useEffect(() => {
      onEditorReady?.(() => editorMockState.html);
    }, [onEditorReady]);
    return React.createElement('div', {
      'data-testid': 'rich-text-editor',
      'data-bottom-inset': bottomInset,
      'data-toc-open': String(Boolean(isTocOpen)),
      'data-find-request': findRequest ?? 0,
      'data-zoom': zoomLevel,
      'data-zoom-in-header-menu': String(Boolean(zoomInHeaderMenu)),
      onClick: () => onChange?.(),
    }, 'Editor');
  },
}));

vi.mock('./AudioPlayer', () => ({
  AudioPlayer: (props: Record<string, unknown>) => {
    audioPlayerProps.current = props;
    return React.createElement('div', { 'data-testid': 'audio-player' }, 'Player');
  },
}));

const baseProps = {
  previewContent: '<p>Hello world</p>',
  previewTitle: 'My Document',
  htmlPath: '/sessions/out.html',
  onClose: vi.fn(),
  audioSrc: null,
  audioRelinkNeeded: false,
  onRelink: vi.fn().mockResolvedValue(false),
  previewInitAudio: {},
  previewInitScrollTop: undefined,
  onAudioStateChange: vi.fn(),
  onScrollTopChange: vi.fn(),
};

it('shows preparation instead of offering to add or relink audio during conversion', async () => {
  render(<EditorFullPage {...baseProps} audio={{
    src: null, relinkNeeded: false, loading: true,
    onRelink: vi.fn(), init: {}, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByText('Preparazione audio della sbobina...')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Aggiungi audio|Ricollega audio/ })).toBeNull();
});

it('keeps a folded player folded while its audio gets ready: the pill, not the open bar', async () => {
  localStorage.setItem('el-sbobinator.audio-player.v1', JSON.stringify({ collapsed: true, side: 'right' }));
  const { container } = render(<EditorFullPage {...baseProps} audio={{
    src: null, relinkNeeded: false, loading: true,
    onRelink: vi.fn(), init: { time: 30, duration: 60 }, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByRole('button', { name: /Mostra il player audio/ })).toBeTruthy();
  expect(screen.queryByText('Preparazione audio della sbobina...')).toBeNull();
  expect(container.querySelector('.editor-player-dock > .audio-player.is-collapsed')).not.toBeNull();
  const ring = container.querySelector('.player-pill-progress')!;
  expect(Number(ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(Number(ring.getAttribute('stroke-dasharray')) / 2);
  localStorage.removeItem('el-sbobinator.audio-player.v1');
});

it('draws the empty dock while checking a sbobina that had no audio last time, its buttons on hold', async () => {
  const { container } = render(<EditorFullPage {...baseProps} audio={{
    src: null, relinkNeeded: false, loading: true, expected: 'none',
    onRelink: vi.fn(), init: {}, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByText('Nessun audio collegato')).toBeTruthy();
  expect(screen.queryByText('Preparazione audio della sbobina...')).toBeNull();
  expect((screen.getByRole('button', { name: /Aggiungi audio/ }) as HTMLButtonElement).disabled).toBe(true);
  expect(container.querySelector('.editor-player-dock > .audio-dock-empty')).not.toBeNull();
});

it('keeps the folded empty dock as its headphones pill while checking, not the player pill', async () => {
  localStorage.setItem('el-sbobinator.audio-player.v1', JSON.stringify({ collapsed: true, side: 'right' }));
  const { container } = render(<EditorFullPage {...baseProps} audio={{
    src: null, relinkNeeded: false, loading: true, expected: 'missing',
    onRelink: vi.fn(), init: {}, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByRole('button', { name: 'Mostra la barra audio (audio non trovato)' })).toBeTruthy();
  expect(container.querySelector('.audio-dock-pill-badge')).not.toBeNull();
  expect(container.querySelector('.player-pill-ring')).toBeNull();
  localStorage.removeItem('el-sbobinator.audio-player.v1');
});

it('shows an original-file dependency warning under the header, outside the player, until closed', async () => {
  const { container } = render(<EditorFullPage {...baseProps} audio={{
    src: '/original.wav', relinkNeeded: false, warning: 'Conserva il file originale.',
    onRelink: vi.fn(), init: {}, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByTestId('audio-player')).toBeTruthy();
  const warning = screen.getByTestId('editor-audio-warning');
  expect(warning.textContent).toContain('Conserva il file originale.');
  expect(container.querySelector('.editor-fullpage-footer')!.contains(warning)).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: 'Chiudi avviso audio' }));
  expect(screen.queryByText('Conserva il file originale.')).toBeNull();
});

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  editorMockState.html = '<p>editor content</p>';
  localStorage.clear();
  setPywebview(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  localStorage.clear();
  setPywebview(undefined);
});

describe('EditorFullPage autosave', () => {
  it.each([null, '/audio/test.mp3'])('keeps one shortcuts button in the header with audio %s', async audioSrc => {
    render(<EditorFullPage {...baseProps} audioSrc={audioSrc} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    const buttons = screen.getAllByRole('button', { name: 'Scorciatoie da tastiera' });
    expect(buttons).toHaveLength(1);
    expect(buttons[0].closest('.editor-fullpage-actions')).toBeTruthy();
  });

  it('does not close when final autosave is skipped by the backend', async () => {
    const onClose = vi.fn();
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: false, saved: false, error: 'stale' });
    setPywebview({ save_html_content: saveHtmlContent });
    render(<EditorFullPage {...baseProps} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    editorMockState.html = '<p>changed content</p>';

    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Indietro/i }));
      await Promise.resolve();
    });

    expect(saveHtmlContent).toHaveBeenCalledWith('/sessions/out.html', '<p>changed content</p>', expect.any(Number));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Errore salvataggio')).toBeTruthy();
  });

  it('does not report saved when scheduled autosave is skipped by the backend', async () => {
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: true, saved: false, error: 'stale' });
    setPywebview({ save_html_content: saveHtmlContent });
    render(<EditorFullPage {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    editorMockState.html = '<p>changed content</p>';

    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    expect(saveHtmlContent).toHaveBeenCalledWith('/sessions/out.html', '<p>changed content</p>', expect.any(Number));
    expect(screen.getByText('Errore salvataggio')).toBeTruthy();
    expect(screen.queryByText('Salvato')).toBeNull();
  });

  it('keeps autosave generations monotonic when the same document is reopened', async () => {
    const onClose = vi.fn();
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: true, saved: true });
    const htmlPath = '/sessions/reopened-editor-fullpage.html';
    setPywebview({ save_html_content: saveHtmlContent });

    const firstRender = render(<EditorFullPage {...baseProps} htmlPath={htmlPath} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    editorMockState.html = '<p>first edit</p>';
    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
      fireEvent.click(screen.getByRole('button', { name: /Indietro/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const firstGeneration = saveHtmlContent.mock.calls[0][2] as number;
    firstRender.unmount();

    onClose.mockClear();
    editorMockState.html = '<p>second edit</p>';
    const secondRender = render(<EditorFullPage {...baseProps} htmlPath={htmlPath} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
      fireEvent.click(screen.getByRole('button', { name: /Indietro/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const secondGeneration = saveHtmlContent.mock.calls[1][2] as number;
    secondRender.unmount();

    expect(secondGeneration).toBeGreaterThan(firstGeneration);
  });

  it('renders formatted copy before shortcuts and the theme toggle without an open HTML action', async () => {
    const setThemeMode = vi.fn();
    render(<EditorFullPage {...baseProps} themeMode="dark" setThemeMode={setThemeMode} />);

    const copyBtn = screen.getByRole('button', { name: 'Copia documento' });
    const shortcutsBtn = screen.getByRole('button', { name: 'Scorciatoie da tastiera' });
    const themeBtn = screen.getByTitle('Tema chiaro');

    expect(copyBtn).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apri file HTML' })).toBeNull();
    expect(themeBtn).toBeTruthy();

    // Verify order: copyBtn -> shortcutsBtn -> themeBtn
    const buttons = screen.getAllByRole('button');
    const copyIndex = buttons.indexOf(copyBtn);
    const shortcutsIndex = buttons.indexOf(shortcutsBtn);
    const themeIndex = buttons.indexOf(themeBtn);

    expect(copyIndex).toBeGreaterThan(-1);
    expect(shortcutsIndex).toBeGreaterThan(copyIndex);
    expect(themeIndex).toBeGreaterThan(shortcutsIndex);

    // Copia documento is the header's filled primary pill; the utilities stay icon buttons.
    expect(copyBtn.classList.contains('settings-pill-button')).toBe(true);
    expect(copyBtn.classList.contains('icon-button')).toBe(false);
    expect(themeBtn.classList.contains('icon-button')).toBe(true);

    // Toggling theme calls setThemeMode
    fireEvent.click(themeBtn);
    expect(setThemeMode).toHaveBeenCalled();
  });
  it('copies the edited document as formatted HTML and plain text', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const formats: Record<string, string> = {};
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: (type: string, value: string) => { formats[type] = value; } } });
      document.activeElement!.dispatchEvent(event);
      return true;
    }) });
    class TestClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: TestClipboardItem });
    // The macOS desktop app runs in WKWebView (Apple vendor too): it keeps the Docs-native formats.
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    try {
      editorMockState.html = '<h2>Appunti corretti</h2><p>Testo <strong>importante</strong></p>';
      render(<EditorFullPage {...baseProps} />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Copia documento' }));
      // Safari rejects clipboard writes that start after the click handler has returned.
      expect(formats['text/html']).toBeTruthy();
      const copied = new DOMParser().parseFromString(formats['text/html'], 'text/html');
      expect(copied.querySelector('strong')?.textContent).toBe('importante');
      expect(copied.querySelector('h2')?.style.fontSize).toBe('16pt');
      expect(formats['text/plain']).toBe('Appunti corretti\nTesto importante\n');
      expect(formats['application/x-vnd.google-docs-document-slice-clip+wrapped']).toBeTruthy();
      expect(write).not.toHaveBeenCalled();
    } finally {
      vendor.mockRestore();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (clipboardItemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', clipboardItemDescriptor);
      else Reflect.deleteProperty(globalThis, 'ClipboardItem');
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('web on iPad Safari: writes the clipboard with ClipboardItem inside the tap, no hidden textarea', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    const execCommand = vi.fn(() => true);
    class TestClipboardItem {
      constructor(public data: Record<string, Blob>) {}
    }
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: TestClipboardItem });
    setHostCapabilities({ kind: 'web' });
    try {
      editorMockState.html = '<h2>Appunti corretti</h2><p>Testo <strong>importante</strong></p><ul><li><p>uno</p><ul><li><p>due</p></li></ul></li></ul>';
      render(<EditorFullPage {...baseProps} />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Copia documento' }));
      // Started before the click handler returned: Safari refuses a write that starts later.
      expect(write).toHaveBeenCalledTimes(1);
      expect(execCommand).not.toHaveBeenCalled();
      const [item] = write.mock.calls[0][0] as TestClipboardItem[];
      expect(Object.keys(item.data).sort()).toEqual(['text/html', 'text/plain']);
      const copied = new DOMParser().parseFromString(await item.data['text/html'].text(), 'text/html');
      expect(copied.querySelector('strong')?.textContent).toBe('importante');
      expect(copied.querySelector('h2')?.style.fontSize).toBe('16pt');
      expect(copied.querySelector('ul ul li')?.textContent).toBe('due');
      expect(await item.data['text/plain'].text()).toContain('Testo importante');
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copia documento' }).textContent).toContain('Copiato!'));
      // Without images the copy is complete: no pointer to the .docx.
      expect(screen.queryByTestId('editor-export-notice')).toBeNull();
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
      vendor.mockRestore();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (clipboardItemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', clipboardItemDescriptor);
      else Reflect.deleteProperty(globalThis, 'ClipboardItem');
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('web on iPad: a copy with images points to the .docx, which downloads inside the tap', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const clipboardItemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write } });
    Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class { constructor(public data: Record<string, Blob>) {} } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:docx');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setHostCapabilities({ kind: 'web' });
    try {
      editorMockState.html = '<p>Testo</p><div data-editor-image="true" data-width="35" data-layout="inline"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Figura"></div>';
      render(<EditorFullPage {...baseProps} previewTitle="Anatomia" />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Copia documento' }));
      expect((await screen.findByTestId('editor-export-notice')).textContent).toContain('Scarica .docx');

      fireEvent.click(screen.getByRole('button', { name: 'Scarica .docx' }));
      // Synchronous: the anchor is clicked before the tap handler returns.
      expect(click).toHaveBeenCalledTimes(1);
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Anatomia.docx');
      expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(screen.queryByTestId('editor-export-notice')).toBeNull();
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
      vendor.mockRestore();
      createObjectURL.mockRestore();
      click.mockRestore();
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
      if (clipboardItemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', clipboardItemDescriptor);
      else Reflect.deleteProperty(globalThis, 'ClipboardItem');
    }
  });

  it('phone: lists copy, .docx, index, search, zoom and theme by name under "…", export first', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 640px)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:docx');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    setHostCapabilities({ kind: 'web' });
    const setThemeMode = vi.fn();
    try {
      const title = 'PATOLOGIA GENERALE 1, LEZIONE 7';
      render(<EditorFullPage {...baseProps} previewTitle={title} themeMode="dark" setThemeMode={setThemeMode} />);
      await screen.findByTestId('rich-text-editor');
      // The mocked motion remounts the page on each render: read the editor afresh.
      const editor = () => screen.getByTestId('rich-text-editor');

      // The header keeps back and "…" (which takes the zoom from the toolbar); the title stays
      // between them, cut short. "+" stays on the toolbar beside "A".
      expect(screen.queryByRole('button', { name: 'Copia documento' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Scarica .docx' })).toBeNull();
      expect(screen.queryByTitle('Tema chiaro')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Scorciatoie da tastiera' })).toBeNull();
      const header = document.querySelector('.editor-fullpage-header')!;
      expect(header.querySelectorAll('button')).toHaveLength(2);
      expect(editor().getAttribute('data-zoom-in-header-menu')).toBe('true');
      expect(within(header as HTMLElement).getByText(title).classList.contains('truncate')).toBe(true);

      const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Altre opzioni' }));
      openMenu();
      // The whole title the header cuts heads the menu.
      expect(document.querySelector('.kebab-heading')?.textContent).toBe(title);
      // Export, then the editing tools, then the preference, each group apart.
      const panel = document.querySelector('.kebab-panel')!;
      expect(Array.from(panel.children, el => el.classList.contains('kebab-separator') ? '—' : el.textContent)).toEqual([
        title, 'Copia documento', 'Scarica .docx', '—', 'Indice', 'Trova e sostituisci', '—', 'Zoom 100%', 'Tema chiaro',
      ]);
      // The zoom left the toolbar row: its levels wait in a submenu.
      fireEvent.click(screen.getByRole('button', { name: 'Zoom 100%' }));
      fireEvent.click(screen.getByRole('button', { name: '125%' }));
      expect(editor().getAttribute('data-zoom')).toBe('125');
      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Indice' }));
      expect(editor().getAttribute('data-toc-open')).toBe('true');

      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Trova e sostituisci' }));
      expect(editor().getAttribute('data-find-request')).toBe('1');

      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Scarica .docx' }));
      expect(click).toHaveBeenCalledTimes(1);
      expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe(`${title}.docx`);

      openMenu();
      fireEvent.click(screen.getByRole('button', { name: 'Tema chiaro' }));
      expect(setThemeMode).toHaveBeenCalledTimes(1);
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
      createObjectURL.mockRestore();
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('phone: copies from the "…" menu inside the tap and confirms it once the menu closes', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(max-width: 640px)',
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    // iPhone Safari: the copy must start before the tap handler returns.
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    const exec = vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
      document.activeElement!.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    setHostCapabilities({ kind: 'web' });
    try {
      editorMockState.html = '<p>Testo</p><div data-editor-image="true" data-width="35" data-layout="inline"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Figura"></div>';
      render(<EditorFullPage {...baseProps} />);
      await screen.findByTestId('rich-text-editor');
      expect(screen.queryByTestId('editor-copied-toast')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Altre opzioni' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copia documento' }));
      expect(exec).toHaveBeenCalledTimes(1);
      const toast = await screen.findByTestId('editor-copied-toast');
      expect(toast.textContent).toContain('Copiato!');
      // Beside "…", where the eye still is after the tap, not by the player at the bottom.
      expect(toast.closest('.editor-fullpage-header')).toBeTruthy();
      await waitFor(() => expect(document.querySelector('.kebab-panel')).toBeNull());
      // The header has no download icon here: the image notice points to the menu instead.
      expect(screen.getByTestId('editor-export-notice').textContent).toContain('Scarica .docx” dal menu “…”');
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
      vendor.mockRestore();
      vi.unstubAllGlobals();
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('desktop has no .docx button: its copy already carries the images', async () => {
    render(<EditorFullPage {...baseProps} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Scarica .docx' })).toBeNull();
  });

  it('shows the pressed copy before the blocking clipboard work and ignores repeated clicks', async () => {
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    // jsdom reports Apple as its vendor; the desktop app on Windows runs Chromium (WebView2).
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Google Inc.');
    const exec = vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
      document.activeElement!.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    try {
      editorMockState.html = '<p>Testo</p>';
      render(<EditorFullPage {...baseProps} />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      // The motion mock remounts the page on every render, so query the button afresh.
      const copyBtn = () => screen.getByRole('button', { name: 'Copia documento' });
      fireEvent.click(copyBtn());
      fireEvent.click(copyBtn());
      // The busy state paints first; the synchronous copy waits for the next frame.
      expect(copyBtn().getAttribute('aria-busy')).toBe('true');
      expect(exec).not.toHaveBeenCalled();
      await waitFor(() => expect(copyBtn().textContent).toContain('Copiato!'));
      expect(exec).toHaveBeenCalledTimes(1);
      expect(copyBtn().getAttribute('aria-busy')).toBe('false');
    } finally {
      vendor.mockRestore();
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('starts the copy inside the click on WebKit, which ends user activation after a frame', async () => {
    const execDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const vendor = vi.spyOn(navigator, 'vendor', 'get').mockReturnValue('Apple Computer, Inc.');
    const exec = vi.fn(() => {
      const event = new Event('copy', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { setData: vi.fn() } });
      document.activeElement!.dispatchEvent(event);
      return true;
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
    try {
      editorMockState.html = '<p>Testo</p>';
      render(<EditorFullPage {...baseProps} />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      fireEvent.click(screen.getByRole('button', { name: 'Copia documento' }));
      expect(exec).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Copia documento' }).textContent).toContain('Copiato!'));
    } finally {
      vendor.mockRestore();
      if (execDescriptor) Object.defineProperty(document, 'execCommand', execDescriptor);
      else Reflect.deleteProperty(document, 'execCommand');
    }
  });

  it('supports domain-grouped props and binds saveControllerRef', async () => {
    const saveControllerRef = { current: null };
    render(
      <EditorFullPage
        document={{
          content: '<p>Initial text</p>',
          title: 'Grouped Doc',
          htmlPath: '/sessions/grouped.html',
        }}
        audio={{
          src: null,
          relinkNeeded: false,
          onRelink: vi.fn().mockResolvedValue(false),
          init: {},
          onStateChange: vi.fn(),
        }}
        onClose={vi.fn()}
        saveControllerRef={saveControllerRef}
      />,
    );

    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    expect(saveControllerRef.current).not.toBeNull();
    expect(typeof saveControllerRef.current?.getDirtyContent).toBe('function');
    expect(typeof saveControllerRef.current?.flushPendingAutosave).toBe('function');
    expect(typeof saveControllerRef.current?.cancelPendingAutosave).toBe('function');
    expect(saveControllerRef.current?.getDirtyContent()).toBeNull();
  });

  it('renders Rimuovi audio button when audioRelinkNeeded is true and onRemoveAudio is provided', async () => {
    const onRemoveAudio = vi.fn().mockResolvedValue(undefined);
    render(
      <EditorFullPage
        {...baseProps}
        audio={{
          src: null,
          relinkNeeded: true,
          onRelink: vi.fn(),
          onRemoveAudio,
          init: {},
          onStateChange: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Audio non trovato')).toBeTruthy();
    const removeBtn = screen.getByText('Rimuovi audio');
    expect(removeBtn).toBeTruthy();
    // Both footer actions are outline pills, like the secondary settings actions.
    for (const action of [removeBtn, screen.getByRole('button', { name: 'Ricollega audio' })]) {
      expect(action.classList.contains('app-button-secondary')).toBe(true);
      expect(action.classList.contains('is-settings-action')).toBe(true);
      expect(action.classList.contains('premium-button-secondary')).toBe(false);
    }

    await act(async () => {
      fireEvent.click(removeBtn);
    });
    expect(screen.getByText("Rimuovere l'audio mancante?")).toBeTruthy();

    const modal = screen.getByText("Rimuovere l'audio mancante?").closest('.modal-card') as HTMLElement;
    const confirmBtn = within(modal).getByRole('button', { name: 'Rimuovi audio' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(onRemoveAudio).toHaveBeenCalledTimes(1);
  });

  it('renders empty audio bar with "Nessun audio collegato" and "Aggiungi audio" button when no audio is present', async () => {
    const onRelink = vi.fn().mockResolvedValue(true);
    render(
      <EditorFullPage
        {...baseProps}
        audio={{
          src: null,
          relinkNeeded: false,
          onRelink,
          init: {},
          onStateChange: vi.fn(),
        }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('Nessun audio collegato')).toBeTruthy();
    expect(screen.getByText('Aggiungi un file audio: una copia verrà conservata nella sbobina.')).toBeTruthy();
    const addBtn = screen.getByRole('button', { name: /Aggiungi audio/i });
    expect(addBtn).toBeTruthy();
    expect(addBtn.classList.contains('settings-pill-button')).toBe(true);
    expect(addBtn.classList.contains('premium-button')).toBe(false);

    await act(async () => {
      fireEvent.click(addBtn);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('floats the player in a dock and reserves its measured height in the editor', async () => {
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('editor-fullpage-footer') ? 61.4 : 0 } as DOMRect;
    });
    try {
      const { container } = render(<EditorFullPage {...baseProps} audioSrc="/audio.mp3" onClose={vi.fn()} />);

      const footer = container.querySelector('.editor-fullpage-footer') as HTMLElement;
      expect(footer.querySelector('.editor-player-dock [data-testid="audio-player"]')).not.toBeNull();
      expect((await screen.findByTestId('rich-text-editor')).getAttribute('data-bottom-inset')).toBe('62');
    } finally {
      rect.mockRestore();
    }
  });
});

describe('EditorFullPage title rename', () => {
  // Queried afresh: the motion mock above remounts the header on every render.
  const titleInput = () => screen.getByRole('textbox', { name: 'Nome sbobina' }) as HTMLInputElement;

  function RenameHarness({ onRename, onClose = vi.fn() }: { onRename: (title: string) => Promise<void>; onClose?: () => void }) {
    const [title, setTitle] = React.useState('Lezione 1');
    return (
      <EditorFullPage
        {...baseProps}
        onClose={onClose}
        document={{
          content: '<p>Testo</p>',
          title,
          htmlPath: '/sessions/out.html',
          onRename: async next => { await onRename(next); setTitle(next); },
        }}
      />
    );
  }

  it('renames the sbobina from its title: a click opens the field, Enter saves it', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameHarness onRename={onRename} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    expect(titleInput().value).toBe('Lezione 1');
    fireEvent.change(titleInput(), { target: { value: '  Anatomia 3  ' } });
    await act(async () => {
      fireEvent.keyDown(titleInput(), { key: 'Enter' });
    });

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith('Anatomia 3');
    expect(screen.queryByRole('textbox', { name: 'Nome sbobina' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Anatomia 3' })).toBeTruthy();
  });

  // Regression: the field opened at its widest (480px) even for a short name. A hidden copy of the
  // name sizes it now, so it keeps the button's width and grows with the typing.
  it('sizes the name field to the name being typed', () => {
    render(<RenameHarness onRename={vi.fn().mockResolvedValue(undefined)} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    const field = () => titleInput().closest('.editor-fullpage-title-field') as HTMLElement;
    expect(field().dataset.value).toBe('Lezione 1');
    expect(titleInput().size).toBe(1);

    fireEvent.change(titleInput(), { target: { value: 'Lezione 1 — anatomia del rene' } });
    expect(field().dataset.value).toBe('Lezione 1 — anatomia del rene');
  });

  it('drops the new name on Escape without closing the editor', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<RenameHarness onRename={onRename} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    fireEvent.change(titleInput(), { target: { value: 'Altro nome' } });
    await act(async () => {
      fireEvent.keyDown(titleInput(), { key: 'Escape' });
    });

    expect(onRename).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Lezione 1' })).toBeTruthy();
  });

  it('saves on leaving the field, and leaves an empty or unchanged name alone', async () => {
    const onRename = vi.fn().mockResolvedValue(undefined);
    render(<RenameHarness onRename={onRename} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    fireEvent.change(titleInput(), { target: { value: '   ' } });
    await act(async () => { fireEvent.blur(titleInput()); });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    fireEvent.change(titleInput(), { target: { value: 'Lezione 2' } });
    await act(async () => { fireEvent.blur(titleInput()); });
    expect(onRename).toHaveBeenCalledWith('Lezione 2');
    expect(screen.getByRole('button', { name: 'Lezione 2' })).toBeTruthy();
  });

  it('keeps the old title and says why when the rename fails', async () => {
    const onRename = vi.fn().mockRejectedValue(new Error('Puoi rinominare solo sbobine completate.'));
    render(<RenameHarness onRename={onRename} />);

    fireEvent.click(screen.getByRole('button', { name: 'Lezione 1' }));
    fireEvent.change(titleInput(), { target: { value: 'Nuovo' } });
    await act(async () => {
      fireEvent.keyDown(titleInput(), { key: 'Enter' });
    });

    expect(screen.getByRole('button', { name: 'Lezione 1' })).toBeTruthy();
    expect(screen.getByTestId('editor-export-notice').textContent).toContain('Puoi rinominare solo sbobine completate.');
  });

  it('shows a plain title when the sbobina cannot be renamed', () => {
    render(<EditorFullPage {...baseProps} />);
    expect(screen.getByText('My Document').tagName).toBe('SPAN');
    expect(screen.queryByRole('button', { name: 'My Document' })).toBeNull();
  });
});

describe('EditorFullPage on hosts without session audio', () => {
  afterEach(() => setHostCapabilities(DESKTOP_CAPABILITIES));

  it('shows no audio dock and no player shortcuts', async () => {
    setHostCapabilities({ kind: 'web', editorAudio: false });
    render(<EditorFullPage {...baseProps} audio={{ src: null, relinkNeeded: true, onRelink: vi.fn(), init: {}, onStateChange: vi.fn() }} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());

    expect(screen.queryByText('Nessun audio collegato')).toBeNull();
    expect(screen.queryByText('Audio non trovato')).toBeNull();
    expect(screen.queryByRole('button', { name: /Aggiungi audio|Ricollega audio/ })).toBeNull();
    expect(screen.getByTestId('rich-text-editor').getAttribute('data-bottom-inset')).toBe('0');
  });
});

describe('EditorFullPage on the web build', () => {
  afterEach(() => setHostCapabilities(DESKTOP_CAPABILITIES));

  it('docks the player for the audio of the sbobina, and offers to choose the file when there is none', async () => {
    setHostCapabilities(WEB_CAPABILITIES);
    const { container, rerender } = render(<EditorFullPage {...baseProps} audioSrc="blob:https://web.test/1" onClose={vi.fn()} />);
    expect(container.querySelector('.editor-player-dock [data-testid="audio-player"]')).not.toBeNull();

    const onRelink = vi.fn().mockResolvedValue(true);
    rerender(<EditorFullPage {...baseProps} audio={{ src: null, relinkNeeded: false, onRelink, init: {}, onStateChange: vi.fn() }} />);
    expect(screen.getByText('Nessun audio collegato')).toBeTruthy();
    expect(screen.queryByText(/una copia verrà conservata/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scegli il file audio' }));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('gives the web player the switch to keep the audio in the browser instead of removing it', () => {
    setHostCapabilities(WEB_CAPABILITIES);
    const onKeepChange = vi.fn();
    render(<EditorFullPage {...baseProps} audio={{ src: 'blob:test/1', relinkNeeded: false, onRelink: vi.fn(), onRemoveAudio: vi.fn(), kept: true, size: 2048, onKeepChange, init: {}, onStateChange: vi.fn() }} />);
    expect(audioPlayerProps.current).toMatchObject({ onRemoveAudio: undefined, keep: { kept: true, size: 2048, onChange: onKeepChange } });

    setHostCapabilities(DESKTOP_CAPABILITIES);
    const onRemoveAudio = vi.fn();
    render(<EditorFullPage {...baseProps} audio={{ src: '/audio.mp3', relinkNeeded: false, onRelink: vi.fn(), onRemoveAudio, onKeepChange, init: {}, onStateChange: vi.fn() }} />);
    expect(audioPlayerProps.current).toMatchObject({ onRemoveAudio, keep: undefined });
  });

  it('asks for the lecture file the browser does not keep, with nothing to remove', async () => {
    setHostCapabilities(WEB_CAPABILITIES);
    const onRelink = vi.fn().mockResolvedValue(true);
    render(<EditorFullPage {...baseProps} audio={{ src: null, relinkNeeded: true, onRelink, onRemoveAudio: vi.fn(), init: {}, onStateChange: vi.fn() }} />);

    expect(screen.getByText('Audio non salvato')).toBeTruthy();
    expect(screen.getByText('Scegli il file della lezione per riascoltarla mentre rileggi.')).toBeTruthy();
    expect(screen.queryByText('Audio non trovato')).toBeNull();
    expect(screen.queryByRole('button', { name: /Rimuovi audio/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ricollega audio' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Scegli il file audio' }));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Audio pronto')).toBeTruthy();
  });

  it('fits above the on-screen keyboard so the player and the caret stay visible', async () => {
    vi.stubGlobal('innerHeight', 1180);
    const viewport = Object.assign(new EventTarget(), { height: 1180, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    try {
      setHostCapabilities(WEB_CAPABILITIES);
      const { container } = render(<EditorFullPage {...baseProps} audioSrc="blob:https://web.test/1" />);
      await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
      // Queried each time: the motion mock remounts the element on every render.
      const page = () => container.querySelector<HTMLElement>('.editor-fullpage')!;
      expect(page().style.bottom).toBe('');

      act(() => {
        Object.assign(viewport, { height: 760, offsetTop: 40 });
        viewport.dispatchEvent(new Event('resize'));
      });
      expect(page().style.top).toBe('40px');
      expect(page().style.bottom).toBe('380px');

      act(() => {
        Object.assign(viewport, { height: 1180, offsetTop: 0 });
        viewport.dispatchEvent(new Event('resize'));
      });
      expect(page().style.bottom).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('EditorFullPage on the desktop with a visual viewport', () => {
  it('keeps the full window: pywebview resizes the page itself', () => {
    vi.stubGlobal('innerHeight', 1180);
    const viewport = Object.assign(new EventTarget(), { height: 700, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    try {
      const { container } = render(<EditorFullPage {...baseProps} />);
      expect(container.querySelector<HTMLElement>('.editor-fullpage')!.style.bottom).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

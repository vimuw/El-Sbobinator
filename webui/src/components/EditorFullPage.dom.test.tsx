import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorFullPage } from './EditorFullPage';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
import { WEB_CAPABILITIES } from '../web/webHost';

const editorMockState = vi.hoisted(() => ({ html: '<p>editor content</p>' }));

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
  }: {
    onEditorReady?: (getHtml: () => string) => void;
    onChange?: () => void;
    bottomInset?: number;
  }) => {
    React.useEffect(() => {
      onEditorReady?.(() => editorMockState.html);
    }, [onEditorReady]);
    return React.createElement('div', { 'data-testid': 'rich-text-editor', 'data-bottom-inset': bottomInset, onClick: () => onChange?.() }, 'Editor');
  },
}));

vi.mock('./AudioPlayer', () => ({
  AudioPlayer: () => React.createElement('div', { 'data-testid': 'audio-player' }, 'Player'),
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

it('keeps an original-file dependency warning visible above the player', async () => {
  render(<EditorFullPage {...baseProps} audio={{
    src: '/original.wav', relinkNeeded: false, warning: 'Conserva il file originale.',
    onRelink: vi.fn(), init: {}, onStateChange: vi.fn(),
  }} />);
  expect(await screen.findByTestId('audio-player')).toBeTruthy();
  expect(screen.getByText('Conserva il file originale.')).toBeTruthy();
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

  it('docks the player for the audio kept in the browser, and offers to add one when there is none', async () => {
    setHostCapabilities(WEB_CAPABILITIES);
    const { container, rerender } = render(<EditorFullPage {...baseProps} audioSrc="blob:https://web.test/1" onClose={vi.fn()} />);
    expect(container.querySelector('.editor-player-dock [data-testid="audio-player"]')).not.toBeNull();

    const onRelink = vi.fn().mockResolvedValue(true);
    rerender(<EditorFullPage {...baseProps} audio={{ src: null, relinkNeeded: false, onRelink, init: {}, onStateChange: vi.fn() }} />);
    expect(screen.getByText('Nessun audio collegato')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Aggiungi audio/ }));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });
});

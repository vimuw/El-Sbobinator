import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorFullPage } from './EditorFullPage';

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
  }: {
    onEditorReady?: (getHtml: () => string) => void;
    onChange?: () => void;
  }) => {
    React.useEffect(() => {
      onEditorReady?.(() => editorMockState.html);
    }, [onEditorReady]);
    return React.createElement('div', { 'data-testid': 'rich-text-editor', onClick: () => onChange?.() }, 'Editor');
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

  it('renders top actions in order: inizia sessione / collabora, copy html, open html, theme toggle', async () => {
    const setThemeMode = vi.fn();
    render(<EditorFullPage {...baseProps} themeMode="dark" setThemeMode={setThemeMode} />);

    const collabBtn = screen.getByTitle('Inizia sessione (Collaborazione P2P)');
    const copyBtn = screen.getByTitle('Copia per Google Docs');
    const openBtn = screen.getByTitle('Apri file HTML');
    const themeBtn = screen.getByTitle('Tema chiaro');

    expect(collabBtn).toBeTruthy();
    expect(screen.getByText('Collabora')).toBeTruthy();
    expect(copyBtn).toBeTruthy();
    expect(openBtn).toBeTruthy();
    expect(themeBtn).toBeTruthy();

    // Verify order: collabBtn -> copyBtn -> openBtn -> themeBtn
    const buttons = screen.getAllByRole('button');
    const collabIndex = buttons.indexOf(collabBtn);
    const copyIndex = buttons.indexOf(copyBtn);
    const openIndex = buttons.indexOf(openBtn);
    const themeIndex = buttons.indexOf(themeBtn);

    expect(collabIndex).toBeGreaterThan(-1);
    expect(copyIndex).toBeGreaterThan(collabIndex);
    expect(openIndex).toBeGreaterThan(copyIndex);
    expect(themeIndex).toBeGreaterThan(openIndex);

    // Toggling theme calls setThemeMode
    fireEvent.click(themeBtn);
    expect(setThemeMode).toHaveBeenCalled();
  });
  it('renders active room pill when collabRoom is set', async () => {
    render(<EditorFullPage {...baseProps} initialRoom="anatomia-stanza-1" />);

    const activeCollabBtn = screen.getByTitle('Collaborazione attiva: anatomia-stanza-1');
    expect(activeCollabBtn).toBeTruthy();
    expect(screen.getByText('anatomia-stanza-1')).toBeTruthy();
  });

  it('records pre-collaboration backup snapshot in sessionStorage and on-disk on collaboration start', async () => {
    const longHtml = '<p>' + 'A'.repeat(500) + '</p>';
    editorMockState.html = longHtml;
    const createCollabBackup = vi.fn().mockResolvedValue({ ok: true, backup_path: '/sessions/out.collab-backup.html' });
    setPywebview({ create_collaboration_backup: createCollabBackup });

    render(<EditorFullPage {...baseProps} previewContent={longHtml} initialRoom="sbobina-test-room" />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());

    const snapshot = sessionStorage.getItem('collab_pre_backup_/sessions/out.html');
    expect(snapshot).toBeTruthy();
    const parsed = JSON.parse(snapshot!);
    expect(parsed.room).toBe('sbobina-test-room');
    expect(parsed.content).toBe(longHtml);
    expect(createCollabBackup).toHaveBeenCalledWith('/sessions/out.html');
  });

  it('blocks destructive autosave reduction (>75% drop) in active collaboration session and allows Forza salvataggio override', async () => {
    const longHtml = '<p>' + 'A'.repeat(600) + '</p>';
    editorMockState.html = longHtml;
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: true, saved: true });
    setPywebview({ save_html_content: saveHtmlContent });

    render(<EditorFullPage {...baseProps} previewContent={longHtml} initialRoom="sbobina-safe-room" />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());

    // Drastic drop from 600 chars to 5 chars (e.g. accidental wipe)
    editorMockState.html = '<p></p>';

    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 750));
    });

    // save_html_content should NOT be called with the wiped content
    expect(saveHtmlContent).not.toHaveBeenCalled();
    expect(screen.getByText('Errore salvataggio')).toBeTruthy();
    expect(screen.getByText(/Autosave sospeso: rilevata una riduzione drastica del testo in modalità collaborativa/)).toBeTruthy();
    expect(screen.getByText('Forza salvataggio')).toBeTruthy();

    // Clicking Forza salvataggio manually forces the save
    await act(async () => {
      fireEvent.click(screen.getByText('Forza salvataggio'));
    });
    expect(saveHtmlContent).toHaveBeenCalledWith('/sessions/out.html', '<p></p>', expect.any(Number));
    expect(screen.getByText('Salvato')).toBeTruthy();
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
    expect(screen.getByText('Collega un file audio per sincronizzarlo con la sbobina.')).toBeTruthy();
    const addBtn = screen.getByRole('button', { name: /Aggiungi audio/i });
    expect(addBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(addBtn);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('renders the editor-fullpage-footer with semantic class and chrome background', async () => {
    const { container } = render(
      <EditorFullPage
        {...baseProps}
        onClose={vi.fn()}
      />,
    );

    const footer = container.querySelector('.editor-fullpage-footer');
    expect(footer).not.toBeNull();
    expect((footer as HTMLElement).style.background).toBe('var(--editor-chrome-bg)');
  });
});

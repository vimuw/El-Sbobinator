import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewModal } from './PreviewModal';

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

vi.mock('../RichTextEditor', () => ({
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

vi.mock('../AudioPlayer', () => ({
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
  setPywebview(undefined);
});
afterEach(() => {
  vi.clearAllMocks();
  setPywebview(undefined);
});

describe('PreviewModal', () => {
  it('renders nothing when previewContent is null', () => {
    render(<PreviewModal {...baseProps} previewContent={null} />);
    expect(screen.queryByText(/Anteprima:/)).toBeNull();
  });

  it('shows modal with title when content is provided', () => {
    render(<PreviewModal {...baseProps} />);
    expect(screen.getByText('Anteprima: My Document')).toBeTruthy();
  });

  it('renders the editor area', () => {
    render(<PreviewModal {...baseProps} />);
    expect(screen.getByTestId('rich-text-editor')).toBeTruthy();
  });

  it('shows autosave idle status by default', () => {
    render(<PreviewModal {...baseProps} />);
    expect(screen.getByText('Autosave')).toBeTruthy();
  });

  it('calls onClose when X button is clicked', async () => {
    const onClose = vi.fn();
    render(<PreviewModal {...baseProps} onClose={onClose} />);
    const btns = screen.getAllByRole('button');
    const closeBtn = btns[btns.length - 1];
    await act(async () => { fireEvent.click(closeBtn); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(<PreviewModal {...baseProps} onClose={onClose} />);
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "Audio non trovato" when audioRelinkNeeded and no audioSrc', () => {
    render(<PreviewModal {...baseProps} audioRelinkNeeded />);
    expect(screen.getByText('Audio non trovato')).toBeTruthy();
    expect(screen.getByText('Ricollega audio')).toBeTruthy();
  });

  it('renders audio player when audioSrc is set', async () => {
    render(<PreviewModal {...baseProps} audioSrc="blob:audio" />);
    await waitFor(() => expect(screen.getByTestId('audio-player')).toBeTruthy());
  });

  it('shows open file button when htmlPath is set', () => {
    render(<PreviewModal {...baseProps} />);
    expect(screen.getByTitle('Apri file HTML')).toBeTruthy();
  });

  it('resets state when previewContent changes', () => {
    const { rerender } = render(<PreviewModal {...baseProps} />);
    rerender(<PreviewModal {...baseProps} previewContent="<p>Updated</p>" />);
    expect(screen.getByText('Autosave')).toBeTruthy();
  });

  it('calls onRelink when "Ricollega audio" is clicked', async () => {
    const onRelink = vi.fn().mockResolvedValue(false);
    render(<PreviewModal {...baseProps} audioRelinkNeeded onRelink={onRelink} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Ricollega audio'));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('clicking backdrop calls onClose', async () => {
    const onClose = vi.fn();
    const { container } = render(<PreviewModal {...baseProps} onClose={onClose} />);
    const backdrop = container.querySelector('.fixed.inset-0');
    expect(backdrop).toBeTruthy();
    await act(async () => { fireEvent.click(backdrop!); });
    expect(onClose).toHaveBeenCalled();
  });

  it('sets relinkSuccess when onRelink returns true', async () => {
    const onRelink = vi.fn().mockResolvedValue(true);
    render(<PreviewModal {...baseProps} audioRelinkNeeded onRelink={onRelink} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Ricollega audio'));
    });
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('calls open_file when external link button is clicked', async () => {
    const openFile = vi.fn();
    setPywebview({ open_file: openFile });
    render(<PreviewModal {...baseProps} />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Apri file HTML'));
    });
    expect(openFile).toHaveBeenCalledWith('/sessions/out.html');
  });

  it('does not close when final autosave is skipped by the backend', async () => {
    const onClose = vi.fn();
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: false, saved: false, error: 'stale' });
    setPywebview({ save_html_content: saveHtmlContent });
    render(<PreviewModal {...baseProps} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    editorMockState.html = '<p>changed content</p>';

    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    const btns = screen.getAllByRole('button');
    const closeBtn = btns[btns.length - 1];
    await act(async () => {
      fireEvent.click(closeBtn);
      await Promise.resolve();
    });

    expect(saveHtmlContent).toHaveBeenCalledWith('/sessions/out.html', '<p>changed content</p>', expect.any(Number));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Errore salvataggio')).toBeTruthy();
  });

  it('keeps autosave generations monotonic when the same document is reopened', async () => {
    const onClose = vi.fn();
    const saveHtmlContent = vi.fn().mockResolvedValue({ ok: true, saved: true });
    const htmlPath = '/sessions/reopened-preview-modal.html';
    setPywebview({ save_html_content: saveHtmlContent });

    const firstRender = render(<PreviewModal {...baseProps} htmlPath={htmlPath} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    editorMockState.html = '<p>first edit</p>';
    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    let btns = screen.getAllByRole('button');
    await act(async () => {
      fireEvent.click(btns[btns.length - 1]);
      await Promise.resolve();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const firstGeneration = saveHtmlContent.mock.calls[0][2] as number;
    firstRender.unmount();

    onClose.mockClear();
    editorMockState.html = '<p>second edit</p>';
    const secondRender = render(<PreviewModal {...baseProps} htmlPath={htmlPath} onClose={onClose} />);
    await waitFor(() => expect(screen.getByTestId('rich-text-editor')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('rich-text-editor'));
    });
    btns = screen.getAllByRole('button');
    await act(async () => {
      fireEvent.click(btns[btns.length - 1]);
      await Promise.resolve();
    });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const secondGeneration = saveHtmlContent.mock.calls[1][2] as number;
    secondRender.unmount();

    expect(secondGeneration).toBeGreaterThan(firstGeneration);
  });

  it('handles copy action, schedules a timeout to reset state, and clears it on unmount', async () => {
    vi.useFakeTimers();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
    });

    const { unmount } = render(<PreviewModal {...baseProps} />);
    const copyBtn = screen.getByTitle('Copia per Google Docs');
    expect(copyBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(screen.getByTitle('Copiato!')).toBeTruthy();

    // Fast-forward 2 seconds
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByTitle('Copiato!')).toBeNull();
    expect(screen.getByTitle('Copia per Google Docs')).toBeTruthy();

    // Trigger copy again and unmount immediately to verify no state updates on unmounted component
    await act(async () => {
      fireEvent.click(screen.getByTitle('Copia per Google Docs'));
    });
    expect(screen.getByTitle('Copiato!')).toBeTruthy();

    // Unmount
    unmount();

    // Fast-forward and verify no error/warning
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    vi.useRealTimers();
  });
});

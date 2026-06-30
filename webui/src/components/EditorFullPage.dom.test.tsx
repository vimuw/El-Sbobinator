import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
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
});

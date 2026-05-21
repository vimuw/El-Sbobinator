import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePreview } from './usePreview';
import type { Dispatch } from 'react';
import type { ProcessingAction } from '../appState';
import type { ArchiveSession } from '../bridge';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

function makeOptions(overrides: Partial<{
  appendConsole: (msg: string) => void;
  dispatch: Dispatch<ProcessingAction>;
  setArchiveSessions: Dispatch<React.SetStateAction<ArchiveSession[]>>;
  onArchiveRefresh: () => void | Promise<void>;
}> = {}) {
  return {
    appendConsole: vi.fn(),
    dispatch: vi.fn() as unknown as Dispatch<ProcessingAction>,
    setArchiveSessions: vi.fn() as unknown as Dispatch<React.SetStateAction<ArchiveSession[]>>,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  setPywebview(undefined);
});
afterEach(() => {
  localStorage.clear();
  setPywebview(undefined);
});

describe('usePreview', () => {
  it('initialises with content null', () => {
    const { result } = renderHook(() => usePreview(makeOptions()));
    expect(result.current.preview.content).toBeNull();
  });

  it('openPreview logs error when bridge is unavailable', async () => {
    const appendConsole = vi.fn();
    const { result } = renderHook(() => usePreview(makeOptions({ appendConsole })));
    await act(async () => {
      await result.current.openPreview('/file.html', 'test', undefined, undefined, undefined);
    });
    expect(appendConsole).toHaveBeenCalledWith(expect.stringContaining('non disponibile'));
  });

  it('openPreview loads content when bridge succeeds', async () => {
    const appendConsole = vi.fn();
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body><p>hello</p></body>' }),
      stream_media_file: vi.fn().mockResolvedValue({ ok: false }),
    });
    const { result } = renderHook(() => usePreview(makeOptions({ appendConsole })));
    await act(async () => {
      await result.current.openPreview('/file.html', 'My File', '/audio.mp3', 'f1', '/session');
    });
    expect(result.current.preview.content).not.toBeNull();
    expect(result.current.preview.title).toBe('My File');
    expect(result.current.preview.path).toBe('/file.html');
  });

  it('openPreview logs error when bridge returns !ok', async () => {
    const appendConsole = vi.fn();
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: false, error: 'file not found' }),
    });
    const { result } = renderHook(() => usePreview(makeOptions({ appendConsole })));
    await act(async () => {
      await result.current.openPreview('/file.html', 'test');
    });
    expect(appendConsole).toHaveBeenCalledWith(expect.stringContaining('file not found'));
  });

  it('openPreview calls onOpenFailed when bridge returns !ok', async () => {
    const onOpenFailed = vi.fn();
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: false, error: 'File non trovato.' }),
    });
    const { result } = renderHook(() => usePreview({ ...makeOptions(), onOpenFailed }));
    await act(async () => {
      await result.current.openPreview('/session/out.html', 'test', undefined, undefined, '/session');
    });
    expect(onOpenFailed).toHaveBeenCalledWith('/session/out.html', '/session');
  });

  it('openPreview logs error on thrown exception', async () => {
    const appendConsole = vi.fn();
    setPywebview({
      read_html_content: vi.fn().mockRejectedValue(new Error('network failure')),
    });
    const { result } = renderHook(() => usePreview(makeOptions({ appendConsole })));
    await act(async () => {
      await result.current.openPreview('/file.html', 'test');
    });
    expect(appendConsole).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });

  it('closePreview resets preview state to initial', async () => {
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body><p>hi</p></body>' }),
      stream_media_file: vi.fn().mockResolvedValue({ ok: false }),
    });
    const { result } = renderHook(() => usePreview(makeOptions()));
    await act(async () => {
      await result.current.openPreview('/file.html', 'test', undefined, 'f1');
    });
    expect(result.current.preview.content).not.toBeNull();
    act(() => { result.current.closePreview(); });
    expect(result.current.preview.content).toBeNull();
    expect(result.current.preview.path).toBe('');
  });

  it('handleAudioStateChange updates editor session ref without re-rendering', () => {
    const { result } = renderHook(() => usePreview(makeOptions()));
    act(() => {
      result.current.handleAudioStateChange({ currentTime: 30, playbackRate: 1.5, volume: 0.8 });
    });
    expect(result.current.preview.content).toBeNull();
  });

  it('handleScrollTopChange updates scroll without re-rendering', () => {
    const { result } = renderHook(() => usePreview(makeOptions()));
    act(() => {
      result.current.handleScrollTopChange(200);
    });
    expect(result.current.preview.content).toBeNull();
  });

  it('relinkPreviewAudio does nothing when bridge unavailable', async () => {
    const { result } = renderHook(() => usePreview(makeOptions()));
    await act(async () => {
      await result.current.relinkPreviewAudio();
    });
    expect(result.current.preview.audioSrc).toBeNull();
  });

  it('relinkPreviewAudio links audio when bridge returns a file', async () => {
    const appendConsole = vi.fn();
    setPywebview({
      ask_media_file: vi.fn().mockResolvedValue({ path: '/audio.mp3', name: 'audio.mp3', size: 1024, duration: 60 }),
      stream_media_file: vi.fn().mockResolvedValue({ ok: true, url: 'blob:audio' }),
    });
    const { result } = renderHook(() => usePreview(makeOptions({ appendConsole })));
    await act(async () => {
      await result.current.relinkPreviewAudio();
    });
    expect(appendConsole).toHaveBeenCalledWith(expect.stringContaining('audio.mp3'));
  });

  it('openPreview loads audio when stream_media_file succeeds', async () => {
    const stream_media_file = vi.fn().mockResolvedValue({ ok: true, url: 'blob:media' });
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body>text</body>' }),
      stream_media_file,
    });
    const { result } = renderHook(() => usePreview(makeOptions()));
    await act(async () => {
      await result.current.openPreview('/file.html', 'test', '/audio.mp3', 'f1', '/session');
    });
    expect(result.current.preview.audioSrc).toBe('blob:media');
    expect(stream_media_file).toHaveBeenCalledWith('/audio.mp3', '/session');
  });

  it('loadPreviewAudio: sessionDir present but sourcePath empty — still calls stream_media_file with empty string', async () => {
    // Covers the branch where normalizedSource is '' but normalizedSessionDir is
    // set. The backend receives ('', sessionDir) and is responsible for resolving
    // the audio; the call must not be skipped.
    const stream_media_file = vi.fn().mockResolvedValue({ ok: true, url: 'blob:session-audio' });
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body>text</body>' }),
      stream_media_file,
    });
    const { result } = renderHook(() => usePreview(makeOptions()));
    await act(async () => {
      // sourcePath is intentionally undefined — only sessionDir is provided
      await result.current.openPreview('/session/out.html', 'test', undefined, 'f1', '/session');
    });
    expect(stream_media_file).toHaveBeenCalledWith('', '/session');
    expect(result.current.preview.audioSrc).toBe('blob:session-audio');
    expect(result.current.preview.audioRelinkNeeded).toBe(false);
  });

  it('loadPreviewAudio: sessionDir present, sourcePath empty, backend fails — sets audioRelinkNeeded', async () => {
    // Regression guard: when the backend cannot resolve audio even with sessionDir
    // (e.g. original recording was deleted), audioRelinkNeeded must be true so the
    // UI can prompt the user to relink.
    const stream_media_file = vi.fn().mockResolvedValue({ ok: false });
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body>text</body>' }),
      stream_media_file,
    });
    const { result } = renderHook(() => usePreview(makeOptions()));
    await act(async () => {
      await result.current.openPreview('/session/out.html', 'test', undefined, 'f1', '/session');
    });
    expect(stream_media_file).toHaveBeenCalledWith('', '/session');
    expect(result.current.preview.audioSrc).toBeNull();
    expect(result.current.preview.audioRelinkNeeded).toBe(true);
  });

  it('relinkPreviewAudio persists session relink, refreshes archive, and updates completed queue items', async () => {
    const dispatch = vi.fn() as unknown as Dispatch<ProcessingAction>;
    const setArchiveSessions = vi.fn() as unknown as Dispatch<React.SetStateAction<ArchiveSession[]>>;
    const onArchiveRefresh = vi.fn();
    const update_session_input_path = vi.fn().mockResolvedValue({ ok: true });
    const stream_media_file = vi.fn().mockResolvedValue({ ok: true, url: 'blob:new-audio' });
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body>text</body>' }),
      ask_media_file: vi.fn().mockResolvedValue({ path: '/new/audio.mp3', name: 'audio.mp3', size: 2048, duration: 90 }),
      update_session_input_path,
      stream_media_file,
    });
    const { result } = renderHook(() => usePreview(makeOptions({ dispatch, setArchiveSessions, onArchiveRefresh })));
    await act(async () => {
      await result.current.openPreview('/session/out.html', 'test', '/old/audio.mp3', 'f1', '/session');
    });
    await act(async () => {
      await result.current.relinkPreviewAudio();
    });
    expect(update_session_input_path).toHaveBeenCalledWith('/session', '/new/audio.mp3');
    expect(onArchiveRefresh).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/update_source',
      id: 'f1',
      sessionDir: '/session',
      path: '/new/audio.mp3',
      name: 'audio.mp3',
      size: 2048,
      duration: 90,
    });
    expect(stream_media_file).toHaveBeenLastCalledWith('/new/audio.mp3', '/session');
  });

  it('relinkPreviewAudio aborts when sessionDir is set but update_session_input_path is absent', async () => {
    // Regression test: previously persistOk stayed true when the endpoint was
    // missing, causing in-memory queue state to be updated without a disk write.
    const dispatch = vi.fn() as unknown as Dispatch<ProcessingAction>;
    const setArchiveSessions = vi.fn() as unknown as Dispatch<React.SetStateAction<ArchiveSession[]>>;
    const appendConsole = vi.fn();
    const stream_media_file = vi.fn().mockResolvedValue({ ok: true, url: 'blob:new-audio' });
    setPywebview({
      read_html_content: vi.fn().mockResolvedValue({ ok: true, content: '<body>text</body>' }),
      ask_media_file: vi.fn().mockResolvedValue({ path: '/new/audio.mp3', name: 'audio.mp3', size: 2048, duration: 90 }),
      // update_session_input_path intentionally absent
      stream_media_file,
    });
    const { result } = renderHook(() => usePreview(makeOptions({ dispatch, setArchiveSessions, appendConsole })));
    await act(async () => {
      await result.current.openPreview('/session/out.html', 'test', '/old/audio.mp3', 'f1', '/session');
    });
    await act(async () => {
      await result.current.relinkPreviewAudio();
    });
    // Must log the error rather than silently updating in-memory state
    expect(appendConsole).toHaveBeenCalledWith(expect.stringContaining('Impossibile salvare'));
    // Neither the queue nor the stream should have been touched
    expect(dispatch).not.toHaveBeenCalled();
    expect(stream_media_file).toHaveBeenCalledTimes(1); // only the initial openPreview call
  });
});

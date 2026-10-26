import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmModal } from './useConfirmModal';
import type { FileItem } from '../appState';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';

describe('useConfirmModal', () => {
  const dispatch = vi.fn();
  const onFoldersChange = vi.fn().mockResolvedValue(undefined);
  const setArchiveSessions = vi.fn();
  const setArchiveTotal = vi.fn();
  const refreshArchiveSessions = vi.fn();
  const executeRetryFromArchive = vi.fn();
  const appendConsole = vi.fn();
  const normalizeSessionDir = (p?: string) => String(p || '').replace(/\\/g, '/').toLowerCase();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates appropriate copy for stop-processing and dispatches stop', async () => {
    const filesRef = { current: [] as FileItem[] };
    const foldersRef = { current: [] };
    const startProcessingRef = { current: vi.fn() };

    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef,
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef,
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    );

    act(() => {
      result.current.setConfirmAction({ type: 'stop-processing' });
    });

    expect(result.current.confirmModalCopy?.title).toBe('Interrompere la sbobinatura?');
    expect(result.current.confirmModalCopy?.confirmLabel).toBe('Conferma stop');

    act(() => {
      result.current.handleConfirmAction();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'app/set_status',
      status: 'canceling',
    });
  });

  it('handles remove-file confirmation', () => {
    const filesRef = {
      current: [
        {
          id: 'file-1',
          name: 'audio.mp3',
          size: 100,
          duration: 10,
          status: 'queued' as const,
          progress: 0,
          phase: 0,
        },
      ],
    };
    const foldersRef = { current: [] };
    const startProcessingRef = { current: vi.fn() };

    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef,
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef,
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    );

    act(() => {
      result.current.setConfirmAction({
        type: 'remove-file',
        fileId: 'file-1',
        fileName: 'audio.mp3',
        isDone: false,
      });
    });

    expect(result.current.confirmModalCopy?.title).toBe('Rimuovere questo elemento?');

    act(() => {
      result.current.handleConfirmAction();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/remove',
      id: 'file-1',
    });
    expect(result.current.confirmAction).toBeNull();
  });

  it('says a completed transcript leaves only Recenti, since the archive already holds it', () => {
    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef: { current: [] as FileItem[] },
        foldersRef: { current: [] },
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef: { current: vi.fn() },
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    );

    act(() => {
      result.current.setConfirmAction({ type: 'remove-file', fileId: 'f1', fileName: 'lezione.mp3', isDone: true });
    });
    expect(result.current.confirmModalCopy?.description).toBe(
      "\"lezione.mp3\" verrà rimossa dai Recenti e resterà disponibile nell'Archivio. Vuoi continuare?",
    );
  });

  it('says the sbobina is deleted from the disk on desktop and from this browser on the web', () => {
    const render = () => renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef: { current: [] as FileItem[] },
        foldersRef: { current: [] },
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef: { current: vi.fn() },
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    ).result;
    const desktop = render();
    act(() => desktop.current.setConfirmAction({ type: 'delete-archive-session', sessionDir: '/s/one', name: 'Uno' }));
    expect(desktop.current.confirmModalCopy?.description).toContain('eliminati definitivamente dal disco');

    setHostCapabilities({ kind: 'web' });
    try {
      const web = render();
      act(() => web.current.setConfirmAction({ type: 'delete-archive-session', sessionDir: 'web-session://a', name: 'Uno' }));
      expect(web.current.confirmModalCopy?.description).toContain('eliminati definitivamente da questo browser');
      act(() => web.current.setConfirmAction({ type: 'delete-multiple-archive-sessions', sessions: [{ sessionDir: 'web-session://a', name: 'Uno' }, { sessionDir: 'web-session://b', name: 'Due' }] }));
      expect(web.current.confirmModalCopy?.description).not.toContain('disco');
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
    }
  });

  it('drops a deleted archive session from Recenti too', async () => {
    const delete_session = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = { api: { delete_session } } as unknown as typeof window.pywebview;
    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef: { current: [] as FileItem[] },
        foldersRef: { current: [] },
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef: { current: vi.fn() },
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    );

    act(() => {
      result.current.setConfirmAction({ type: 'delete-archive-session', sessionDir: '/s/one', name: 'Uno' });
    });
    await act(async () => {
      result.current.handleConfirmAction();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'queue/remove_sessions', sessionDirs: ['/s/one'] });

    act(() => {
      result.current.setConfirmAction({
        type: 'delete-multiple-archive-sessions',
        sessions: [{ sessionDir: '/s/two', name: 'Due' }, { sessionDir: '/s/three', name: 'Tre' }],
      });
    });
    await act(async () => {
      result.current.handleConfirmAction();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'queue/remove_sessions', sessionDirs: ['/s/two', '/s/three'] });
    delete window.pywebview;
  });

  it('handles quit-app confirmation and calls close_window', () => {
    const filesRef = { current: [] as FileItem[] };
    const foldersRef = { current: [] };
    const startProcessingRef = { current: vi.fn() };
    const closeWindowMock = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = {
      api: {
        close_window: closeWindowMock,
      },
    };

    const isQuittingRef = { current: false };
    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef,
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        startProcessingRef,
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
        isQuittingRef,
      }),
    );

    act(() => {
      result.current.requestQuitConfirmation();
    });

    expect(result.current.confirmAction).toEqual({ type: 'quit-app' });
    expect(result.current.confirmModalCopy?.title).toBe('Elaborazione in corso');
    expect(result.current.confirmModalCopy?.confirmLabel).toBe('Interrompi ed esci');
    expect(result.current.confirmModalCopy?.cancelLabel).toBe('Continua elaborazione');

    act(() => {
      result.current.handleConfirmAction();
    });

    expect(closeWindowMock).toHaveBeenCalled();
    expect(isQuittingRef.current).toBe(true);
    expect(result.current.confirmAction).toBeNull();
  });
});

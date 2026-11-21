import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmModal } from './useConfirmModal';
import type { FileItem } from '../appState';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';

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

    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef,
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
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

    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef,
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
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

  it('lets the browser drop the audio copy of files removed from the queue, never of a completed one', () => {
    const release_queue_file = vi.fn().mockResolvedValue({ ok: true });
    window.pywebview = { api: { release_queue_file } } as unknown as typeof window.pywebview;
    const file = (id: string, status: FileItem['status']): FileItem => ({ id, name: `${id}.mp3`, size: 1, duration: 1, status, progress: 0, phase: 0, path: `local://${id}/${id}.mp3` });
    const filesRef = { current: [file('queued', 'queued'), file('failed', 'error'), file('done', 'done')] };
    const { result } = renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef,
        foldersRef: { current: [] },
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    );
    try {
      act(() => { result.current.setConfirmAction({ type: 'remove-file', fileId: 'done', fileName: 'done.mp3', isDone: true }); });
      act(() => { result.current.handleConfirmAction(); });
      expect(release_queue_file).not.toHaveBeenCalled();

      act(() => { result.current.setConfirmAction({ type: 'remove-file', fileId: 'queued', fileName: 'queued.mp3', isDone: false }); });
      act(() => { result.current.handleConfirmAction(); });
      expect(release_queue_file).toHaveBeenCalledWith('local://queued/queued.mp3');

      release_queue_file.mockClear();
      act(() => { result.current.setConfirmAction({ type: 'clear-all' }); });
      act(() => { result.current.handleConfirmAction(); });
      expect(release_queue_file.mock.calls).toEqual([['local://queued/queued.mp3'], ['local://failed/failed.mp3']]);
    } finally {
      delete window.pywebview;
    }
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

  it('says the sbobina is deleted from this browser, or moved to the trash where there is one', () => {
    const render = () => renderHook(() =>
      useConfirmModal({
        dispatch,
        filesRef: { current: [] as FileItem[] },
        foldersRef: { current: [] },
        onFoldersChange,
        setArchiveSessions,
        setArchiveTotal,
        refreshArchiveSessions,
        executeRetryFromArchive,
        normalizeSessionDir,
        appendConsole,
      }),
    ).result;
    const web = render();
    act(() => web.current.setConfirmAction({ type: 'delete-archive-session', sessionDir: 'web-session://a', name: 'Uno' }));
    expect(web.current.confirmModalCopy?.description).toContain('eliminati definitivamente da questo browser');
    act(() => web.current.setConfirmAction({ type: 'delete-multiple-archive-sessions', sessions: [{ sessionDir: 'web-session://a', name: 'Uno' }, { sessionDir: 'web-session://b', name: 'Due' }] }));
    expect(web.current.confirmModalCopy?.description).toContain('eliminati definitivamente da questo browser');

    // Web previews with the trash: nothing is deleted for good, the sbobine go to the trash.
    setHostCapabilities({ permanentDelete: false });
    try {
      const trash = render();
      act(() => trash.current.setConfirmAction({ type: 'delete-archive-session', sessionDir: 'web-session://a', name: 'Uno' }));
      expect(trash.current.confirmModalCopy).toMatchObject({ confirmLabel: 'Sposta nel cestino' });
      expect(trash.current.confirmModalCopy?.description).toBe('"Uno" va nel cestino: puoi ripristinarla per 30 giorni da Impostazioni → Archiviazione.');
      act(() => trash.current.setConfirmAction({ type: 'delete-multiple-archive-sessions', sessions: [{ sessionDir: 'web-session://a', name: 'Uno' }] }));
      expect(trash.current.confirmModalCopy?.description).toBe('La sbobina selezionata va nel cestino: puoi ripristinarla per 30 giorni da Impostazioni → Archiviazione.');
      act(() => trash.current.setConfirmAction({ type: 'delete-multiple-archive-sessions', sessions: [{ sessionDir: 'web-session://a', name: 'Uno' }, { sessionDir: 'web-session://b', name: 'Due' }] }));
      expect(trash.current.confirmModalCopy).toMatchObject({ confirmLabel: 'Sposta nel cestino', description: expect.stringContaining('Le 2 sbobine selezionate vanno nel cestino') });
    } finally {
      setHostCapabilities(DEFAULT_CAPABILITIES);
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
});

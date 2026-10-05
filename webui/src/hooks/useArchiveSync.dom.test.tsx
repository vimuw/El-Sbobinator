import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useArchiveSync } from './useArchiveSync';
import type { PywebviewApi, ArchiveSession, ArchiveFolder } from '../bridge';
import type { FileItem } from '../appState';

describe('useArchiveSync', () => {
  const dispatch = vi.fn();
  const setActivePage = vi.fn();
  const appendConsole = vi.fn();
  const addNotification = vi.fn();
  const handleRetryFailedRevisionBlocks = vi.fn();

  const mockSession: ArchiveSession = {
    session_dir: '/path/to/session1',
    name: 'Lecture 1',
    html_path: '/path/to/session1/Lecture 1.html',
    completed_at_iso: '2026-08-24T00:00:00Z',
    effective_model: 'gemini-2.5-flash',
    input_path: '/audio/lecture1.mp3',
    input_size: 1024,
    duration_sec: 120,
    completion_status: 'completed',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete window.pywebview;
    localStorage.clear();
  });

  it('saves consecutive hierarchy edits in order and reports failed persistence', async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    const firstSave = new Promise<{ ok: boolean }>(resolve => { release = resolve; });
    const save = vi.fn().mockReturnValueOnce(firstSave).mockResolvedValueOnce({ ok: false, error: 'Disk full' }).mockResolvedValue({ ok: true });
    window.pywebview = { api: { save_archive_folders: save } as unknown as PywebviewApi };
    const { result } = renderHook(() => useArchiveSync({ files: [], dispatch, activePage: 'queue', setActivePage, appState: 'idle', apiReady: false, appendConsole, addNotification, handleRetryFailedRevisionBlocks }));
    const first: ArchiveFolder[] = [{ id: 'year', name: 'Anno', color: '', session_dirs: [] }];
    const second: ArchiveFolder[] = [...first, { id: 'course', name: 'Corso', color: '', parent_id: 'year', session_dirs: [mockSession.session_dir] }];
    let save1!: Promise<void>; let save2!: Promise<void>;
    await act(async () => {
      save1 = result.current.handleFoldersChange(first);
      save2 = result.current.handleFoldersChange(second);
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.folders).toEqual(second);
    await act(async () => { release({ ok: true }); await Promise.all([save1, save2]); });
    expect(save.mock.calls.map(call => call[0])).toEqual([first, second]);
    expect(addNotification).toHaveBeenCalledWith('Raccolte non salvate', 'Disk full', 'error', 'system');
    await act(async () => { await result.current.handleFoldersChange(second); });
    expect(save).toHaveBeenCalledTimes(3);
    expect(result.current.completedSessionFolderMap.get(mockSession.session_dir)).toMatchObject({ displayName: 'Anno › Corso', fullPath: 'Anno › Corso', color: '#94A3B8' });
  });

  it('loads sessions when API is ready', async () => {
    const mockApi: Partial<PywebviewApi> = {
      get_completed_sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [mockSession],
        total: 1,
      }),
      get_archive_folders: vi.fn().mockResolvedValue({
        ok: true,
        folders: [{ id: 'f1', name: 'Folder 1', session_dirs: [mockSession.session_dir] }],
      }),
    };
    window.pywebview = { api: mockApi as PywebviewApi };

    const { result } = renderHook(() =>
      useArchiveSync({
        files: [],
        dispatch,
        activePage: 'queue',
        setActivePage,
        appState: 'idle',
        apiReady: true,
        appendConsole,
        addNotification,
        handleRetryFailedRevisionBlocks,
      }),
    );

    await act(async () => {
      await result.current.refreshArchiveSessions();
    });

    expect(result.current.archiveSessions).toHaveLength(1);
    expect(result.current.archiveTotal).toBe(1);
    expect(result.current.isArchiveLoaded).toBe(true);
    expect(result.current.archiveFiltered).toHaveLength(1);
  });

  it('filters out sessions active in current queue', async () => {
    const mockApi: Partial<PywebviewApi> = {
      get_completed_sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [mockSession],
        total: 1,
      }),
    };
    window.pywebview = { api: mockApi as PywebviewApi };

    const { result } = renderHook(() =>
      useArchiveSync({
        files: [
          {
            id: 'file-1',
            name: 'Lecture 1',
            size: 1024,
            duration: 120,
            status: 'done',
            progress: 100,
            phase: 3,
            outputHtml: mockSession.html_path,
          },
        ],
        dispatch,
        activePage: 'queue',
        setActivePage,
        appState: 'idle',
        apiReady: true,
        appendConsole,
        addNotification,
        handleRetryFailedRevisionBlocks,
      }),
    );

    await act(async () => {
      await result.current.refreshArchiveSessions();
    });

    expect(result.current.archiveSessions).toHaveLength(1);
    expect(result.current.archiveFiltered).toHaveLength(0);
  });

  it('handles session root relocation by remapping queue and refreshing folders', async () => {
    const mockApi: Partial<PywebviewApi> = {
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({
        ok: true,
        folders: [{ id: 'f1', name: 'New Folder', session_dirs: [] }],
      }),
    };
    window.pywebview = { api: mockApi as PywebviewApi };

    const { result } = renderHook(() =>
      useArchiveSync({
        files: [],
        dispatch,
        activePage: 'queue',
        setActivePage,
        appState: 'idle',
        apiReady: true,
        appendConsole,
        addNotification,
        handleRetryFailedRevisionBlocks,
      }),
    );

    await act(async () => {
      await result.current.handleSessionRootMoved({ oldRoot: '/old', newRoot: '/new' });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/remap_session_roots',
      oldRoot: '/old',
      newRoot: '/new',
    });
    expect(result.current.folders).toHaveLength(1);
  });

  it('filters out pending archive replacement sessions across refreshes and restores them if file is canceled', async () => {
    const mockApi: Partial<PywebviewApi> = {
      get_completed_sessions: vi.fn().mockResolvedValue({
        ok: true,
        sessions: [mockSession],
        total: 1,
      }),
    };
    window.pywebview = { api: mockApi as PywebviewApi };

    let currentFiles: FileItem[] = [
      {
        id: 'replacement-1',
        name: 'Lecture 1',
        size: 1024,
        duration: 120,
        status: 'queued',
        progress: 0,
        phase: 0,
      },
    ];

    const { result, rerender } = renderHook(
      ({ files }: { files: FileItem[] }) =>
        useArchiveSync({
          files,
          dispatch,
          activePage: 'archive',
          setActivePage,
          appState: 'idle',
          apiReady: true,
          appendConsole,
          addNotification,
          handleRetryFailedRevisionBlocks,
        }),
      { initialProps: { files: currentFiles } },
    );

    // Register pending replacement
    result.current.pendingArchiveReplacementsRef.current.set('replacement-1', {
      fileName: 'Lecture 1',
      inputPath: mockSession.input_path,
      sessions: [mockSession],
    });

    // Refresh archive (simulating user clicking refresh button)
    await act(async () => {
      await result.current.refreshArchiveSessions();
    });

    // Backend returned the session on disk
    expect(result.current.archiveSessions).toHaveLength(1);
    // But archiveFiltered excludes it because replacement-1 is still queued
    expect(result.current.archiveFiltered).toHaveLength(0);

    // Now simulate user canceling/removing replacement-1 from the queue
    currentFiles = [];
    rerender({ files: currentFiles });

    // The session should immediately reappear in archiveFiltered
    expect(result.current.archiveFiltered).toHaveLength(1);
    expect(result.current.archiveFiltered[0].session_dir).toBe(mockSession.session_dir);
  });
});

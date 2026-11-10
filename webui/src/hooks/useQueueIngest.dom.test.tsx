import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueIngest } from './useQueueIngest';
import type { FileItem } from '../appState';
import type { ArchiveSession } from '../bridge';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';

describe('useQueueIngest', () => {
  const dispatch = vi.fn();
  const setArchiveSessions = vi.fn();
  const setArchiveTotal = vi.fn();
  const appendConsole = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete (window as unknown as { pywebview?: unknown }).pywebview;
  });

  it('generates consistent fingerprints based on path or metadata', () => {
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'idle' };

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'idle',
        appStateRef,
        apiReady: true,
        appendConsole,
      }),
    );

    const fpPath = result.current.getFileFingerprint({
      path: '/audio/test.mp3',
      name: 'test.mp3',
      size: 1024,
      duration: 60,
    });
    expect(fpPath).toBe('path:/audio/test.mp3');

    const fpMeta = result.current.getFileFingerprint({
      path: '',
      name: 'test.mp3',
      size: 1024,
      duration: 60,
    });
    expect(fpMeta).toBe('meta:test.mp3::1024::60');
  });

  it('enqueues unique files and dispatches queue/add', () => {
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'idle' };

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'idle',
        appStateRef,
        apiReady: true,
        appendConsole,
      }),
    );

    const newFile: FileItem = {
      id: 'f1',
      name: 'lesson1.mp3',
      path: '/path/lesson1.mp3',
      size: 5000,
      duration: 100,
      status: 'queued',
      progress: 0,
      phase: 0,
    };

    act(() => {
      result.current.enqueueUniqueFiles([newFile]);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/add',
      files: [newFile],
    });
    expect(result.current.duplicatePrompt).toBeNull();
  });

  it('triggers in-queue duplicate prompt when item is already in active queue', () => {
    const existingFile: FileItem = {
      id: 'f1',
      name: 'lesson1.mp3',
      path: '/path/lesson1.mp3',
      size: 5000,
      duration: 100,
      status: 'queued',
      progress: 0,
      phase: 0,
    };
    const filesRef = { current: [existingFile] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'idle' };

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'idle',
        appStateRef,
        apiReady: true,
        appendConsole,
      }),
    );

    act(() => {
      result.current.enqueueUniqueFiles([existingFile]);
    });

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'queue/add' }));
    expect(result.current.duplicatePrompt).toEqual({
      kind: 'in-queue',
      filenames: ['lesson1.mp3'],
    });
  });

  it('web: recognizes the same audio picked again despite its fresh local:// path and unknown duration', () => {
    const picked = (id: string, uuid: string, status: FileItem['status'] = 'queued'): FileItem => ({
      id, name: 'Lezione 3.mp3', path: `local://${uuid}/Lezione 3.mp3`, size: 48_123_456, duration: 0,
      status, progress: 0, phase: 0,
    });
    const archived: ArchiveSession = {
      name: 'Lezione 3', completed_at_iso: '2026-11-01T10:00:00Z', html_path: 'web:/s1/lezione.html',
      effective_model: 'gemini', input_path: 'local://old-uuid/Lezione 3.mp3', input_name: 'Lezione 3.mp3',
      input_size: 48_123_456, duration_sec: 5400, session_dir: 'web:/s1',
    };
    const filesRef = { current: [picked('q1', 'uuid-a')] };
    const archiveSessionsRef = { current: [archived] };
    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef, archiveSessionsRef, pendingArchiveReplacementsRef: { current: new Map() },
        setArchiveSessions, setArchiveTotal, dispatch, appState: 'idle', appStateRef: { current: 'idle' },
        apiReady: true, appendConsole,
      }),
    );

    act(() => { result.current.enqueueUniqueFiles([picked('q2', 'uuid-b')]); });
    expect(result.current.duplicatePrompt).toEqual({ kind: 'in-queue', filenames: ['Lezione 3.mp3'] });

    act(() => { result.current.setDuplicatePrompt(null); });
    filesRef.current = [];
    const incoming = picked('q3', 'uuid-c');
    act(() => { result.current.enqueueUniqueFiles([incoming]); });
    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'queue/add' }));
    expect(result.current.duplicatePrompt).toEqual({
      kind: 'already-processed',
      matches: [{ source: 'archive', sessions: [archived], incoming }],
      alsoInQueue: undefined,
    });
  });

  it('notifies onFilesAddedToBatch when new files are enqueued during processing', () => {
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'processing' };
    const onFilesAddedToBatch = vi.fn();

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'processing',
        appStateRef,
        apiReady: true,
        appendConsole,
        onFilesAddedToBatch,
      }),
    );

    const newFile: FileItem = {
      id: 'f2',
      name: 'lesson2.mp3',
      path: '/path/lesson2.mp3',
      size: 5000,
      duration: 100,
      status: 'queued',
      progress: 0,
      phase: 0,
    };

    act(() => {
      result.current.enqueueUniqueFiles([newFile]);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/add',
      files: [newFile],
    });
    expect(onFilesAddedToBatch).toHaveBeenCalledWith(1);
  });

  it('sets isDragging to true on handleDragOver when processing', () => {
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'processing' };

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'processing',
        appStateRef,
        apiReady: true,
        appendConsole,
      }),
    );

    const mockEvent = {
      preventDefault: vi.fn(),
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handleDragOver(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.isDragging).toBe(true);
  });

  it('uploads browser drops through the shared upload flow', async () => {
    const uploadBrowserFiles = vi.fn().mockResolvedValue([
      { id: 'uploaded', name: 'drop.mp3', path: '/isolated/drop.mp3', size: 3 },
    ]);
    (window as unknown as { pywebview: { api: Record<string, unknown> } }).pywebview = {
      api: { upload_browser_files: uploadBrowserFiles },
    };
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'idle' };
    const { result } = renderHook(() => useQueueIngest({
      filesRef,
      archiveSessionsRef,
      pendingArchiveReplacementsRef,
      setArchiveSessions,
      setArchiveTotal,
      dispatch,
      appState: 'idle',
      appStateRef,
      apiReady: true,
      appendConsole,
    }));
    const droppedFile = new File(['abc'], 'drop.mp3', { type: 'audio/mpeg' });
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [droppedFile] },
    } as unknown as React.DragEvent;

    await act(async () => {
      await result.current.handleDrop(event);
    });

    expect(uploadBrowserFiles).toHaveBeenCalledWith([droppedFile]);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'queue/add',
      files: [expect.objectContaining({ name: 'drop.mp3', path: '/isolated/drop.mp3' })],
    }));
  });

  it('web: reports dropped files in a format the host refused', async () => {
    const uploadBrowserFiles = vi.fn().mockResolvedValue([
      { id: 'uploaded', name: 'lezione.mp3', path: 'local://1/lezione.mp3', size: 3 },
    ]);
    (window as unknown as { pywebview: { api: Record<string, unknown> } }).pywebview = {
      api: { upload_browser_files: uploadBrowserFiles },
    };
    const onFilesRejected = vi.fn();
    const render = () => renderHook(() => useQueueIngest({
      filesRef: { current: [] as FileItem[] },
      archiveSessionsRef: { current: [] },
      pendingArchiveReplacementsRef: { current: new Map() },
      setArchiveSessions,
      setArchiveTotal,
      dispatch,
      appState: 'idle',
      appStateRef: { current: 'idle' },
      apiReady: true,
      appendConsole,
      onFilesRejected,
    })).result;
    const drop = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { files: [new File(['a'], 'lezione.mp3'), new File(['b'], 'registrazione.wav')] },
    } as unknown as React.DragEvent;

    const desktop = render();
    await act(async () => { await desktop.current.handleDrop(drop); });
    expect(onFilesRejected).not.toHaveBeenCalled();

    setHostCapabilities({ kind: 'web' });
    try {
      const web = render();
      await act(async () => { await web.current.handleDrop(drop); });
      expect(onFilesRejected).toHaveBeenCalledWith(['registrazione.wav']);
    } finally {
      setHostCapabilities(DESKTOP_CAPABILITIES);
    }
  });

  it('handleDuplicateAddAgain registers pending replacement and enqueues file without direct archive mutation', async () => {
    const filesRef = { current: [] as FileItem[] };
    const archiveSessionsRef = { current: [] };
    const pendingArchiveReplacementsRef = { current: new Map() };
    const appStateRef = { current: 'idle' };

    const { result } = renderHook(() =>
      useQueueIngest({
        filesRef,
        archiveSessionsRef,
        pendingArchiveReplacementsRef,
        setArchiveSessions,
        setArchiveTotal,
        dispatch,
        appState: 'idle',
        appStateRef,
        apiReady: true,
        appendConsole,
      }),
    );

    const incoming: FileItem = {
      id: 'incoming-1',
      name: 'Lesson 1.mp3',
      path: '/audio/lesson1.mp3',
      size: 1000,
      duration: 60,
      status: 'queued',
      progress: 0,
      phase: 0,
    };

    const archiveMatch: ArchiveSession = {
      session_dir: '/sessions/s1',
      name: 'Lesson 1',
      html_path: '/sessions/s1/Lesson 1.html',
      completed_at_iso: '2026-09-17T12:00:00Z',
      effective_model: 'gemini-2.5-flash',
      input_path: '/audio/lesson1.mp3',
    };

    await act(async () => {
      await result.current.handleDuplicateAddAgain([
        {
          source: 'archive',
          sessions: [archiveMatch],
          incoming,
        },
      ]);
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'queue/add',
      files: [
        expect.objectContaining({
          name: 'Lesson 1.mp3',
          path: '/audio/lesson1.mp3',
          resumeSession: false,
          allowCompletedDestroy: true,
        }),
      ],
    });

    expect(pendingArchiveReplacementsRef.current.size).toBe(1);
    const replacement = Array.from(pendingArchiveReplacementsRef.current.values())[0] as {
      fileName: string;
      sessions: typeof archiveMatch[];
    };
    expect(replacement.fileName).toBe('Lesson 1.mp3');
    expect(replacement.sessions).toEqual([archiveMatch]);
    expect(setArchiveSessions).not.toHaveBeenCalled();
    expect(setArchiveTotal).not.toHaveBeenCalled();
  });
  describe('web: picks that never join the queue free their browser copy', () => {
    const picked = (id: string, uuid: string, status: FileItem['status'] = 'queued'): FileItem => ({
      id, name: 'Lezione 3.mp3', path: `local://${uuid}/Lezione 3.mp3`, size: 48_123_456, duration: 0,
      status, progress: 0, phase: 0,
    });
    const setup = (queued: FileItem[]) => {
      const release = vi.fn().mockResolvedValue({ ok: true });
      (window as unknown as { pywebview: unknown }).pywebview = { api: { release_queue_file: release } };
      const filesRef = { current: queued };
      const { result } = renderHook(() =>
        useQueueIngest({
          filesRef, archiveSessionsRef: { current: [] }, pendingArchiveReplacementsRef: { current: new Map() },
          setArchiveSessions, setArchiveTotal, dispatch, appState: 'idle', appStateRef: { current: 'idle' },
          apiReady: true, appendConsole,
        }),
      );
      return { release, result };
    };

    it('releases a duplicate already in the queue, never the queued copy', () => {
      const { release, result } = setup([picked('q1', 'uuid-a')]);
      act(() => { result.current.enqueueUniqueFiles([picked('q2', 'uuid-b')]); });
      expect(release).toHaveBeenCalledTimes(1);
      expect(release).toHaveBeenCalledWith('local://uuid-b/Lezione 3.mp3');
    });

    it('releases files picked while a duplicate prompt is open', () => {
      const { release, result } = setup([picked('d1', 'uuid-a', 'done')]);
      act(() => { result.current.enqueueUniqueFiles([picked('q2', 'uuid-b')]); });
      expect(result.current.duplicatePrompt?.kind).toBe('already-processed');
      expect(release).not.toHaveBeenCalled();
      const other: FileItem = { ...picked('q3', 'uuid-c'), name: 'Lezione 4.mp3', path: 'local://uuid-c/Lezione 4.mp3' };
      act(() => { result.current.enqueueUniqueFiles([other]); });
      expect(release).toHaveBeenCalledWith('local://uuid-c/Lezione 4.mp3');
    });

    it('releases an already-processed match on dismiss, not on "add again"', async () => {
      const { release, result } = setup([picked('d1', 'uuid-a', 'done')]);
      act(() => { result.current.enqueueUniqueFiles([picked('q2', 'uuid-b')]); });
      act(() => { result.current.handleDuplicateDismiss(); });
      expect(result.current.duplicatePrompt).toBeNull();
      expect(release).toHaveBeenCalledWith('local://uuid-b/Lezione 3.mp3');

      release.mockClear();
      act(() => { result.current.enqueueUniqueFiles([picked('q3', 'uuid-c')]); });
      const prompt = result.current.duplicatePrompt;
      if (prompt?.kind !== 'already-processed') throw new Error('expected an already-processed prompt');
      await act(async () => { await result.current.handleDuplicateAddAgain(prompt.matches); });
      expect(release).not.toHaveBeenCalled();
    });
  });
});

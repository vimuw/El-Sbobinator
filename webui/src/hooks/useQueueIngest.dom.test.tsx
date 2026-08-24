import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useQueueIngest } from './useQueueIngest';
import type { FileItem } from '../appState';

describe('useQueueIngest', () => {
  const dispatch = vi.fn();
  const setArchiveSessions = vi.fn();
  const setArchiveTotal = vi.fn();
  const appendConsole = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
});

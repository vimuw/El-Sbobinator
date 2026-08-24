import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useConfirmModal } from './useConfirmModal';
import type { FileItem } from '../appState';

describe('useConfirmModal', () => {
  const dispatch = vi.fn();
  const setFolders = vi.fn();
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
        setFolders,
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
        setFolders,
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
});

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBridgeCallbacks } from './useBridgeCallbacks';
import type { AppStatus, FileItem, ProcessDonePayload, ProcessingAction } from '../appState';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

describe('useBridgeCallbacks auto-continue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setPywebview({});
    window.elSbobinatorBridge = null;
  });

  afterEach(() => {
    vi.useRealTimers();
    setPywebview(undefined);
    window.elSbobinatorBridge = null;
  });

  it('waits for the continuation start instead of forcing processing state early', async () => {
    const dispatch = vi.fn<(action: ProcessingAction) => void>();
    const startProcessing = vi.fn<(isContinuation?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    const onFileContinued = vi.fn();
    const onBatchReset = vi.fn();
    const onBatchFullyDone = vi.fn<(data: ProcessDonePayload) => void>();
    const queuedFiles: FileItem[] = [{
      id: 'queued-1',
      name: 'lesson.mp3',
      size: 1,
      duration: 1,
      path: 'C:\\audio\\lesson.mp3',
      status: 'queued',
      progress: 0,
      phase: 0,
    }];

    renderHook(() => {
      const filesRef = useRef<FileItem[]>(queuedFiles);
      const appStateRef = useRef<AppStatus>('idle');
      const autoContinueRef = useRef(true);
      const startProcessingRef = useRef<(isContinuation?: boolean) => Promise<boolean>>(startProcessing);

      useBridgeCallbacks({
        dispatch,
        appendConsole: vi.fn(),
        filesRef,
        appStateRef,
        enqueueUniqueFiles: vi.fn(),
        setRegeneratePrompt: vi.fn(),
        setAskNewKeyPrompt: vi.fn(),
        autoContinueRef,
        startProcessingRef,
        onFileContinued,
        onBatchReset,
        onBatchFullyDone,
      });
    });

    const payload = { completed: 1, failed: 0, total: 2 };

    act(() => {
      window.elSbobinatorBridge?.processDone(payload);
    });

    expect(dispatch).toHaveBeenCalledWith({ type: 'bridge/process_done', data: payload });
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'app/set_status', status: 'processing' });
    expect(onFileContinued).not.toHaveBeenCalled();
    expect(onBatchReset).not.toHaveBeenCalled();
    expect(onBatchFullyDone).not.toHaveBeenCalled();
    expect(startProcessing).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(startProcessing).toHaveBeenCalledTimes(1);
    expect(startProcessing).toHaveBeenCalledWith(true);
    expect(onFileContinued).toHaveBeenCalledTimes(1);
    expect(onBatchReset).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'app/set_status', status: 'processing' });
  });

  it('resets batch progress when the continuation never starts', async () => {
    const dispatch = vi.fn<(action: ProcessingAction) => void>();
    const startProcessing = vi.fn<(isContinuation?: boolean) => Promise<boolean>>().mockResolvedValue(false);
    const onFileContinued = vi.fn();
    const onBatchReset = vi.fn();
    const onBatchFullyDone = vi.fn<(data: ProcessDonePayload) => void>();
    const queuedFiles: FileItem[] = [{
      id: 'queued-1',
      name: 'lesson.mp3',
      size: 1,
      duration: 1,
      path: 'C:\\audio\\lesson.mp3',
      status: 'queued',
      progress: 0,
      phase: 0,
    }];

    renderHook(() => {
      const filesRef = useRef<FileItem[]>(queuedFiles);
      const appStateRef = useRef<AppStatus>('idle');
      const autoContinueRef = useRef(true);
      const startProcessingRef = useRef<(isContinuation?: boolean) => Promise<boolean>>(startProcessing);

      useBridgeCallbacks({
        dispatch,
        appendConsole: vi.fn(),
        filesRef,
        appStateRef,
        enqueueUniqueFiles: vi.fn(),
        setRegeneratePrompt: vi.fn(),
        setAskNewKeyPrompt: vi.fn(),
        autoContinueRef,
        startProcessingRef,
        onFileContinued,
        onBatchReset,
        onBatchFullyDone,
      });
    });

    act(() => {
      window.elSbobinatorBridge?.processDone({ completed: 1, failed: 0, total: 2 });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(startProcessing).toHaveBeenCalledWith(true);
    expect(onFileContinued).not.toHaveBeenCalled();
    expect(onBatchReset).toHaveBeenCalledTimes(1);
    expect(onBatchFullyDone).not.toHaveBeenCalled();
  });
});

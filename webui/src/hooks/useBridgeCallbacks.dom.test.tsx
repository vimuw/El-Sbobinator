import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
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
        clearCompletionFlash: vi.fn(),
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
        clearCompletionFlash: vi.fn(),
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

  it('does not auto-continue when processDone marks quota exhaustion', async () => {
    const startProcessing = vi.fn<(isContinuation?: boolean) => Promise<boolean>>().mockResolvedValue(true);
    const onBatchFullyDone = vi.fn<(data: ProcessDonePayload) => void>();
    const queuedFiles: FileItem[] = [{
      id: 'queued-1',
      name: 'next.mp3',
      size: 1,
      duration: 1,
      path: 'C:\\audio\\next.mp3',
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
        dispatch: vi.fn(),
        appendConsole: vi.fn(),
        filesRef,
        appStateRef,
        enqueueUniqueFiles: vi.fn(),
        setRegeneratePrompt: vi.fn(),
        setAskNewKeyPrompt: vi.fn(),
        autoContinueRef,
        startProcessingRef,
        onFileContinued: vi.fn(),
        onBatchReset: vi.fn(),
        onBatchFullyDone,
        clearCompletionFlash: vi.fn(),
      });
    });

    const payload = { completed: 0, failed: 1, total: 2, quota_exhausted: true };
    act(() => {
      window.elSbobinatorBridge?.processDone(payload);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(startProcessing).not.toHaveBeenCalled();
    expect(onBatchFullyDone).toHaveBeenCalledWith(payload);
  });
});

function makeMinimalHook(overrides: Partial<Parameters<typeof useBridgeCallbacks>[0]> = {}) {
  const filesRef = { current: [] as FileItem[] };
  const appStateRef = { current: 'idle' as AppStatus };
  const autoContinueRef = { current: false };
  const startProcessingRef = { current: vi.fn<(isContinuation?: boolean) => Promise<boolean>>().mockResolvedValue(false) };
  const opts = {
    dispatch: vi.fn(),
    appendConsole: vi.fn(),
    filesRef: filesRef as unknown as ReturnType<typeof useRef<FileItem[]>>,
    appStateRef: appStateRef as unknown as ReturnType<typeof useRef<AppStatus>>,
    enqueueUniqueFiles: vi.fn(),
    setRegeneratePrompt: vi.fn(),
    setAskNewKeyPrompt: vi.fn(),
    autoContinueRef: autoContinueRef as unknown as ReturnType<typeof useRef<boolean>>,
    startProcessingRef: startProcessingRef as unknown as ReturnType<typeof useRef<(isContinuation?: boolean) => Promise<boolean>>>,
    onFileContinued: vi.fn(),
    onBatchReset: vi.fn(),
    onBatchFullyDone: vi.fn<(data: ProcessDonePayload) => void>(),
    clearCompletionFlash: vi.fn(),
    ...overrides,
  };
  return opts;
}

describe('useBridgeCallbacks — direct bridge callbacks', () => {
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

  it('appendConsole callback forwards message', () => {
    const appendConsole = vi.fn();
    const opts = makeMinimalHook({ appendConsole });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => { window.elSbobinatorBridge?.appendConsole('hello'); });
    expect(appendConsole).toHaveBeenCalledWith('hello');
  });

  it('askRegenerate callback forwards data to setRegeneratePrompt', () => {
    const setRegeneratePrompt = vi.fn();
    const opts = makeMinimalHook({ setRegeneratePrompt });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => { window.elSbobinatorBridge?.askRegenerate({ filename: 'test.mp3' }); });
    expect(setRegeneratePrompt).toHaveBeenCalledWith(expect.objectContaining({ filename: 'test.mp3' }));
  });

  it('askNewKey callback sets askNewKeyPrompt', () => {
    const setAskNewKeyPrompt = vi.fn();
    const opts = makeMinimalHook({ setAskNewKeyPrompt });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => { window.elSbobinatorBridge?.askNewKey(); });
    expect(setAskNewKeyPrompt).toHaveBeenCalledWith(true);
  });

  it('dismissNewKey callback clears askNewKeyPrompt', () => {
    const setAskNewKeyPrompt = vi.fn();
    const opts = makeMinimalHook({ setAskNewKeyPrompt });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => { window.elSbobinatorBridge?.dismissNewKey(); });
    expect(setAskNewKeyPrompt).toHaveBeenCalledWith(false);
  });

  it('forwards the Drive sync events of the web previews', () => {
    const onArchiveChangedRemotely = vi.fn();
    const onDocumentChangedElsewhere = vi.fn();
    const onDriveNeedsReconnect = vi.fn();
    const opts = makeMinimalHook({ onArchiveChangedRemotely, onDocumentChangedElsewhere, onDriveNeedsReconnect });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => {
      window.elSbobinatorBridge?.archiveChangedRemotely?.();
      window.elSbobinatorBridge?.documentChangedElsewhere?.({ session_dir: 'web-session://a' });
      window.elSbobinatorBridge?.driveNeedsReconnect?.();
    });
    expect(onArchiveChangedRemotely).toHaveBeenCalledTimes(1);
    expect(onDocumentChangedElsewhere).toHaveBeenCalledWith({ session_dir: 'web-session://a' });
    expect(onDriveNeedsReconnect).toHaveBeenCalledTimes(1);
  });

  it('filesDropped calls enqueueUniqueFiles when appState is idle or processing', () => {
    const enqueueUniqueFiles = vi.fn();
    const opts = makeMinimalHook({ enqueueUniqueFiles });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => {
      window.elSbobinatorBridge?.filesDropped([{ id: 'x', name: 'f.mp3', path: '/f.mp3', size: 100, duration: 30 }]);
    });
    expect(enqueueUniqueFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'f.mp3' })]),
    );

    enqueueUniqueFiles.mockClear();
    opts.appStateRef.current = 'processing';
    act(() => {
      window.elSbobinatorBridge?.filesDropped([{ id: 'y', name: 'Fisiologia II Lezione 1 pt 1', path: '/audio', size: 200, duration: 60 }]);
    });
    expect(enqueueUniqueFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ name: 'Fisiologia II Lezione 1 pt 1' })]),
    );
  });

  it('filesDropped does not call enqueueUniqueFiles when appState is canceling', () => {
    const enqueueUniqueFiles = vi.fn();
    const opts = makeMinimalHook({ enqueueUniqueFiles });
    opts.appStateRef.current = 'canceling';
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => {
      window.elSbobinatorBridge?.filesDropped([{ id: 'x', name: 'f.mp3', path: '/f.mp3', size: 100, duration: 30 }]);
    });
    expect(enqueueUniqueFiles).not.toHaveBeenCalled();
  });

  it('fileDone on the web says the audio is not kept and where to keep it', () => {
    const doneFile: FileItem = {
      id: 'file-1', name: 'audio.mp3', size: 1, duration: 60, path: '/a.mp3', status: 'done', progress: 1, phase: 0,
    };
    type AddNotification = Parameters<typeof useBridgeCallbacks>[0]['addNotification'];
    const finish = (addNotification: AddNotification) => {
      const opts = makeMinimalHook({ addNotification });
      opts.filesRef = { current: [doneFile] } as unknown as ReturnType<typeof useRef<FileItem[]>>;
      const { unmount } = renderHook(() => { useBridgeCallbacks(opts); });
      act(() => { window.elSbobinatorBridge?.fileDone({ id: 'file-1', index: 0, output_html: '/out.html', output_dir: '/sessions/x' }); });
      unmount();
    };
    const web = vi.fn<AddNotification>();
    finish(web);
    expect(web).toHaveBeenCalledWith('Sbobina pronta', expect.stringContaining('L’audio non viene conservato'), 'success', 'processing');
    expect(web.mock.calls[0][1]).toContain('«Tieni l’audio nel browser»');
  });

  it('fileDone on the web does not say the audio is not kept for an existing sbobina it reused', () => {
    // «Tieni l’audio nel browser» may already be on for it: the queue card then shows the audio size.
    const doneFile: FileItem = {
      id: 'file-1', name: 'audio.mp3', size: 1, duration: 60, path: '/a.mp3', status: 'done', progress: 1, phase: 0,
    };
    const addNotification = vi.fn<Parameters<typeof useBridgeCallbacks>[0]['addNotification']>();
    const opts = makeMinimalHook({ addNotification });
    opts.filesRef = { current: [doneFile] } as unknown as ReturnType<typeof useRef<FileItem[]>>;
    try {
      const { unmount } = renderHook(() => { useBridgeCallbacks(opts); });
      act(() => {
        window.elSbobinatorBridge?.fileDone({ id: 'file-1', index: 0, output_html: '/out.html', output_dir: '/sessions/x', reused_existing: true });
      });
      unmount();
    } finally {
      setHostCapabilities(DEFAULT_CAPABILITIES);
    }
    expect(addNotification).toHaveBeenCalledWith('Sbobina pronta', '"audio.mp3" completata con successo.', 'success', 'processing');
  });

  it('processDone with no queued files and autoContinue=false calls onBatchFullyDone', async () => {
    const onBatchFullyDone = vi.fn<(data: ProcessDonePayload) => void>();
    const opts = makeMinimalHook({ onBatchFullyDone });
    renderHook(() => { useBridgeCallbacks(opts); });
    const payload = { completed: 1, failed: 0, total: 1 };
    act(() => { window.elSbobinatorBridge?.processDone(payload); });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(onBatchFullyDone).toHaveBeenCalledWith(payload);
  });

  it('processDone clears any regenerate prompt left open by a backend timeout', () => {
    const setRegeneratePrompt = vi.fn();
    const opts = makeMinimalHook({ setRegeneratePrompt });
    renderHook(() => { useBridgeCallbacks(opts); });
    act(() => { window.elSbobinatorBridge?.processDone({ completed: 0, failed: 1, total: 1 }); });
    expect(setRegeneratePrompt).toHaveBeenCalledWith(null);
  });

  it('askNewKey on the web points to the dialog, not to the settings', () => {
    const addNotification = vi.fn();
    renderHook(() => { useBridgeCallbacks(makeMinimalHook({ addNotification })); });
    act(() => { window.elSbobinatorBridge?.askNewKey(); });
    expect(addNotification).toHaveBeenCalledWith('Chiavi esaurite', expect.stringContaining('vale solo per questa elaborazione'), 'warning', 'system');
    expect(addNotification.mock.calls[0][1]).not.toContain('impostazioni');
  });

  it('fileFailed tells server overload, pause and error apart in the notifications', () => {
    const addNotification = vi.fn<Parameters<typeof useBridgeCallbacks>[0]['addNotification']>();
    const failedFile: FileItem = {
      id: 'file-1', name: 'audio.mp3', size: 1, duration: 60, path: '/a.mp3', status: 'error', progress: 0, phase: 0,
    };
    const opts = makeMinimalHook({ addNotification });
    opts.filesRef = { current: [failedFile] } as unknown as ReturnType<typeof useRef<FileItem[]>>;
    renderHook(() => { useBridgeCallbacks(opts); });

    act(() => { window.elSbobinatorBridge?.fileFailed({ id: 'file-1', index: 0, error: 'Modello Gemini indisponibile' }); });
    expect(addNotification).toHaveBeenLastCalledWith('Server occupati', expect.stringContaining('"audio.mp3"'), 'warning', 'processing');

    act(() => { window.elSbobinatorBridge?.fileFailed({ id: 'file-1', index: 0, error: 'regenerate_prompt_timeout' }); });
    expect(addNotification).toHaveBeenLastCalledWith('Elaborazione in pausa', expect.stringContaining('Nessuna scelta ricevuta'), 'warning', 'processing');

    act(() => { window.elSbobinatorBridge?.fileFailed({ id: 'file-1', index: 0, error: 'Errore generico di test' }); });
    expect(addNotification).toHaveBeenLastCalledWith('Errore elaborazione', 'Errore per "audio.mp3": Errore generico di test', 'error', 'processing');
  });

  it('does not auto-continue queued files after a circuit-breaker pause', async () => {
    const startProcessing = vi.fn().mockResolvedValue(true);
    const onBatchFullyDone = vi.fn();
    const opts = makeMinimalHook();
    opts.filesRef = { current: [{
      id: 'queued-1', name: 'lesson.mp3', size: 1, duration: 1,
      path: 'C:\\audio\\lesson.mp3', status: 'queued', progress: 0, phase: 0,
    }] } as unknown as ReturnType<typeof useRef<FileItem[]>>;
    opts.autoContinueRef = { current: true } as ReturnType<typeof useRef<boolean>>;
    opts.startProcessingRef = { current: startProcessing } as unknown as ReturnType<typeof useRef<(isContinuation?: boolean) => Promise<boolean>>>;
    opts.onBatchFullyDone = onBatchFullyDone;
    renderHook(() => { useBridgeCallbacks(opts); });

    const payload = { completed: 0, failed: 0, paused: 1, total: 2 };
    act(() => {
      window.elSbobinatorBridge?.processDone(payload);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(startProcessing).not.toHaveBeenCalled();
    expect(onBatchFullyDone).toHaveBeenCalledWith(payload);
  });

  it('leaves retry waits to the phase line instead of adding console lines', () => {
    const appendConsole = vi.fn();
    const opts = makeMinimalHook();
    opts.appendConsole = appendConsole;
    renderHook(() => { useBridgeCallbacks(opts); });

    act(() => {
      window.elSbobinatorBridge?.retryStateChanged?.({
        state: 'cooling_down', attempt: 2, max_attempts: 4, seconds_remaining: 15,
      });
      window.elSbobinatorBridge?.retryStateChanged?.({
        state: 'probing', attempt: 2, max_attempts: 4, model: 'gemini-2.5-flash',
      });
      window.elSbobinatorBridge?.retryStateChanged?.({
        state: 'exhausted', attempt: 4, max_attempts: 4,
      });
    });

    // "Server Gemini occupato — riprovo tra 15s (tentativo 2/4)" already reaches the console as a phase.
    expect(appendConsole).not.toHaveBeenCalled();
  });
});

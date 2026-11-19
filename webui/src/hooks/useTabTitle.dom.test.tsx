import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialProcessingState, processingReducer, type ProcessingAction, type ProcessingState, type RunOutcome } from '../appState';
import { formatTabTitle, useTabTitle, type UseTabTitleOptions } from './useTabTitle';

const BASE = 'El Sbobinator';

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

const idle: UseTabTitleOptions = {
  enabled: true,
  appState: 'idle',
  activeProgress: 0,
  batchCompleted: 0,
  batchTotal: 1,
  runOutcome: null,
  lastCompletedAt: 0,
  queueOnScreen: false,
  retryingBlocks: false,
  batchOpen: false,
  queuedLeft: false,
};

function renderTabTitle(initial: Partial<UseTabTitleOptions> = {}) {
  return renderHook((props: UseTabTitleOptions) => useTabTitle(props), { initialProps: { ...idle, ...initial } });
}

const errorOutcome: RunOutcome = { kind: 'error', fileId: 'a', fileName: 'Lezione', warnings: [] };

describe('formatTabTitle', () => {
  it('shows progress, batch position and the stop in progress', () => {
    expect(formatTabTitle({ ...idle, appState: 'processing', result: null })).toBe(`⏳ In corso · ${BASE}`);
    expect(formatTabTitle({ ...idle, appState: 'processing', activeProgress: 42, result: null })).toBe(`⏳ 42% · ${BASE}`);
    expect(formatTabTitle({ ...idle, appState: 'processing', activeProgress: 7, batchCompleted: 1, batchTotal: 3, result: null })).toBe(`⏳ 2/3 · 7% · ${BASE}`);
    expect(formatTabTitle({ ...idle, appState: 'canceling', result: null })).toBe(`⏳ Interruzione… · ${BASE}`);
    expect(formatTabTitle({ ...idle, result: 'warning' })).toBe(`⚠️ Completata con avvisi · ${BASE}`);
    expect(formatTabTitle({ ...idle, result: null })).toBe(BASE);
  });
});

describe('useTabTitle', () => {
  beforeEach(() => {
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    document.title = BASE;
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'visibilityState');
    vi.restoreAllMocks();
  });

  it('keeps the completion in the title while the user is in the editor, until the queue is back on screen', async () => {
    const { rerender } = renderTabTitle();
    rerender({ ...idle, appState: 'processing', activeProgress: 55 });
    expect(document.title).toBe(`⏳ 55% · ${BASE}`);

    // Straight from the progress to the result, without the bare title in between.
    const written: string[] = [];
    const observer = new MutationObserver(() => written.push(document.title));
    observer.observe(document.head, { childList: true, characterData: true, subtree: true });
    rerender({ ...idle, lastCompletedAt: Date.now() + 1 });
    await Promise.resolve();
    observer.disconnect();
    expect(document.title).toBe(`✅ Completata · ${BASE}`);
    expect(written).toEqual([`✅ Completata · ${BASE}`]);

    rerender({ ...idle, lastCompletedAt: Date.now() + 1, queueOnScreen: true });
    expect(document.title).toBe(BASE);
  });

  it('reports a failed run with the run outcome', () => {
    const { rerender } = renderTabTitle();
    rerender({ ...idle, appState: 'processing' });
    rerender({ ...idle, runOutcome: errorOutcome });
    expect(document.title).toBe(`❌ Errore · ${BASE}`);
  });

  it('reports nothing after a stop asked by the user', () => {
    const { rerender } = renderTabTitle();
    rerender({ ...idle, appState: 'processing' });
    rerender({ ...idle, appState: 'canceling' });
    rerender({ ...idle });
    expect(document.title).toBe(BASE);
  });

  it('reports nothing when the run ends with the queue already on screen', () => {
    const { rerender } = renderTabTitle({ queueOnScreen: true });
    rerender({ ...idle, appState: 'processing', queueOnScreen: true });
    rerender({ ...idle, lastCompletedAt: Date.now() + 1, queueOnScreen: true });
    expect(document.title).toBe(BASE);
  });

  it('keeps the result while the tab is in the background, even on the queue', () => {
    const { rerender } = renderTabTitle({ queueOnScreen: true });
    rerender({ ...idle, appState: 'processing', queueOnScreen: true });
    act(() => setVisibility('hidden'));
    rerender({ ...idle, lastCompletedAt: Date.now() + 1, queueOnScreen: true });
    expect(document.title).toBe(`✅ Completata · ${BASE}`);

    act(() => setVisibility('visible'));
    expect(document.title).toBe(BASE);
  });

  it('reports nothing after a block retry that fails while the user is away', () => {
    // Same derivation as App.tsx, on the real reducer, dispatched like useRevisionRetry.
    const propsOf = (state: ProcessingState): UseTabTitleOptions => ({
      ...idle,
      appState: state.appState,
      runOutcome: state.runOutcome,
      lastCompletedAt: state.files.reduce((latest, file) => Math.max(latest, file.completedAt ?? 0), 0),
      retryingBlocks: state.files.some(file => file.isRetryingBlocks),
    });
    let state = createInitialProcessingState([{
      id: 'a', name: 'Lezione', size: 1, duration: 1, status: 'done', progress: 100, phase: 3,
      completedAt: 1, completionStatus: 'completed_with_warnings', revisionFailedBlocks: [2],
    }]);
    const dispatch = (...actions: ProcessingAction[]) => {
      for (const action of actions) state = processingReducer(state, action);
    };
    const { rerender } = renderTabTitle(propsOf(state));

    dispatch({ type: 'queue/set_retrying_blocks', id: 'a', value: true }, { type: 'app/set_status', status: 'processing' });
    rerender(propsOf(state));
    expect(document.title).toBe(`⏳ In corso · ${BASE}`);

    // The retry API answered ok:false: the finally block puts the sbobina back and the app to idle.
    dispatch({ type: 'queue/set_retrying_blocks', id: 'a', value: false }, { type: 'app/set_status', status: 'idle' });
    rerender(propsOf(state));
    expect(state.runOutcome).toBeNull();
    expect(document.title).toBe(BASE);
  });

  /**
   * A web batch on the real reducer, with the batch counters and the hand-over to the next file
   * kept like useQueueProcessing / useBridgeCallbacks (onBatchDone) and the props derived like App.tsx.
   * The web runs one file per start: each file ends with its own process_done (idle), and the next
   * one starts only after a timer and an async start.
   */
  function webBatch(ids: string[]) {
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => ++now);
    let state = createInitialProcessingState(ids.map(id => ({ id, name: id, size: 1, duration: 1, status: 'queued' as const, progress: 0, phase: 0 })));
    const batch = { total: 0, completed: 0 };
    const autoContinue = true;
    const dispatch = (...actions: ProcessingAction[]) => {
      for (const action of actions) state = processingReducer(state, action);
    };
    const props = (): UseTabTitleOptions => ({
      ...idle,
      appState: state.appState,
      activeProgress: state.activeProgress,
      batchCompleted: batch.completed,
      batchTotal: batch.total,
      runOutcome: state.runOutcome,
      lastCompletedAt: state.files.reduce((latest, file) => Math.max(latest, file.completedAt ?? 0), 0),
      retryingBlocks: state.files.some(file => file.isRetryingBlocks),
      batchOpen: batch.total > 0,
      queuedLeft: autoContinue && state.files.some(file => file.status === 'queued'),
    });
    const startFile = (id: string) => dispatch(
      { type: 'bridge/set_current_file', data: { id, index: 0, total: 1 } },
      { type: 'app/set_status', status: 'processing' },
    );
    return {
      props,
      /** startProcessing() of a new batch. */
      start(id: string) {
        batch.total = state.files.filter(file => file.status === 'queued').length;
        batch.completed = 0;
        dispatch({ type: 'outcome/clear' });
        startFile(id);
      },
      /** The file's done event, then process_done and onBatchDone, in the same bridge call. */
      finish(id: string) {
        dispatch({ type: 'bridge/file_done', data: { id, index: 0, output_html: `${id}.html` } }, { type: 'bridge/process_done', data: { total: 1, completed: 1 } });
        if (!(autoContinue && state.files.some(file => file.status === 'queued'))) Object.assign(batch, { total: 0, completed: 0 });
      },
      /** The continuation timer fired and startProcessing(true) started the next file. */
      continueWith(id: string) {
        startFile(id);
        batch.completed += 1;
      },
      /** The continuation could not start the next file: onBatchReset. */
      failContinuation() {
        Object.assign(batch, { total: 0, completed: 0 });
      },
    };
  }

  it('does not report a completion between two files of a batch, only when the batch ends', () => {
    const run = webBatch(['a', 'b']);
    const { rerender } = renderTabTitle(run.props());
    run.start('a');
    rerender(run.props());
    expect(document.title).toBe(`⏳ 1/2 · In corso · ${BASE}`);

    // File 1 of 2 ends while the user is in the editor: the app is idle until file 2 starts.
    run.finish('a');
    rerender(run.props());
    expect(document.title).not.toContain('Completata');
    expect(document.title).toBe(BASE);

    run.continueWith('b');
    rerender(run.props());
    expect(document.title).toBe(`⏳ 2/2 · In corso · ${BASE}`);

    run.finish('b');
    rerender(run.props());
    expect(document.title).toBe(`✅ Completata · ${BASE}`);
  });

  it('reports no completion when the next file of the batch fails to start', () => {
    const run = webBatch(['a', 'b']);
    const { rerender } = renderTabTitle(run.props());
    run.start('a');
    rerender(run.props());
    run.finish('a');
    rerender(run.props());

    run.failContinuation();
    rerender(run.props());
    expect(document.title).toBe(BASE);
  });

  it('leaves the title alone when disabled (desktop)', () => {
    const { rerender } = renderTabTitle({ enabled: false });
    rerender({ ...idle, enabled: false, appState: 'processing', activeProgress: 30 });
    expect(document.title).toBe(BASE);
  });
});

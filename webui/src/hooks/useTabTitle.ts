import { useEffect, useState } from 'react';
import type { AppStatus, RunOutcome } from '../appState';
import { APP_WINDOW_TITLE } from '../branding';

/** How the last run ended, kept in the tab title until the user has seen it. */
export type TabRunResult = 'done' | RunOutcome['kind'];

export type TabTitleInput = {
  appState: AppStatus;
  /** Progress of the file being processed, 0-100. */
  activeProgress: number;
  batchCompleted: number;
  batchTotal: number;
  result: TabRunResult | null;
};

const RESULT_LABELS: Record<TabRunResult, string> = {
  done: '✅ Completata',
  warning: '⚠️ Completata con avvisi',
  paused: '⏸️ In pausa',
  error: '❌ Errore',
};

export function formatTabTitle({ appState, activeProgress, batchCompleted, batchTotal, result }: TabTitleInput): string {
  if (appState === 'canceling') return `⏳ Interruzione… · ${APP_WINDOW_TITLE}`;
  if (appState === 'processing') {
    const parts: string[] = [];
    if (batchTotal > 1) parts.push(`${Math.min(batchCompleted + 1, batchTotal)}/${batchTotal}`);
    parts.push(activeProgress > 0 ? `${Math.min(100, Math.round(activeProgress))}%` : 'In corso');
    return `⏳ ${parts.join(' · ')} · ${APP_WINDOW_TITLE}`;
  }
  return result ? `${RESULT_LABELS[result]} · ${APP_WINDOW_TITLE}` : APP_WINDOW_TITLE;
}

export type UseTabTitleOptions = Omit<TabTitleInput, 'result'> & {
  enabled: boolean;
  runOutcome: RunOutcome | null;
  /** Latest completedAt among the queue files: tells a finished run from a cancelled one. */
  lastCompletedAt: number;
  /** The queue page is on screen (no editor or settings over it), where the run's result shows. */
  queueOnScreen: boolean;
  /**
   * A completed sbobina is retrying its missing revision blocks. That processing is not a run: it
   * sets no run outcome and stamps a new completedAt however it ends, so it reports no result.
   */
  retryingBlocks: boolean;
  /**
   * A batch is under way. On the web each file is its own run: between two files the app is idle
   * until the next one starts, which is not the end of the batch, so the result waits.
   */
  batchOpen: boolean;
  /**
   * Queued files the batch would go on with (auto-continue): a batch that ends with them left has
   * stopped early, as when the next file fails to start, and is not "Completata".
   */
  queuedLeft: boolean;
};

function isPageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

/**
 * Web only: the tab title tells how the sbobinatura is going while the user is elsewhere (the
 * editor, the archive or another tab), and how it ended until they come back to the queue.
 */
export function useTabTitle({ enabled, appState, activeProgress, batchCompleted, batchTotal, runOutcome, lastCompletedAt, queueOnScreen, retryingBlocks, batchOpen, queuedLeft }: UseTabTitleOptions) {
  const [result, setResult] = useState<TabRunResult | null>(null);
  const [pageVisible, setPageVisible] = useState(isPageVisible);
  // The previous status, the latest completion when the run started, whether a block retry started
  // it and whether it ended with a result still to report, so the result is set in the same render
  // the batch ends (an effect would flash the bare title first).
  const [tracked, setTracked] = useState({ appState, completedAtStart: lastCompletedAt, blockRetry: false, ended: false });
  const seen = queueOnScreen && pageVisible;

  let next = tracked;
  let nextResult = result;
  if (tracked.appState !== appState) {
    const prev = tracked.appState;
    const starting = appState === 'processing' && prev === 'idle';
    const completedAtStart = starting ? lastCompletedAt : tracked.completedAtStart;
    // The retry raises its flag before the status, and may clear it before the status goes back.
    const blockRetry = starting ? retryingBlocks : tracked.blockRetry;
    // A stop asked by the user goes through 'canceling' and leaves nothing to report.
    const ended = prev === 'processing' && appState === 'idle' && !blockRetry;
    next = { appState, completedAtStart, blockRetry, ended };
    if (appState === 'processing') nextResult = null;
  }
  // The result waits for the batch to end: the next file starting drops it (above).
  if (next.ended && appState === 'idle' && !batchOpen) {
    next = { ...next, ended: false };
    if (!seen) {
      if (runOutcome) nextResult = runOutcome.kind;
      else if (!queuedLeft && lastCompletedAt > next.completedAtStart) nextResult = 'done';
    }
  }
  if (seen) nextResult = null;
  if (next !== tracked) setTracked(next);
  if (nextResult !== result) setResult(nextResult);

  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => setPageVisible(isPageVisible());
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled]);

  const title = formatTabTitle({ appState, activeProgress, batchCompleted, batchTotal, result });
  useEffect(() => {
    if (enabled) document.title = title;
  }, [enabled, title]);
}

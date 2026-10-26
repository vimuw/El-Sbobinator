import type { PageState } from './pipeline/run';
import { CancelledError } from './pipeline/retry';

// What the pipeline needs to know about the page: Safari suspends a hidden page (and can kill its
// requests), so a failure while hidden is retried on return; offline waits for the network.

const OFFLINE_POLL_MS = 10_000;

function untilEvent(target: EventTarget, type: string, ready: () => boolean, signal: AbortSignal, pollMs?: number): Promise<void> {
  if (signal.aborted) return Promise.reject(new CancelledError('annullato'));
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!ready()) return;
      cleanup();
      resolve();
    };
    const abort = () => {
      cleanup();
      reject(new CancelledError('annullato'));
    };
    const timer = pollMs ? setInterval(check, pollMs) : null;
    function cleanup() {
      target.removeEventListener(type, check);
      signal.removeEventListener('abort', abort);
      if (timer) clearInterval(timer);
    }
    target.addEventListener(type, check);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createPageState(doc: Document = document, win: Window = window, now: () => number = () => performance.now()): PageState & { dispose(): void } {
  // End of the last hidden period (now() time); while hidden, the period is still open.
  let lastHiddenEnd = doc.hidden ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const onVisibility = () => {
    lastHiddenEnd = doc.hidden ? Number.POSITIVE_INFINITY : now();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  // A page restored from the back/forward cache was hidden too.
  win.addEventListener('pageshow', onVisibility);

  return {
    isOffline: () => win.navigator.onLine === false,
    waitOnline: signal => untilEvent(win, 'online', () => win.navigator.onLine !== false, signal, OFFLINE_POLL_MS),
    isHidden: () => doc.hidden,
    wasHiddenSince: since => doc.hidden || lastHiddenEnd >= since,
    waitVisible: signal => untilEvent(doc, 'visibilitychange', () => !doc.hidden, signal),
    dispose: () => {
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('pageshow', onVisibility);
    },
  };
}

type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean };
type WakeLockLike = { request(type: 'screen'): Promise<WakeLockSentinelLike> };

/** Keeps the screen on during a run; the browser drops the lock when the page is hidden, so it is taken again on return. */
export function createScreenWakeLock(doc: Document = document, nav: Navigator = navigator) {
  const wakeLock = (nav as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  let sentinel: WakeLockSentinelLike | null = null;
  let active = false;
  const acquire = async () => {
    if (!wakeLock || !active || doc.hidden || (sentinel && !sentinel.released)) return;
    try {
      sentinel = await wakeLock.request('screen');
    } catch {
      // Not allowed (low battery, no user gesture): the run goes on without it.
      sentinel = null;
    }
  };
  const onVisibility = () => {
    if (!doc.hidden) void acquire();
  };
  return {
    supported: Boolean(wakeLock),
    async start() {
      active = true;
      doc.addEventListener('visibilitychange', onVisibility);
      await acquire();
    },
    async stop() {
      active = false;
      doc.removeEventListener('visibilitychange', onVisibility);
      const current = sentinel;
      sentinel = null;
      await current?.release().catch(() => undefined);
    },
  };
}

export type ScreenWakeLock = ReturnType<typeof createScreenWakeLock>;

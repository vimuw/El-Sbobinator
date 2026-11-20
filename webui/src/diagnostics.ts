/** Bounded error reports, including failures before pywebview's bridge is ready. */
type Event = { kind: string; message: string; stack: string };
const pending: Event[] = [];
let installed = false;
let sent = 0;
let draining = false;
let retries = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const seen = new Set<string>();

async function drain() {
  const api = window.pywebview?.api?.record_frontend_event;
  if (!api || draining || retryTimer !== null) return;
  draining = true;
  try {
    while (pending.length) {
      const event = pending[0];
      try {
        const result = await api(event.kind, event.message, event.stack);
        if (!result.ok) break;
        pending.shift();
        retries = 0;
      } catch { break; }
    }
  } finally {
    draining = false;
    if (pending.length && retries < 3) {
      retries += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void drain();
      }, 1000);
    }
  }
}

// The web build's error reports (monitoring/sentry.ts), when the build and the user have them on.
type ErrorMonitor = (source: string, error: unknown) => void;
let monitor: ErrorMonitor | null = null;

export function setErrorMonitor(next: ErrorMonitor | null) {
  monitor = next;
}

function notifyMonitor(source: string, error: unknown) {
  try {
    monitor?.(source, error);
  } catch {
    // A report that cannot be built never breaks the page.
  }
}

export function reportClientError(source: string, error: unknown = 'Errore senza dettagli') {
  // Keep developer-console behavior; production builds drop this statement,
  // while the explicit bridge report below remains.
  console.error(source, error);
  notifyMonitor(source, error);
  const message = `${source}: ${error instanceof Error ? error.message : String(error)}`.slice(0, 3000);
  const stack = error instanceof Error ? (error.stack || '').slice(0, 6000) : '';
  enqueue({ kind: source === 'react' ? 'react' : 'error', message, stack });
}

function enqueue(event: Event) {
  const key = `${event.kind}:${event.message}`;
  if (seen.has(key) || sent >= 30 || pending.length >= 20) return;
  seen.add(key);
  sent += 1;
  pending.push(event);
  void drain();
}

export function reportFrontendReady() {
  enqueue({ kind: 'ready', message: '', stack: '' });
}

// Chrome's notice that a resize observer changed the layout it was measuring: it delivers the rest on
// the next frame, nothing breaks. It comes as an error event with no Error object.
const BENIGN_WINDOW_MESSAGES = ['ResizeObserver loop completed with undelivered notifications', 'ResizeObserver loop limit exceeded'];

function isBenignWindowError(event: ErrorEvent): boolean {
  return !event.error && BENIGN_WINDOW_MESSAGES.some(message => String(event.message ?? '').includes(message));
}

export function installFrontendDiagnostics() {
  if (installed) return;
  installed = true;
  document.documentElement.dataset.diagnosticsReady = 'true';
  window.addEventListener('pywebviewready', () => { void drain(); });
  window.addEventListener('error', event => {
    if (isBenignWindowError(event)) return;
    reportClientError('window', event.error || event.message);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    notifyMonitor('unhandledrejection', reason);
    enqueue({ kind: 'unhandledrejection', message: String(reason instanceof Error ? reason.message : reason).slice(0, 3000), stack: reason instanceof Error ? (reason.stack || '').slice(0, 6000) : '' });
  });
}

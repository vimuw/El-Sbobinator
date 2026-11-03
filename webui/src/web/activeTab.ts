import { showNoticePage } from './noticePage';

// One tab of the site at a time. The tabs of a browser share its archive and the Drive sync state,
// and two of them writing at once lose changes; other devices and other browsers have their own
// and meet only on Drive. A second tab waits for the first to close, or takes over with "Usa qui":
// the first one then reloads into the waiting page.

export const ACTIVE_TAB_LOCK = 'el-sbobinator-app';

export interface ActiveTabOptions {
  /** navigator.locks; without it (old browsers) every tab runs, as before. */
  locks?: LockManager | null;
  /** Another tab has the app: shown until this one becomes active. `takeOver` makes it active now. */
  onWaiting: (takeOver: () => void) => void;
  /** Another tab took over this one. */
  onLost: () => void;
}

const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * Resolves once this tab is the active one, which it stays until the page goes or another takes over.
 * A browser that refuses the lock (site data blocked: SecurityError) runs the app as without Web Locks.
 */
export function claimActiveTab({ locks = globalThis.navigator?.locks, onWaiting, onLost }: ActiveTabOptions): Promise<void> {
  if (!locks) return Promise.resolve();
  return new Promise<void>(resolve => {
    const request = (options: LockOptions, whenUnavailable?: () => void) => {
      let mine = false;
      Promise.resolve().then(() => locks.request(ACTIVE_TAB_LOCK, options, lock => {
        if (!lock) {
          whenUnavailable?.();
          return undefined;
        }
        mine = true;
        resolve();
        // Held for the page's life.
        return new Promise<never>(() => {});
      })).catch(error => {
        if (mine) onLost();
        else if (!isAbort(error)) resolve();
      });
    };
    request({ ifAvailable: true }, () => {
      const queued = new AbortController();
      request({ signal: queued.signal });
      onWaiting(() => {
        queued.abort();
        request({ steal: true });
      });
    });
  });
}

/** The page shown while another tab has the app; returns its removal. */
export function showWaitingPage(takeOver: () => void, target: Document = document): () => void {
  return showNoticePage({
    title: 'El Sbobinator è aperto in un’altra scheda',
    text: 'Si usa in una scheda alla volta di questo browser. Chiudi l’altra scheda e questa si apre da sola, oppure continua qui: l’altra scheda si ferma.',
    button: 'Usa qui',
    onClick: takeOver,
  }, target);
}

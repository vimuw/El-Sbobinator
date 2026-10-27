import type { DriveStatus } from '../../bridge';
import { DriveAuthError, type DriveAuth } from './auth';
import { DriveError, type DriveApi } from './driveApi';
import { syncOnce, type SyncReport } from './sync';
import { bindAccount, readMeta } from './syncState';

// When the Drive sync runs: at startup, when the page comes back to the foreground or online, and a
// few seconds after the last local change. One round at a time; never while a Gemini run works (the
// round waits for runEnded). Without a token nothing runs: the settings show "tocca per riconnettere".

export const SYNC_DELAY_MS = 4000;

export interface DriveServiceOptions {
  factory: IDBFactory | undefined;
  auth: DriveAuth;
  api: DriveApi;
  /** A Gemini run is active: the round waits for runEnded(). */
  isBusy: () => boolean;
  isOpenInEditor?: (sessionDir: string) => boolean;
  onReport?: (report: SyncReport) => void;
  /** A round found the login expired (401). */
  onNeedsReconnect?: () => void;
  delayMs?: number;
  now?: () => Date;
}

export interface DriveService {
  status(): DriveStatus;
  /** A local change: a round follows after a short quiet period. */
  schedule(): void;
  /** A round now, or right after the one in progress; resolves when done. */
  syncNow(): Promise<DriveStatus>;
  /** Opens the Google window synchronously: call it inside a tap. */
  connect(): Promise<DriveStatus>;
  disconnect(): Promise<DriveStatus>;
  /** The Gemini run ended: a round it held back runs now. */
  runEnded(): void;
  /** Startup round plus the foreground and online triggers; returns their cleanup. */
  start(target?: { window: Window; document: Document }): () => void;
}

export function describeDriveError(error: unknown): string {
  if (error instanceof DriveAuthError) {
    return error.needsInteractiveLogin ? 'Google chiede di confermare l’accesso: tocca di nuovo il pulsante per scegliere l’account.' : error.message;
  }
  if (error instanceof DriveError) {
    if (error.needsAuthorization) return 'Accesso a Google Drive scaduto: tocca per riconnettere.';
    if (error.offline) return 'Google Drive non raggiungibile: le modifiche partiranno quando torna la connessione.';
    if (error.reason === 'storageQuotaExceeded') return 'Spazio su Google Drive esaurito: le sbobine restano comunque in questo browser.';
    return error.message;
  }
  return `Sincronizzazione non riuscita: ${error instanceof Error ? error.message : String(error)}`;
}

export function createDriveService(options: DriveServiceOptions): DriveService {
  const { factory, auth, api } = options;
  const now = options.now ?? (() => new Date());
  const delayMs = options.delayMs ?? SYNC_DELAY_MS;
  let syncing = false;
  let lastSyncAt: string | null = null;
  let error: string | null = null;
  // After a silent attempt Google refused, the next tap opens the full account choice.
  let interactiveNext = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loop: Promise<void> | null = null;
  let pending = false;
  let waitingForRun = false;
  // "Disconnetti" during a round: whatever that round ends with no longer concerns the status.
  let epoch = 0;

  const status = (): DriveStatus => {
    const email = auth.account();
    const token = auth.token();
    return {
      available: true,
      connected: Boolean(email || token),
      email,
      needs_reconnect: Boolean(email) && !token,
      syncing,
      last_sync_at: lastSyncAt,
      error,
    };
  };

  const round = async () => {
    if (!auth.token()) return;
    const started = epoch;
    syncing = true;
    try {
      const report = await syncOnce({ factory, api, now, isOpenInEditor: options.isOpenInEditor });
      if (started !== epoch) return;
      lastSyncAt = now().toISOString();
      error = null;
      options.onReport?.(report);
    } catch (caught) {
      if (started !== epoch) return;
      error = describeDriveError(caught);
      if (caught instanceof DriveError && caught.needsAuthorization) options.onNeedsReconnect?.();
    } finally {
      if (started === epoch) syncing = false;
    }
  };

  const run = (): Promise<void> => {
    pending = true;
    loop ??= (async () => {
      while (pending) {
        pending = false;
        if (options.isBusy()) {
          waitingForRun = true;
          return;
        }
        await round();
      }
    })().finally(() => {
      loop = null;
      // Asked for while the loop was ending.
      if (pending && !waitingForRun) void run();
    });
    return loop;
  };

  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  return {
    status,

    schedule() {
      cancelTimer();
      timer = setTimeout(() => {
        timer = null;
        void run();
      }, delayMs);
    },

    async syncNow() {
      cancelTimer();
      await run();
      return status();
    },

    connect() {
      const silent = auth.account() !== null && !interactiveNext;
      // Before any await: the Google window must open inside the tap.
      const login = auth.connect({ silent });
      return (async () => {
        try {
          await login;
          interactiveNext = false;
          const email = await api.accountEmail();
          if (email) {
            auth.setAccount(email);
            await bindAccount(factory, email);
          }
          error = null;
        } catch (caught) {
          if (caught instanceof DriveAuthError && caught.needsInteractiveLogin) interactiveNext = true;
          error = describeDriveError(caught);
          return status();
        }
        await run();
        return status();
      })();
    },

    async disconnect() {
      epoch += 1;
      cancelTimer();
      pending = false;
      waitingForRun = false;
      syncing = false;
      await auth.disconnect();
      lastSyncAt = null;
      error = null;
      interactiveNext = false;
      return status();
    },

    runEnded() {
      if (!waitingForRun) return;
      waitingForRun = false;
      void run();
    },

    start(target = { window, document }) {
      const onVisible = () => {
        if (target.document.visibilityState === 'visible') void run();
      };
      const onOnline = () => void run();
      target.document.addEventListener('visibilitychange', onVisible);
      target.window.addEventListener('online', onOnline);
      void readMeta(factory).then(meta => {
        lastSyncAt ??= meta.last_sync_at ?? null;
      }, () => {});
      void run();
      return () => {
        target.document.removeEventListener('visibilitychange', onVisible);
        target.window.removeEventListener('online', onOnline);
        cancelTimer();
      };
    },
  };
}

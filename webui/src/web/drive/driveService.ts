import type { DriveExportResult, DriveStatus } from '../../bridge';
import type { WebArchive } from '../webSessions';
import { DriveAuthError, type DriveAuth } from './auth';
import { DriveError, type DriveApi } from './driveApi';
import { ExportError, exportToDrive } from './exportDrive';
import { syncOnce, type SyncReport } from './sync';
import { bindAccount, readMeta, resetSyncState } from './syncState';

// When the Drive sync runs: at startup, when the page comes back to the foreground or online, and a
// few seconds after the last local change; never while a Gemini run works (the round waits for
// runEnded). Each round asks the site's server for a fresh token (auth.ts): the login lasts until
// "Disconnetti". Only when the server has lost it (revoked from the Google account, six months
// unused) nothing runs, and the settings show "tocca per riconnettere".
// Rounds, binding the account of a new login and erasing the Drive data run one at a time, in the
// order asked: none of them ever sees another halfway. One tab of the site runs at a time
// (activeTab.ts), so this queue is the only one.

export const SYNC_DELAY_MS = 4000;
export const DISCONNECT_PENDING_MESSAGE = 'Disconnessione da completare: verrà ritentata appena possibile.';

export interface DriveServiceOptions {
  factory: IDBFactory | undefined;
  auth: DriveAuth;
  api: DriveApi;
  /** A Gemini run is active: the round waits for runEnded(). */
  isBusy: () => boolean;
  /** The editor has this sbobina open: a remote change waits. */
  isOpenInEditor?: (sessionDir: string) => boolean | Promise<boolean>;
  onReport?: (report: SyncReport) => void;
  /** A round found the login expired (401). */
  onNeedsReconnect?: () => void;
  delayMs?: number;
  now?: () => Date;
  /** The archive the export reads (the sbobine out of the trash). */
  archive?: () => WebArchive;
  /** A REST client on the export's own token (drive.file). */
  exportApi?: (token: string) => DriveApi;
}

export interface DriveService {
  status(): DriveStatus;
  /** A local change: a round follows after a short quiet period. */
  schedule(): void;
  /** A round now, or right after the operation in progress; resolves when done. */
  syncNow(): Promise<DriveStatus>;
  /** Opens the Google window synchronously: call it inside a tap. */
  connect(): Promise<DriveStatus>;
  disconnect(): Promise<DriveStatus>;
  /** "Elimina tutti i miei dati da Drive": every file of the hidden folder, the local sync state, then disconnects. */
  erase(): Promise<DriveStatus & { removed: number }>;
  /** "Esporta tutte le sbobine nel mio Drive": opens the Google window synchronously (call it inside a tap). */
  exportAll(onProgress?: (done: number, total: number) => void): Promise<DriveExportResult>;
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
  let timer: ReturnType<typeof setTimeout> | null = null;
  // A round asked for during a Gemini run: it runs at runEnded().
  let waitingForRun = false;
  // "Disconnetti" during a round: whatever that round ends with no longer concerns the status.
  let epoch = 0;

  // The operations, one at a time in the order asked.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = tail.then(operation);
    tail = result.catch(() => undefined);
    return result;
  };

  const status = (): DriveStatus => {
    const email = auth.account();
    const token = auth.token();
    return {
      available: true,
      connected: Boolean(email || token),
      email,
      needs_reconnect: Boolean(email) && auth.needsReconnect(),
      syncing,
      waiting_for_run: waitingForRun,
      last_sync_at: lastSyncAt,
      // A "Disconnetti" the server has not confirmed: the settings must not just say "disconnected".
      error: error ?? (auth.disconnectPending() ? DISCONNECT_PENDING_MESSAGE : null),
    };
  };

  // The token must be the one of the account this browser remembers and the database is bound to:
  // the server's login may be another account's (a link whose binding failed), or the browser may
  // have left this account since (any tab clears the remembered account then). Checked inside the
  // queue, where no binding runs at the same time.
  const ownsToken = async () => {
    const bound = (await readMeta(factory)).account;
    const owner = auth.tokenAccount();
    const remembered = auth.account();
    // Never bound (a state older than the binding, or just erased): the remembered account decides.
    if (owner !== null && owner === remembered && (bound === undefined || bound === owner)) return true;
    // After "Disconnetti" or the erase nothing is to reconnect; otherwise only a new link helps.
    auth.expire(remembered !== null);
    if (remembered !== null) options.onNeedsReconnect?.();
    return false;
  };

  const round = async () => {
    // A "Disconnetti" the server never confirmed goes first: every round runs at startup, back
    // online and in the foreground, and none uses the cookie's login while it is pending (auth.ts).
    if (auth.disconnectPending()) await auth.finishDisconnect();
    // Never linked, disconnected, or a lost login waiting for "Riconnetti": nothing to do.
    if (auth.needsReconnect() || (!auth.account() && !auth.token())) return;
    if (options.isBusy()) {
      waitingForRun = true;
      return;
    }
    const started = epoch;
    syncing = true;
    try {
      // Renewed here, when the round really starts: after a long elaborazione the hour may be over.
      if (!await auth.freshToken()) {
        if (started === epoch && auth.needsReconnect()) options.onNeedsReconnect?.();
        return;
      }
      if (!await ownsToken()) return;
      const report = await syncOnce({ factory, api, now, isOpenInEditor: options.isOpenInEditor });
      if (started !== epoch) return;
      lastSyncAt = report.syncedAt;
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

  // Asked for while one waits in the queue: that one serves both.
  let queuedRound: Promise<void> | null = null;
  const run = (): Promise<void> => {
    queuedRound ??= enqueue(() => {
      queuedRound = null;
      return round();
    });
    return queuedRound;
  };

  const cancelTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  async function disconnect(): Promise<DriveStatus> {
    epoch += 1;
    cancelTimer();
    waitingForRun = false;
    syncing = false;
    await auth.disconnect();
    lastSyncAt = null;
    error = null;
    return status();
  }

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
      // Before any await: the login window must open inside the tap. The token is installed only
      // once its account is bound: a round with it would sync this browser's state for the previous
      // account with another account's Drive.
      const login = auth.connect();
      return (async () => {
        try {
          const token = await login;
          await enqueue(async () => {
            auth.adopt(token);
            try {
              const email = await api.accountEmail();
              if (!email) throw new Error('Google Drive non ha indicato l’account collegato.');
              await bindAccount(factory, email);
              auth.setAccount(email);
            } catch (caught) {
              // The remembered account (if any) stays for the next tap.
              auth.expire();
              throw caught;
            }
          });
          error = null;
        } catch (caught) {
          error = describeDriveError(caught);
          return status();
        }
        await run();
        return status();
      })();
    },

    disconnect,

    async erase() {
      let token: string | null;
      try {
        token = await auth.freshToken();
      } catch (caught) {
        // Offline or the login service failing: the login itself is fine, so no "riconnetti".
        error = describeDriveError(caught);
        return { ...status(), removed: 0 };
      }
      if (!token) {
        error = describeDriveError(new DriveError(401, ''));
        return { ...status(), removed: 0 };
      }
      cancelTimer();
      let removed = 0;
      try {
        // Disconnected inside the queue: a round asked for meanwhile finds no token and sends nothing
        // back to the emptied Drive.
        const disconnected = await enqueue(async () => {
          // With another account's token it would empty that account's Drive.
          if (!await ownsToken()) return null;
          for (const file of await api.listChanged(null)) {
            await api.remove(file.id).catch((caught: { status?: number }) => {
              if (caught.status !== 404) throw caught;
            });
            removed += 1;
          }
          await resetSyncState(factory);
          return disconnect();
        });
        if (!disconnected) {
          error = describeDriveError(new DriveError(401, ''));
          return { ...status(), removed: 0 };
        }
        return { ...disconnected, removed };
      } catch (caught) {
        error = describeDriveError(caught);
        if (caught instanceof DriveError && caught.needsAuthorization) options.onNeedsReconnect?.();
        return { ...status(), removed };
      }
    },

    exportAll(onProgress) {
      // Before any await: the Google window must open inside the tap. The token stays with the export.
      const login = auth.connectExport();
      return (async (): Promise<DriveExportResult> => {
        let token: string;
        try {
          token = (await login).accessToken;
        } catch (caught) {
          return { ok: false, exported: 0, total: 0, error: describeDriveError(caught) };
        }
        if (!options.archive || !options.exportApi) return { ok: false, exported: 0, total: 0, error: 'Esportazione non disponibile.' };
        try {
          const outcome = await exportToDrive({
            archive: options.archive(),
            api: options.exportApi(token),
            now: now(),
            onProgress: progress => onProgress?.(progress.done, progress.total),
          });
          return { ok: true, exported: outcome.exported, total: outcome.total, folder_name: outcome.folderName, folder_url: outcome.folderUrl };
        } catch (caught) {
          const partial = caught instanceof ExportError ? caught.outcome : null;
          return {
            ok: false,
            exported: partial?.exported ?? 0,
            total: partial?.total ?? 0,
            ...(partial?.exported ? { folder_name: partial.folderName, folder_url: partial.folderUrl } : {}),
            error: describeDriveError(caught instanceof ExportError ? caught.reason : caught),
          };
        }
      })();
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

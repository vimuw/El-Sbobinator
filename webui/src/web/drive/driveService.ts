import type { DriveExportResult, DriveStatus } from '../../bridge';
import type { WebArchive } from '../webSessions';
import { DriveAuthError, type DriveAuth } from './auth';
import { DriveError, type DriveApi } from './driveApi';
import { ExportError, exportToDrive } from './exportDrive';
import { DRIVE_FILE_SCOPE } from './oauth';
import { syncOnce, type SyncReport } from './sync';
import { bindAccount, readMeta, resetSyncState } from './syncState';

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
  /** The archive the export reads (the sbobine out of the trash). */
  archive?: () => WebArchive;
  /** A REST client on the export's own token (drive.file). */
  exportApi?: (token: string) => DriveApi;
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
  // After a silent attempt Google refused, the next tap opens the full account choice.
  let interactiveNext = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let loop: Promise<void> | null = null;
  let pending = false;
  let waitingForRun = false;
  // "Disconnetti" during a round: whatever that round ends with no longer concerns the status.
  let epoch = 0;
  // While the Drive folder is being emptied no round may write to it.
  let erasing = false;

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
    if (!auth.token() || erasing) return;
    const started = epoch;
    syncing = true;
    try {
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

  async function disconnect(): Promise<DriveStatus> {
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

    disconnect,

    async erase() {
      if (!auth.token()) {
        error = describeDriveError(new DriveError(401, ''));
        return { ...status(), removed: 0 };
      }
      erasing = true;
      cancelTimer();
      let removed = 0;
      try {
        // A round already writing finishes first: nothing it sends can be left behind.
        await loop;
        for (const file of await api.listChanged(null)) {
          await api.remove(file.id).catch((caught: { status?: number }) => {
            if (caught.status !== 404) throw caught;
          });
          removed += 1;
        }
        await resetSyncState(factory);
      } catch (caught) {
        error = describeDriveError(caught);
        if (caught instanceof DriveError && caught.needsAuthorization) options.onNeedsReconnect?.();
        return { ...status(), removed };
      } finally {
        erasing = false;
      }
      return { ...await disconnect(), removed };
    },

    exportAll(onProgress) {
      // Before any await: the Google window must open inside the tap. The token stays with the export.
      const login = auth.connect({ scope: DRIVE_FILE_SCOPE, keep: false });
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

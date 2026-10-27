import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';

// The web build's IndexedDB database: pipeline checkpoints (v1), the archive (v2): session
// metadata, the editor document of each sbobina and the archive folders, and the audio files (v3).
export const WEB_DB_NAME = 'el-sbobinator-web';
export const WEB_DB_VERSION = 3;
export const CHECKPOINTS = 'checkpoints';
export const CHECKPOINTS_BY_FILE = 'byFile';
export const SESSIONS = 'sessions';
export const DOCUMENTS = 'documents';
export const FOLDERS = 'folders';
export const MEDIA = 'media';
export const MEDIA_BY_SESSION = 'bySession';
// The spike (served at el-sbobinator-web.pages.dev) had a database with this same name at version
// 1 with a single `sessions` store of its own: renamed out of the way, never deleted.
export const SPIKE_SESSIONS = 'spike-sessions';

/** Editor document of one sbobina: the HTML body and the last autosave generation. */
export interface StoredDocument {
  session_dir: string;
  body: string;
  generation: number;
}

type LegacyArchive = { sessions?: Array<{ session: ArchiveSession; body: string; generation?: number }>; folders?: ArchiveFolder[] };

// Previews before M2 kept the archive in localStorage: it is copied once, inside the upgrade.
function migrateLegacyArchive(transaction: IDBTransaction): boolean {
  let legacy: LegacyArchive | null;
  try {
    legacy = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1) || 'null') as LegacyArchive | null;
  } catch {
    return false;
  }
  if (!legacy) return false;
  const sessions = transaction.objectStore(SESSIONS);
  const documents = transaction.objectStore(DOCUMENTS);
  for (const entry of Array.isArray(legacy.sessions) ? legacy.sessions : []) {
    if (!entry?.session?.session_dir) continue;
    sessions.put(entry.session);
    documents.put({ session_dir: entry.session.session_dir, body: entry.body ?? '', generation: entry.generation ?? 0 } satisfies StoredDocument);
  }
  const folders = transaction.objectStore(FOLDERS);
  for (const folder of Array.isArray(legacy.folders) ? legacy.folders : []) {
    if (folder?.id) folders.put(folder);
  }
  return true;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WEB_DB_NAME, WEB_DB_VERSION);
    let migrated = false;
    request.onupgradeneeded = event => {
      const db = request.result;
      const transaction = request.transaction!;
      const spike = event.oldVersion >= 1 && !db.objectStoreNames.contains(CHECKPOINTS);
      if (spike && db.objectStoreNames.contains(SESSIONS)) transaction.objectStore(SESSIONS).name = SPIKE_SESSIONS;
      if (event.oldVersion < 1 || spike) {
        db.createObjectStore(CHECKPOINTS, { keyPath: 'id' }).createIndex(CHECKPOINTS_BY_FILE, 'fileKey');
      }
      if (event.oldVersion < 2) {
        db.createObjectStore(SESSIONS, { keyPath: 'session_dir' });
        db.createObjectStore(DOCUMENTS, { keyPath: 'session_dir' });
        db.createObjectStore(FOLDERS, { keyPath: 'id' });
        migrated = migrateLegacyArchive(transaction);
      }
      if (event.oldVersion < 3) {
        db.createObjectStore(MEDIA, { keyPath: 'id' }).createIndex(MEDIA_BY_SESSION, 'sessionDir');
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (migrated) {
        try {
          window.localStorage.removeItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1);
        } catch {
          // Already in IndexedDB; the old copy is never read again.
        }
      }
      // A newer version opened in another tab: let it upgrade, this page reopens on its next request.
      db.onversionchange = () => {
        db.close();
        databases.delete(factory);
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Archivio bloccato da un’altra scheda di El Sbobinator: chiudila e ricarica la pagina.'));
  });
}

// One connection per factory, shared by the checkpoint store and the archive.
const databases = new Map<IDBFactory, Promise<IDBDatabase>>();

export function openWebDatabase(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(new Error('questo browser non permette di salvare dati (navigazione privata?)'));
  let database = databases.get(factory);
  if (!database) {
    database = openDatabase(factory);
    database.catch(() => databases.delete(factory));
    databases.set(factory, database);
  }
  return database;
}

/**
 * Runs body in one transaction and resolves with its result once the transaction commits, so what
 * was written is really on disk.
 */
export async function inTransaction<T>(
  factory: IDBFactory | undefined,
  stores: string | string[],
  mode: IDBTransactionMode,
  body: (transaction: IDBTransaction) => T | Promise<T>,
): Promise<T> {
  const db = await openWebDatabase(factory);
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let result: T;
    let failed: unknown = null;
    transaction.oncomplete = () => (failed === null ? resolve(result) : reject(failed));
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(failed ?? transaction.error ?? new Error('Salvataggio annullato dal browser.'));
    Promise.resolve(body(transaction)).then(
      value => { result = value; },
      error => {
        failed = error;
        try { transaction.abort(); } catch { /* already finished */ }
      },
    );
  });
}

/** Promise for one request inside an open transaction. */
export function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Bytes this app keeps in IndexedDB, counted from the records (Safari's estimate() misses Blobs). */
export interface WebStorageUsage {
  /** Lectures linked to a sbobina: what a backup with audio includes. */
  audio: number;
  /** Copies of picked files not (yet) linked to a sbobina: they go once they leave the queue. */
  queueAudio: number;
  /** Sbobine (metadata + editor document) and folders, counted like the backup's manifest. */
  documents: number;
  /** Pipeline checkpoints (progress of runs, finished or not). */
  checkpoints: number;
  total: number;
}

const encoder = new TextEncoder();
function jsonBytes(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value) ?? '').length;
  } catch {
    return 0;
  }
}

export async function measureWebStorage(factory: IDBFactory | undefined): Promise<WebStorageUsage> {
  return inTransaction(factory, [MEDIA, DOCUMENTS, SESSIONS, FOLDERS, CHECKPOINTS], 'readonly', async transaction => {
    const all = (store: string) => requestValue(transaction.objectStore(store).getAll() as IDBRequest<unknown[]>);
    const [media, documents, sessions, folders, checkpoints] = await Promise.all([all(MEDIA), all(DOCUMENTS), all(SESSIONS), all(FOLDERS), all(CHECKPOINTS)]);
    const sessionDirs = new Set(sessions.map(session => (session as ArchiveSession).session_dir));
    let audio = 0;
    let queueAudio = 0;
    for (const record of media) {
      const { blob, size, sessionDir } = record as { blob?: Blob; size?: number; sessionDir?: string };
      const bytes = blob?.size ?? size ?? 0;
      if (sessionDir && sessionDirs.has(sessionDir)) audio += bytes;
      else queueAudio += bytes;
    }
    // Same shape as the backup's sessions and folders, so the two figures agree.
    const bodies = new Map((documents as StoredDocument[]).map(document => [document.session_dir, document]));
    const text = (sessions as ArchiveSession[]).reduce<number>((sum, session) => {
      const document = bodies.get(session.session_dir);
      return sum + jsonBytes({ session, body: document?.body ?? '', generation: document?.generation ?? 0 });
    }, 0) + folders.reduce<number>((sum, folder) => sum + jsonBytes(folder), 0);
    const progress = checkpoints.reduce<number>((sum, record) => sum + jsonBytes(record), 0);
    return { audio, queueAudio, documents: text, checkpoints: progress, total: audio + queueAudio + text + progress };
  });
}

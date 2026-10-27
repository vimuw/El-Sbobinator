import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { SYNC, inTransaction, requestValue } from '../webDatabase';
import type { SaveHtmlResult, WebArchive } from '../webSessions';

// Local state of the Drive sync, in the IndexedDB store `sync`: one record per sbobina (its Drive
// file, the Drive modifiedTime last synced, whether it has local changes to send) and one `meta`
// record (this device's id, the listing watermark, the folder tree's state).

export const META_KEY = 'meta';
const sessionKey = (sessionDir: string) => `session:${sessionDir}`;

export interface SessionSyncRecord {
  key: string;
  session_dir: string;
  file_id?: string;
  /** Drive modifiedTime of the file as last downloaded or uploaded. */
  remote_modified?: string;
  /** Local changes not on Drive yet. */
  dirty: boolean;
  /** When the sbobina last changed here (or, once synced, on the device that wrote it). */
  updated_at: string;
  deleted_at?: string;
}

export interface FoldersSyncState {
  file_id?: string;
  remote_modified?: string;
  dirty: boolean;
  /** Last change of each folder, by id. */
  times: Record<string, string>;
  /** Removed folders, by id. */
  deleted: Record<string, string>;
}

export interface DeferredFile {
  id: string;
  name: string;
  modifiedTime: string;
}

export interface SyncMeta {
  key: typeof META_KEY;
  device_id: string;
  /** Latest Drive modifiedTime listed: the next list asks only for files changed after it. */
  watermark?: string;
  last_sync_at?: string;
  folders: FoldersSyncState;
  /** Changed on Drive while open in the editor here: applied once the editor closes. */
  deferred: DeferredFile[];
}

function newMeta(): SyncMeta {
  return { key: META_KEY, device_id: crypto.randomUUID(), folders: { dirty: false, times: {}, deleted: {} }, deferred: [] };
}

export async function readMeta(factory: IDBFactory | undefined): Promise<SyncMeta> {
  return inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
    if (meta) return meta;
    const created = newMeta();
    store.put(created);
    return created;
  });
}

export async function writeMeta(factory: IDBFactory | undefined, update: (meta: SyncMeta) => SyncMeta): Promise<SyncMeta> {
  return inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const next = update((await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>)) ?? newMeta());
    store.put(next);
    return next;
  });
}

export async function readRecords(factory: IDBFactory | undefined): Promise<Map<string, SessionSyncRecord>> {
  const all = await inTransaction(factory, SYNC, 'readonly', transaction =>
    requestValue(transaction.objectStore(SYNC).getAll() as IDBRequest<Array<SessionSyncRecord | SyncMeta>>));
  const records = new Map<string, SessionSyncRecord>();
  for (const record of all) if (record.key !== META_KEY) records.set((record as SessionSyncRecord).session_dir, record as SessionSyncRecord);
  return records;
}

export async function readRecord(factory: IDBFactory | undefined, sessionDir: string): Promise<SessionSyncRecord | null> {
  return (await inTransaction(factory, SYNC, 'readonly', transaction =>
    requestValue(transaction.objectStore(SYNC).get(sessionKey(sessionDir)) as IDBRequest<SessionSyncRecord | undefined>))) ?? null;
}

export async function writeRecord(factory: IDBFactory | undefined, record: Omit<SessionSyncRecord, 'key'>): Promise<void> {
  await inTransaction(factory, SYNC, 'readwrite', transaction => {
    transaction.objectStore(SYNC).put({ ...record, key: sessionKey(record.session_dir) });
  });
}

/**
 * Updates a record only if it still is the one read before a slow step (an upload): a change made
 * meanwhile keeps its mark and goes in the next round.
 */
export async function writeRecordIfUnchanged(factory: IDBFactory | undefined, before: SessionSyncRecord | null, next: Omit<SessionSyncRecord, 'key'>): Promise<boolean> {
  return inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const current = await requestValue(store.get(sessionKey(next.session_dir)) as IDBRequest<SessionSyncRecord | undefined>);
    if ((current?.updated_at ?? null) !== (before?.updated_at ?? null) || (current?.dirty ?? null) !== (before?.dirty ?? null)) return false;
    store.put({ ...next, key: sessionKey(next.session_dir) });
    return true;
  });
}

/** A local change to send: the mark the archive leaves after each write. */
export async function markSessionChanged(factory: IDBFactory | undefined, sessionDir: string, at: string, deleted = false): Promise<void> {
  await inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const current = await requestValue(store.get(sessionKey(sessionDir)) as IDBRequest<SessionSyncRecord | undefined>);
    // Never synced and deleted: nothing to tell Drive.
    if (deleted && !current?.file_id) {
      store.delete(sessionKey(sessionDir));
      return;
    }
    // A later mark always differs from the one an upload in flight read.
    const updatedAt = current && at <= current.updated_at ? new Date(Date.parse(current.updated_at) + 1).toISOString() : at;
    const record: SessionSyncRecord = { ...current, key: sessionKey(sessionDir), session_dir: sessionDir, dirty: true, updated_at: updatedAt };
    if (deleted) record.deleted_at = updatedAt;
    else delete record.deleted_at;
    store.put(record);
  });
}

/** Records which folders changed between two trees the UI saved. */
export async function markFoldersChanged(factory: IDBFactory | undefined, before: ArchiveFolder[], after: ArchiveFolder[], at: string): Promise<void> {
  const previous = new Map(before.map(folder => [folder.id, JSON.stringify(folder)]));
  const next = new Set(after.map(folder => folder.id));
  await writeMeta(factory, meta => {
    const times = { ...meta.folders.times };
    const deleted = { ...meta.folders.deleted };
    let changed = false;
    for (const folder of after) {
      if (previous.get(folder.id) === JSON.stringify(folder)) continue;
      times[folder.id] = at;
      delete deleted[folder.id];
      changed = true;
    }
    for (const id of previous.keys()) {
      if (next.has(id)) continue;
      deleted[id] = at;
      delete times[id];
      changed = true;
    }
    return changed ? { ...meta, folders: { ...meta.folders, times, deleted, dirty: true } } : meta;
  });
}

// Changes that are only about this device never go to Drive.
const LOCAL_ONLY_FIELDS = new Set<keyof ArchiveSession>(['input_path', 'last_opened_at_iso']);

/**
 * The archive with sync marks: every write the user makes (editor saves, renames, deletions,
 * folders, a finished run) leaves a mark and calls onChange, so the sync sends it soon. The sync
 * engine itself writes to IndexedDB directly and leaves no marks.
 */
export function trackArchive(archive: WebArchive, factory: IDBFactory | undefined, onChange: () => void, now: () => Date = () => new Date()): WebArchive {
  const mark = async (sessionDir: string, deleted = false) => {
    await markSessionChanged(factory, sessionDir, now().toISOString(), deleted).catch(() => undefined);
    onChange();
  };
  return {
    ...archive,
    async create(input, body) {
      const session = await archive.create(input, body);
      await mark(session.session_dir);
      return session;
    },
    async saveHtml(path, body, generation): Promise<SaveHtmlResult> {
      const result = await archive.saveHtml(path, body, generation);
      if (result.ok && result.saved) await mark(path.replace(/\/sbobina\.html$/, ''));
      return result;
    },
    async update(sessionDir, patch) {
      const session = await archive.update(sessionDir, patch);
      if (session && Object.keys(patch).some(field => !LOCAL_ONLY_FIELDS.has(field as keyof ArchiveSession))) await mark(session.session_dir);
      return session;
    },
    async delete(sessionDir) {
      const deleted = await archive.delete(sessionDir);
      if (deleted) await mark(sessionDir.replace(/\/sbobina\.html$/, ''), true);
      return deleted;
    },
    async saveFolders(folders) {
      const before = await archive.loadFolders().catch(() => [] as ArchiveFolder[]);
      await archive.saveFolders(folders);
      await markFoldersChanged(factory, before, folders, now().toISOString()).catch(() => undefined);
      onChange();
    },
  };
}

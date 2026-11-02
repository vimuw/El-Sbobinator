import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { FOLDERS, SYNC, inTransaction, requestValue } from '../webDatabase';
import type { SaveHtmlResult, WebArchive } from '../webSessions';

// Local state of the Drive sync, in the IndexedDB store `sync`: one record per sbobina (its Drive
// file, the Drive modifiedTime last synced, whether it has local changes to send) and one `meta`
// record (this device's id, the listing watermark, the folder tree's state).

export const META_KEY = 'meta';
export const sessionKey = (sessionDir: string) => `session:${sessionDir}`;

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
  /** Deleted for good here (out of the trash): Drive keeps only a mark without text. */
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
  /** Google account this state belongs to: another account starts from scratch. */
  account?: string;
  /**
   * The Drive data was erased from this browser: no round runs until an account is bound again.
   * Read by the other tabs inside the lock, unlike the remembered account, which reaches them late.
   */
  erased?: boolean;
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

/**
 * Binds the sync state to the account just connected. Another account's Drive has none of the files
 * recorded here: records and watermark go, so the next round sends every sbobina to the new Drive.
 * Returns whether the state was reset.
 */
export async function bindAccount(factory: IDBFactory | undefined, account: string): Promise<boolean> {
  return inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
    // First account of this state: whatever it holds was synced with it.
    if (meta?.account === undefined) {
      const { erased: _erased, ...kept } = meta ?? newMeta();
      store.put({ ...kept, account });
      return false;
    }
    if (meta.account === account) return false;
    store.clear();
    store.put({ ...newMeta(), device_id: meta.device_id, account });
    return true;
  });
}

/** "Elimina tutti i miei dati da Drive": this browser forgets every sync record (its id stays). */
export async function resetSyncState(factory: IDBFactory | undefined): Promise<void> {
  await inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
    store.clear();
    store.put({ ...newMeta(), device_id: meta?.device_id ?? crypto.randomUUID(), erased: true });
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

/** Whether a record still carries the mark read earlier: no local write came in between. */
export function sameMark(current: SessionSyncRecord | null | undefined, before: SessionSyncRecord | null | undefined): boolean {
  return (current?.updated_at ?? null) === (before?.updated_at ?? null) && (current?.dirty ?? null) === (before?.dirty ?? null);
}

/**
 * Updates a record only if it still is the one read before a slow step (an upload): a change made
 * meanwhile keeps its mark and goes in the next round.
 */
export async function writeRecordIfUnchanged(factory: IDBFactory | undefined, before: SessionSyncRecord | null, next: Omit<SessionSyncRecord, 'key'>): Promise<boolean> {
  return inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const current = await requestValue(store.get(sessionKey(next.session_dir)) as IDBRequest<SessionSyncRecord | undefined>);
    if (!sameMark(current, before)) return false;
    store.put({ ...next, key: sessionKey(next.session_dir) });
    return true;
  });
}

/**
 * After an upload the record learns the Drive file just written: unchanged meanwhile it is synced;
 * a local write made during the upload keeps its mark for the next round, which then does not take
 * this device's own upload for a change from Drive. Nothing is written after an account switch
 * (`account` is the one the round started with) or once another file took the record's place.
 * A first upload during which the sbobina was deleted for good (its record went: it had no file yet)
 * left its text on Drive: the record comes back as a deletion, and the next round sends the mark.
 */
export async function recordUpload(factory: IDBFactory | undefined, before: SessionSyncRecord, written: { id: string; modifiedTime: string }, account: string | undefined): Promise<void> {
  await recordDriveFile(factory, before, written, account, true);
}

/**
 * A conflict this side won: the record learns Drive's file, which this round's upload overwrites,
 * and keeps its mark. As after an upload, a local write made during the merge keeps its own mark
 * (a deletion for good included), and nothing is written after an account switch.
 */
export async function recordLocalWin(factory: IDBFactory | undefined, before: SessionSyncRecord, remote: { id: string; modifiedTime: string }, account: string | undefined): Promise<void> {
  await recordDriveFile(factory, before, remote, account, false);
}

async function recordDriveFile(factory: IDBFactory | undefined, before: SessionSyncRecord, written: { id: string; modifiedTime: string }, account: string | undefined, sent: boolean): Promise<void> {
  await inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const [meta, current] = await Promise.all([
      requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>),
      requestValue(store.get(sessionKey(before.session_dir)) as IDBRequest<SessionSyncRecord | undefined>),
    ]);
    if (account !== undefined && meta?.account !== account) return;
    const file = { file_id: written.id, remote_modified: written.modifiedTime };
    if (!current) {
      if (before.file_id) return;
      // Later than the text just written, so it wins on the devices that download that first.
      const at = new Date(Date.parse(before.updated_at) + 1).toISOString();
      store.put({ key: sessionKey(before.session_dir), session_dir: before.session_dir, ...file, dirty: true, updated_at: at, deleted_at: at } satisfies SessionSyncRecord);
      return;
    }
    if (sameMark(current, before)) store.put({ ...before, ...file, dirty: sent ? false : before.dirty, key: sessionKey(before.session_dir) });
    else if (current.file_id === before.file_id) store.put({ ...current, ...file });
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

/** The sync state with the folders that changed between two trees marked. */
function withFolderChanges(meta: SyncMeta, before: ArchiveFolder[], after: ArchiveFolder[], at: string): SyncMeta {
  const previous = new Map(before.map(folder => [folder.id, JSON.stringify(folder)]));
  const next = new Set(after.map(folder => folder.id));
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
}

/** Records which folders changed between two trees the UI saved. */
export async function markFoldersChanged(factory: IDBFactory | undefined, before: ArchiveFolder[], after: ArchiveFolder[], at: string): Promise<void> {
  await writeMeta(factory, meta => withFolderChanges(meta, before, after, at));
}

/**
 * Saves the folder tree the UI sends together with its marks, in one transaction: a round that
 * reads the tree never sees a change without the time it was made, which it would take for an old
 * one and let Drive's version overwrite.
 */
export async function saveFoldersMarked(factory: IDBFactory | undefined, folders: ArchiveFolder[], at: string): Promise<void> {
  await inTransaction(factory, [FOLDERS, SYNC], 'readwrite', async transaction => {
    const tree = transaction.objectStore(FOLDERS);
    const sync = transaction.objectStore(SYNC);
    const [before, meta] = await Promise.all([
      requestValue(tree.getAll() as IDBRequest<ArchiveFolder[]>),
      requestValue(sync.get(META_KEY) as IDBRequest<SyncMeta | undefined>),
    ]);
    tree.clear();
    for (const folder of folders) tree.put(folder);
    sync.put(withFolderChanges(meta ?? newMeta(), before, folders, at));
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
  const mark = async (sessionDir: string, deleted = false, at = now().toISOString()) => {
    await markSessionChanged(factory, sessionDir, at, deleted).catch(() => undefined);
    onChange();
  };
  return {
    ...archive,
    async create(input, body) {
      const session = await archive.create(input, body);
      await mark(session.session_dir);
      return session;
    },
    async saveHtml(path, body, generation, accept): Promise<SaveHtmlResult> {
      const result = await archive.saveHtml(path, body, generation, accept);
      if (result.ok && result.saved) await mark(path.replace(/\/sbobina\.html$/, ''));
      return result;
    },
    async update(sessionDir, patch) {
      const session = await archive.update(sessionDir, patch);
      if (session && Object.keys(patch).some(field => !LOCAL_ONLY_FIELDS.has(field as keyof ArchiveSession))) await mark(session.session_dir);
      return session;
    },
    // An expiry of the trash is dated when the sbobina went there (markSessionChanged keeps it
    // after the last change known here).
    async delete(sessionDir, changedAt) {
      const deleted = await archive.delete(sessionDir, changedAt);
      if (deleted) await mark(sessionDir.replace(/\/sbobina\.html$/, ''), true, changedAt);
      return deleted;
    },
    // Trash and restore travel as the file's deleted_at: the other devices follow.
    async trash(sessionDir, at) {
      const trashed = await archive.trash(sessionDir, at);
      if (trashed) await mark(sessionDir.replace(/\/sbobina\.html$/, ''));
      return trashed;
    },
    async restore(sessionDir) {
      const session = await archive.restore(sessionDir);
      if (session) await mark(session.session_dir);
      return session;
    },
    // Written here with its marks, not through archive.saveFolders (the same store): see saveFoldersMarked.
    async saveFolders(folders) {
      await saveFoldersMarked(factory, folders, now().toISOString());
      onChange();
    },
  };
}

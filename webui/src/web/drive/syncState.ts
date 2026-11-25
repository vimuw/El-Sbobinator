import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { SESSIONS, SYNC, inTransaction, requestValue } from '../webDatabase';
import { createWebArchive, type ArchiveMarks, type SaveHtmlResult, type WebArchive } from '../webSessions';

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
  /** Changed after "Disconnetti": a deletion or a trashing made then stays here (rejoin). */
  while_disconnected?: boolean;
  /** Edited after "Disconnetti" (text, name, metadata), not only trashed: rejoin keeps the edit. */
  edited_while_disconnected?: boolean;
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
  /** When "Disconnetti" was pressed; cleared by the next connection (rejoin). */
  disconnected_at?: string;
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
 * "Disconnetti": from now on this browser is out of the sync. Its changes are still marked, the
 * ones made after this as made while disconnected, and the state stays for the same account.
 */
export async function markDisconnected(factory: IDBFactory | undefined, at: string): Promise<void> {
  await writeMeta(factory, meta => ({ ...meta, disconnected_at: meta.disconnected_at ?? at }));
}

/**
 * Back in the sync after "Disconnetti", as an unlinked Dropbox or OneDrive folder linked again:
 * Drive and this browser are joined, and a deletion made while disconnected deletes nothing on
 * Drive. A sbobina deleted for good meanwhile forgets its Drive file, trashed meanwhile it takes
 * Drive's version again, and the next round lists Drive from scratch to bring those files back.
 * One edited and then trashed meanwhile comes out of the trash here instead, with its edit, which
 * goes up (or, if Drive changed too, makes a conflict copy). The other changes made meanwhile
 * (edits, renames, new sbobine, restores) go up as usual. A change still unsent at "Disconnetti",
 * made while in the sync, still goes to Drive with every change after it (markSession).
 * Returns the state to store and how many sbobine came out of the trash.
 */
async function rejoin(transaction: IDBTransaction, meta: SyncMeta): Promise<{ meta: SyncMeta; restored: number }> {
  const store = transaction.objectStore(SYNC);
  const sessionStore = transaction.objectStore(SESSIONS);
  const [entries, sessions] = await Promise.all([
    requestValue(store.getAll() as IDBRequest<Array<SessionSyncRecord | SyncMeta>>),
    requestValue(sessionStore.getAll() as IDBRequest<ArchiveSession[]>),
  ]);
  const byDir = new Map(sessions.map(session => [session.session_dir, session]));
  const since = meta.disconnected_at ?? '';
  let restored = 0;
  for (const entry of entries) {
    if (entry.key === META_KEY || !(entry as SessionSyncRecord).while_disconnected) continue;
    const { while_disconnected: _flag, edited_while_disconnected: edited, ...record } = entry as SessionSyncRecord;
    const session = byDir.get(record.session_dir);
    if (record.file_id && record.deleted_at) store.delete(record.key);
    else if (record.file_id && session?.trashed_at && session.trashed_at >= since) {
      if (edited) {
        // The record keeps its mark and the Drive version it last saw: the edit is never taken for older.
        const { trashed_at: _trashed, ...live } = session;
        sessionStore.put(live satisfies ArchiveSession);
        store.put(record satisfies SessionSyncRecord);
        restored += 1;
      } else {
        const { remote_modified: _seen, ...unseen } = record;
        store.put({ ...unseen, dirty: false } satisfies SessionSyncRecord);
      }
    } else store.put(record satisfies SessionSyncRecord);
  }
  const { disconnected_at: _at, watermark: _watermark, ...next } = meta;
  return { meta: next, restored };
}

/**
 * Binds the sync state to the account just connected. Another account's Drive has none of the files
 * recorded here: records and watermark go, so the next round sends every sbobina to the new Drive.
 * The same account after "Disconnetti" rejoins (above). Returns whether the state was reset, and
 * how many sbobine the rejoin took out of the trash (the archive shown must be read again).
 */
export async function bindAccount(factory: IDBFactory | undefined, account: string): Promise<{ reset: boolean; restored: number }> {
  return inTransaction(factory, [SESSIONS, SYNC], 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
    // First account of this state: whatever it holds was synced with it.
    if (meta?.account === undefined || meta.account === account) {
      if (meta?.disconnected_at === undefined) {
        if (meta?.account === undefined) store.put({ ...(meta ?? newMeta()), account });
        return { reset: false, restored: 0 };
      }
      const joined = await rejoin(transaction, meta);
      store.put({ ...joined.meta, account });
      return { reset: false, restored: joined.restored };
    }
    store.clear();
    store.put({ ...newMeta(), device_id: meta.device_id, account });
    return { reset: true, restored: 0 };
  });
}

/** "Elimina tutti i miei dati da Drive": this browser forgets every sync record (its id stays). */
export async function resetSyncState(factory: IDBFactory | undefined): Promise<void> {
  await inTransaction(factory, SYNC, 'readwrite', async transaction => {
    const store = transaction.objectStore(SYNC);
    const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
    store.clear();
    store.put({ ...newMeta(), device_id: meta?.device_id ?? crypto.randomUUID() });
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

/**
 * A local change to send, marked in the transaction (over SYNC) of the write it describes.
 * `fields`: the session fields an update changed (`trashed_at` alone for a trashing or a restore).
 */
async function markSession(store: IDBObjectStore, sessionDir: string, at: string, deleted: boolean, fields?: string[]): Promise<void> {
  const [current, meta] = await Promise.all([
    requestValue(store.get(sessionKey(sessionDir)) as IDBRequest<SessionSyncRecord | undefined>),
    requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>),
  ]);
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
  // After "Disconnetti" a deletion stays here (rejoin). A record still carrying a change from before
  // it, made in the sync, is not flagged: that change (a trashing too) goes to Drive with the rest.
  if (meta?.disconnected_at !== undefined && !(current?.dirty && !current.while_disconnected)) {
    record.while_disconnected = true;
    const trashing = fields?.length === 1 && fields[0] === 'trashed_at';
    if (!deleted && !trashing) record.edited_while_disconnected = true;
  }
  store.put(record);
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

// Changes that are only about this device never go to Drive.
const LOCAL_ONLY_FIELDS = new Set<keyof ArchiveSession>(['input_path', 'last_opened_at_iso']);
const syncedFields = (fields: string[]) => fields.some(field => !LOCAL_ONLY_FIELDS.has(field as keyof ArchiveSession));

/**
 * The Drive sync's marks, for the archive and the backup import to write with each change. An expiry
 * of the trash is dated when the sbobina went there (`at`; markSession keeps it after the last change
 * known here).
 */
export function syncMarks(now: () => Date = () => new Date()): ArchiveMarks {
  return {
    store: SYNC,
    async session(transaction, sessionDir, { deleted = false, at, fields } = {}) {
      if (fields && !syncedFields(fields)) return;
      await markSession(transaction.objectStore(SYNC), sessionDir, at ?? now().toISOString(), deleted, fields);
    },
    async folders(transaction, before, after) {
      const store = transaction.objectStore(SYNC);
      const meta = await requestValue(store.get(META_KEY) as IDBRequest<SyncMeta | undefined>);
      store.put(withFolderChanges(meta ?? newMeta(), before, after, now().toISOString()));
    },
  };
}

/**
 * The archive with sync marks: every write the user makes (editor saves, renames, deletions,
 * folders, a finished run) leaves its mark in its own transaction and calls onChange, so the sync
 * sends it soon. The sync engine itself writes to IndexedDB directly and leaves no marks.
 */
export function trackArchive(factory: IDBFactory | undefined, onChange: () => void, now: () => Date = () => new Date()): WebArchive {
  const archive = createWebArchive(factory, syncMarks(now));
  const changed = <T,>(result: T, wrote: boolean): T => {
    if (wrote) onChange();
    return result;
  };
  return {
    ...archive,
    create: async (input, body) => changed(await archive.create(input, body), true),
    saveHtml: async (path, body, generation, accept): Promise<SaveHtmlResult> => {
      const result = await archive.saveHtml(path, body, generation, accept);
      return changed(result, result.ok && Boolean(result.saved));
    },
    update: async (sessionDir, patch) => {
      const session = await archive.update(sessionDir, patch);
      return changed(session, session !== null && syncedFields(Object.keys(patch)));
    },
    delete: async (sessionDir, changedAt, trashedAt) => {
      const deleted = await archive.delete(sessionDir, changedAt, trashedAt);
      return changed(deleted, deleted);
    },
    trash: async (sessionDir, at) => {
      const trashed = await archive.trash(sessionDir, at);
      return changed(trashed, trashed);
    },
    restore: async sessionDir => {
      const session = await archive.restore(sessionDir);
      return changed(session, session !== null);
    },
    saveFolders: async folders => changed(await archive.saveFolders(folders), true),
  };
}

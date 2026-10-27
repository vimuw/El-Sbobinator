import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { sanitizeBodyHtml } from '../pipeline/export';
import { DOCUMENTS, FOLDERS, SESSIONS, inTransaction, requestValue, type StoredDocument } from '../webDatabase';
import { WEB_SESSION_PREFIX, createWebArchive, webSessionHtmlPath } from '../webSessions';
import type { DriveApi, DriveFileMeta } from './driveApi';
import {
  FOLDERS_FILE,
  FOLDERS_FORMAT,
  SYNC_VERSION,
  isPurged,
  mergeFolders,
  parseFoldersFile,
  parseSessionFile,
  sameFolderState,
  sessionDirFromFileName,
  sessionFileName,
  toSessionFile,
  type FolderState,
  type SyncFoldersFile,
  type SyncSessionFile,
} from './syncFormat';
import {
  readMeta,
  readRecord,
  readRecords,
  writeMeta,
  writeRecord,
  writeRecordIfUnchanged,
  type DeferredFile,
  type SessionSyncRecord,
  type SyncMeta,
} from './syncState';

// One sync round with the hidden Drive app folder. Quota-light: one files.list filtered by
// modifiedTime, downloads only of files changed since the last round, uploads only of sbobine
// marked locally. A sbobina changed on one side only takes that side; changed on both, the newer
// updated_at wins and the other version becomes a new sbobina "… (conflitto)", so no text is lost.
// The trash travels too: deleted_at moves a sbobina to the trash of every device (text kept), and
// once it is deleted for good the file becomes a mark without text (purged_at).

// Drive's listing can show a write a moment late: each round looks back this far, and files
// already seen are skipped by their modifiedTime.
const LIST_OVERLAP_MS = 60_000;
export const CONFLICT_SUFFIX = ' (conflitto)';

export interface SyncDeps {
  factory: IDBFactory | undefined;
  api: DriveApi;
  now?: () => Date;
  /** The editor has this sbobina open: a remote change waits instead of overwriting it. */
  isOpenInEditor?: (sessionDir: string) => boolean;
}

export interface SyncReport {
  downloaded: number;
  uploaded: number;
  conflicts: number;
  removed: number;
  foldersChanged: boolean;
  /** Changed on Drive but open in the editor here: applied after it closes. */
  deferred: string[];
  /** Files left alone: unreadable, or written by a newer version of the app. */
  skipped: string[];
  /** When the round ended, as stored: the time a reloaded page shows too. */
  syncedAt: string;
}

type LocalCopy = { session: ArchiveSession; document: StoredDocument };

async function readLocal(factory: IDBFactory | undefined, sessionDir: string): Promise<LocalCopy | null> {
  const [session, document] = await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readonly', transaction => Promise.all([
    requestValue(transaction.objectStore(SESSIONS).get(sessionDir) as IDBRequest<ArchiveSession | undefined>),
    requestValue(transaction.objectStore(DOCUMENTS).get(sessionDir) as IDBRequest<StoredDocument | undefined>),
  ]));
  return session ? { session, document: document ?? { session_dir: sessionDir, body: '', generation: 0 } } : null;
}

/** Writes Drive's version of a sbobina here (in the trash or not), keeping what only this device knows. */
async function applyRemote(factory: IDBFactory | undefined, file: SyncSessionFile): Promise<'written' | 'removed' | 'none'> {
  const dir = file.session.session_dir;
  if (isPurged(file)) return (await createWebArchive(factory).delete(dir)) ? 'removed' : 'none';
  const body = sanitizeBodyHtml(file.body);
  await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readwrite', async transaction => {
    const sessions = transaction.objectStore(SESSIONS);
    const documents = transaction.objectStore(DOCUMENTS);
    const [local, document] = await Promise.all([
      requestValue(sessions.get(dir) as IDBRequest<ArchiveSession | undefined>),
      requestValue(documents.get(dir) as IDBRequest<StoredDocument | undefined>),
    ]);
    sessions.put({
      ...file.session,
      session_dir: dir,
      html_path: webSessionHtmlPath(dir),
      input_path: local?.input_path ?? '',
      ...(local?.last_opened_at_iso ? { last_opened_at_iso: local.last_opened_at_iso } : {}),
      ...(file.deleted_at ? { trashed_at: file.deleted_at } : {}),
    } satisfies ArchiveSession);
    // The local generation stays: other devices' generations come from other clocks.
    documents.put({ session_dir: dir, body, generation: document?.generation ?? 0 } satisfies StoredDocument);
  });
  return 'written';
}

/**
 * The losing side of a conflict, kept as a new sbobina that the next upload sends to Drive. A side
 * that was in the trash stays in the trash.
 */
async function saveConflictCopy(factory: IDBFactory | undefined, session: ArchiveSession, body: string, at: string): Promise<void> {
  const dir = `${WEB_SESSION_PREFIX}${crypto.randomUUID()}`;
  await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readwrite', transaction => {
    transaction.objectStore(SESSIONS).put({
      ...session,
      name: session.name.endsWith(CONFLICT_SUFFIX) ? session.name : `${session.name}${CONFLICT_SUFFIX}`,
      session_dir: dir,
      html_path: webSessionHtmlPath(dir),
      input_path: '',
    } satisfies ArchiveSession);
    transaction.objectStore(DOCUMENTS).put({ session_dir: dir, body, generation: 0 } satisfies StoredDocument);
  });
  await writeRecord(factory, { session_dir: dir, dirty: true, updated_at: at });
}

function asSession(file: SyncSessionFile): ArchiveSession {
  const dir = file.session.session_dir;
  return { ...file.session, html_path: webSessionHtmlPath(dir), input_path: '', ...(file.deleted_at ? { trashed_at: file.deleted_at } : {}) };
}

function sameContent(local: LocalCopy | null, remote: SyncSessionFile): boolean {
  if (!local) return isPurged(remote);
  return !isPurged(remote)
    && Boolean(local.session.trashed_at) === Boolean(remote.deleted_at)
    && local.session.name === remote.session.name
    && local.document.body === sanitizeBodyHtml(remote.body);
}

async function mergeSession(deps: SyncDeps, record: SessionSyncRecord | null, remote: SyncSessionFile, meta: DriveFileMeta, report: SyncReport): Promise<void> {
  const { factory } = deps;
  const dir = remote.session.session_dir;
  const purgedAt = isPurged(remote) ? remote.purged_at ?? remote.deleted_at : undefined;
  const synced = { session_dir: dir, file_id: meta.id, remote_modified: meta.modifiedTime, dirty: false, updated_at: remote.updated_at, ...(purgedAt ? { deleted_at: purgedAt } : {}) };
  const local = await readLocal(factory, dir);
  const count = (outcome: 'written' | 'removed' | 'none') => {
    if (outcome === 'written') report.downloaded += 1;
    if (outcome === 'removed') report.removed += 1;
  };

  if (!record?.dirty || sameContent(local, remote)) {
    if (!record?.dirty || !sameContent(local, remote)) count(await applyRemote(factory, remote));
    await writeRecord(factory, synced);
    return;
  }
  // Changed on both sides.
  report.conflicts += 1;
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (remote.updated_at > record.updated_at) {
    if (local) await saveConflictCopy(factory, local.session, local.document.body, at);
    count(await applyRemote(factory, remote));
    await writeRecord(factory, synced);
  } else {
    if (!isPurged(remote)) await saveConflictCopy(factory, asSession(remote), sanitizeBodyHtml(remote.body), at);
    // The local version stays marked: the upload below writes it over Drive's.
    await writeRecord(factory, { ...record, file_id: meta.id, remote_modified: meta.modifiedTime });
  }
}

async function uploadSession(deps: SyncDeps, meta: SyncMeta, record: SessionSyncRecord, report: SyncReport): Promise<void> {
  const { factory, api } = deps;
  const local = record.deleted_at ? null : await readLocal(factory, record.session_dir);
  if (!record.deleted_at && !local) return;
  const session = local?.session ?? { session_dir: record.session_dir, html_path: webSessionHtmlPath(record.session_dir), name: '', completed_at_iso: record.updated_at, effective_model: '', input_path: '' };
  const file = toSessionFile(session, local?.document.body ?? '', local?.document.generation ?? 0, {
    updated_at: record.updated_at,
    device_id: meta.device_id,
    ...(local?.session.trashed_at ? { deleted_at: local.session.trashed_at } : {}),
    ...(record.deleted_at ? { purged_at: record.deleted_at } : {}),
  });
  let written: DriveFileMeta;
  try {
    written = record.file_id ? await api.updateJson(record.file_id, file) : await api.createJson(sessionFileName(record.session_dir), file);
  } catch (error) {
    // Removed from Drive by hand ("Elimina tutti i miei dati" from another device): create it again.
    if (!record.file_id || (error as { status?: number }).status !== 404) throw error;
    written = await api.createJson(sessionFileName(record.session_dir), file);
  }
  report.uploaded += 1;
  await writeRecordIfUnchanged(factory, record, { ...record, file_id: written.id, remote_modified: written.modifiedTime, dirty: false });
}

async function readFolderState(factory: IDBFactory | undefined, meta: SyncMeta): Promise<FolderState> {
  const folders = await inTransaction(factory, FOLDERS, 'readonly', transaction =>
    requestValue(transaction.objectStore(FOLDERS).getAll() as IDBRequest<ArchiveFolder[]>));
  const epoch = new Date(0).toISOString();
  return { folders: folders.map(folder => ({ ...folder, updated_at: meta.folders.times[folder.id] ?? epoch })), deleted: meta.folders.deleted };
}

async function syncFolders(deps: SyncDeps, meta: SyncMeta, remoteFiles: DriveFileMeta[], report: SyncReport): Promise<void> {
  const { factory, api } = deps;
  const changed = remoteFiles.filter(file => file.id !== meta.folders.file_id || file.modifiedTime !== meta.folders.remote_modified);
  const local = await readFolderState(factory, meta);
  const nothingLocal = !local.folders.length && !Object.keys(local.deleted).length;
  if (!changed.length && !meta.folders.dirty && (meta.folders.file_id || nothingLocal)) return;

  let merged = local;
  const remoteStates: Array<{ file: DriveFileMeta; state: FolderState }> = [];
  for (const file of changed) {
    const parsed = parseFoldersFile(await api.readJson(file.id));
    if (!parsed.ok) {
      report.skipped.push(file.name);
      // Written by a newer version of the app: never overwritten by this one.
      if ('reason' in parsed && parsed.reason === 'newer') return;
      continue;
    }
    remoteStates.push({ file, state: parsed.file });
    merged = mergeFolders(merged, parsed.file);
  }
  if (!sameFolderState(merged, local)) {
    report.foldersChanged = true;
    await inTransaction(factory, FOLDERS, 'readwrite', transaction => {
      const store = transaction.objectStore(FOLDERS);
      store.clear();
      for (const { updated_at: _time, ...folder } of merged.folders) store.put(folder satisfies ArchiveFolder);
    });
  }

  const fileId = meta.folders.file_id ?? changed[0]?.id;
  // Drive's copy already says the same (another device merged first): nothing to send.
  const driveUpToDate = Boolean(fileId) && !meta.folders.dirty && remoteStates.length === 1
    && remoteStates[0].file.id === fileId && sameFolderState(merged, remoteStates[0].state);
  let written: DriveFileMeta | null = null;
  if (!driveUpToDate) {
    const upload: SyncFoldersFile = {
      format: FOLDERS_FORMAT,
      version: SYNC_VERSION,
      folders: merged.folders,
      deleted: merged.deleted,
      updated_at: (deps.now ?? (() => new Date()))().toISOString(),
      device_id: meta.device_id,
    };
    written = fileId
      ? await api.updateJson(fileId, upload).catch((error: { status?: number }) => {
        if (error.status !== 404) throw error;
        return api.createJson(FOLDERS_FILE, upload);
      })
      : await api.createJson(FOLDERS_FILE, upload);
  }
  const ours = remoteFiles.find(file => file.id === fileId);
  await writeMeta(factory, current => {
    // Folders saved in the app during this round keep their newer times and stay marked.
    const later = (mine: Record<string, string>, base: Record<string, string>) => Object.fromEntries(Object.entries(mine).filter(([id, at]) => at > (base[id] ?? '')));
    const newerTimes = later(current.folders.times, meta.folders.times);
    const newerDeleted = later(current.folders.deleted, meta.folders.deleted);
    const times = { ...Object.fromEntries(merged.folders.map(folder => [folder.id, folder.updated_at])), ...newerTimes };
    const deleted = { ...merged.deleted, ...newerDeleted };
    for (const id of Object.keys(newerTimes)) delete deleted[id];
    for (const id of Object.keys(newerDeleted)) delete times[id];
    return {
      ...current,
      folders: {
        file_id: written?.id ?? fileId,
        remote_modified: written?.modifiedTime ?? ours?.modifiedTime ?? current.folders.remote_modified,
        dirty: Object.keys(newerTimes).length > 0 || Object.keys(newerDeleted).length > 0,
        times,
        deleted,
      },
    };
  });
}

/** Runs one round. Throws DriveError (offline, 401, quota) for the caller to report and retry. */
export async function syncOnce(deps: SyncDeps): Promise<SyncReport> {
  const { factory, api } = deps;
  const now = deps.now ?? (() => new Date());
  const report: SyncReport = { downloaded: 0, uploaded: 0, conflicts: 0, removed: 0, foldersChanged: false, deferred: [], skipped: [], syncedAt: '' };
  const meta = await readMeta(factory);

  // Sbobine made before Drive was connected (or imported from a backup) have no record yet.
  const records = await readRecords(factory);
  const archive = createWebArchive(factory);
  const sessions = [...await archive.list(), ...await archive.listTrash()];
  for (const session of sessions) {
    if (!records.has(session.session_dir)) {
      const record = { session_dir: session.session_dir, dirty: true, updated_at: session.completed_at_iso || now().toISOString() };
      await writeRecord(factory, record);
      records.set(session.session_dir, { ...record, key: '' });
    }
  }

  const since = meta.watermark ? new Date(Date.parse(meta.watermark) - LIST_OVERLAP_MS).toISOString() : null;
  const listed = await api.listChanged(since);
  const byId = new Map<string, DriveFileMeta>(meta.deferred.map(file => [file.id, file]));
  for (const file of listed) byId.set(file.id, file);
  const changed = [...byId.values()].sort((a, b) => a.modifiedTime.localeCompare(b.modifiedTime));
  const deferred: DeferredFile[] = [];

  for (const file of changed) {
    const dir = sessionDirFromFileName(file.name);
    if (!dir) continue;
    const record = await readRecord(factory, dir);
    if (record?.file_id === file.id && record.remote_modified === file.modifiedTime) continue;
    if (deps.isOpenInEditor?.(dir)) {
      deferred.push(file);
      report.deferred.push(dir);
      continue;
    }
    const parsed = parseSessionFile(await api.readJson(file.id), file.name);
    if (!parsed.ok) {
      report.skipped.push(file.name);
      continue;
    }
    await mergeSession(deps, record, parsed.file, file, report);
  }

  for (const record of (await readRecords(factory)).values()) {
    if (record.dirty) await uploadSession(deps, meta, record, report);
  }
  await syncFolders(deps, meta, changed.filter(file => file.name === FOLDERS_FILE), report);

  const watermark = listed.reduce<string | undefined>((latest, file) => (!latest || file.modifiedTime > latest ? file.modifiedTime : latest), meta.watermark);
  report.syncedAt = now().toISOString();
  await writeMeta(factory, current => ({ ...current, watermark, last_sync_at: report.syncedAt, deferred }));
  return report;
}

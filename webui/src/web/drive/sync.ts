import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { sanitizeBodyHtml } from '../pipeline/export';
import { DOCUMENTS, FOLDERS, SESSIONS, SYNC, inTransaction, requestValue, textGeneration, type StoredDocument } from '../webDatabase';
import { DELETE_STORES, WEB_SESSION_PREFIX, createWebArchive, deleteInTransaction, webSessionHtmlPath } from '../webSessions';
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
  META_KEY,
  readMeta,
  readRecord,
  readRecords,
  recordLocalWin,
  recordUpload,
  sameMark,
  sessionKey,
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
  isOpenInEditor?: (sessionDir: string) => boolean | Promise<boolean>;
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

type ApplyOutcome = 'written' | 'removed' | 'none' | 'changed';

/**
 * Writes Drive's version of a sbobina here (in the trash or not), keeping what only this device
 * knows, together with its synced record. 'changed': a local write came in after `expected` was
 * read, nothing is written and the file is merged again next round.
 */
async function applyRemote(factory: IDBFactory | undefined, file: SyncSessionFile, expected: SessionSyncRecord | null, synced: Omit<SessionSyncRecord, 'key'>): Promise<ApplyOutcome> {
  const dir = file.session.session_dir;
  if (isPurged(file)) {
    return inTransaction(factory, [...DELETE_STORES, SYNC], 'readwrite', async transaction => {
      const records = transaction.objectStore(SYNC);
      if (!sameMark(await requestValue(records.get(sessionKey(dir)) as IDBRequest<SessionSyncRecord | undefined>), expected)) return 'changed';
      const removed = await deleteInTransaction(transaction, dir);
      records.put({ ...synced, key: sessionKey(dir) } satisfies SessionSyncRecord);
      return removed ? 'removed' : 'none';
    });
  }
  const body = sanitizeBodyHtml(file.body);
  return inTransaction(factory, [SESSIONS, DOCUMENTS, SYNC], 'readwrite', async transaction => {
    const sessions = transaction.objectStore(SESSIONS);
    const documents = transaction.objectStore(DOCUMENTS);
    const records = transaction.objectStore(SYNC);
    const [local, document, current] = await Promise.all([
      requestValue(sessions.get(dir) as IDBRequest<ArchiveSession | undefined>),
      requestValue(documents.get(dir) as IDBRequest<StoredDocument | undefined>),
      requestValue(records.get(sessionKey(dir)) as IDBRequest<SessionSyncRecord | undefined>),
    ]);
    if (!sameMark(current, expected)) return 'changed';
    sessions.put({
      ...file.session,
      session_dir: dir,
      html_path: webSessionHtmlPath(dir),
      input_path: local?.input_path ?? '',
      ...(local?.last_opened_at_iso ? { last_opened_at_iso: local.last_opened_at_iso } : {}),
      ...(file.deleted_at ? { trashed_at: file.deleted_at } : {}),
    } satisfies ArchiveSession);
    // The local generation stays: other devices' generations come from other clocks. The writer's
    // generation tells a backup import how recent this text is.
    documents.put({ session_dir: dir, body, generation: document?.generation ?? 0, text_at: file.generation } satisfies StoredDocument);
    records.put({ ...synced, key: sessionKey(dir) } satisfies SessionSyncRecord);
    return 'written';
  });
}

/**
 * The losing side of a conflict, kept as a new sbobina that the next upload sends to Drive. A side
 * that was in the trash stays in the trash.
 */
async function saveConflictCopy(factory: IDBFactory | undefined, session: ArchiveSession, body: string, at: string): Promise<void> {
  const dir = `${WEB_SESSION_PREFIX}${crypto.randomUUID()}`;
  await inTransaction(factory, [SESSIONS, DOCUMENTS, SYNC], 'readwrite', transaction => {
    transaction.objectStore(SESSIONS).put({
      ...session,
      name: session.name.endsWith(CONFLICT_SUFFIX) ? session.name : `${session.name}${CONFLICT_SUFFIX}`,
      session_dir: dir,
      html_path: webSessionHtmlPath(dir),
      input_path: '',
    } satisfies ArchiveSession);
    transaction.objectStore(DOCUMENTS).put({ session_dir: dir, body, generation: 0 } satisfies StoredDocument);
    transaction.objectStore(SYNC).put({ key: sessionKey(dir), session_dir: dir, dirty: true, updated_at: at } satisfies SessionSyncRecord);
  });
}

function asSession(file: SyncSessionFile): ArchiveSession {
  const dir = file.session.session_dir;
  return { ...file.session, html_path: webSessionHtmlPath(dir), input_path: '', ...(file.deleted_at ? { trashed_at: file.deleted_at } : {}) };
}

// Both bodies cleaned alike: the editor's own text keeps markup the cleanup drops (KaTeX's MathML and
// SVG inside a formula), and the same text must not look like a change on both sides.
function sameContent(local: LocalCopy | null, remote: SyncSessionFile): boolean {
  if (!local) return isPurged(remote);
  return !isPurged(remote)
    && Boolean(local.session.trashed_at) === Boolean(remote.deleted_at)
    && local.session.name === remote.session.name
    && sanitizeBodyHtml(local.document.body) === sanitizeBodyHtml(remote.body);
}

/**
 * Merges Drive's version with the local one. `record` must be read after the download, so a local
 * write made meanwhile counts as a change on this side. False: a local write came in during the
 * merge itself, the file waits for the next round.
 */
async function mergeSession(deps: SyncDeps, record: SessionSyncRecord | null, remote: SyncSessionFile, meta: DriveFileMeta, report: SyncReport, account: string | undefined): Promise<boolean> {
  const { factory } = deps;
  const dir = remote.session.session_dir;
  const purgedAt = isPurged(remote) ? remote.purged_at ?? remote.deleted_at : undefined;
  const synced = { session_dir: dir, file_id: meta.id, remote_modified: meta.modifiedTime, dirty: false, updated_at: remote.updated_at, ...(purgedAt ? { deleted_at: purgedAt } : {}) };
  const local = await readLocal(factory, dir);
  const apply = async () => {
    const outcome = await applyRemote(factory, remote, record, synced);
    if (outcome === 'written') report.downloaded += 1;
    if (outcome === 'removed') report.removed += 1;
    return outcome !== 'changed';
  };

  if (!record?.dirty) return apply();
  if (sameContent(local, remote)) return writeRecordIfUnchanged(factory, record, synced);
  // Changed on both sides.
  report.conflicts += 1;
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (remote.updated_at > record.updated_at) {
    if (local) await saveConflictCopy(factory, local.session, local.document.body, at);
    return apply();
  }
  if (!isPurged(remote)) await saveConflictCopy(factory, asSession(remote), sanitizeBodyHtml(remote.body), at);
  // The local version stays marked: the upload below writes it over Drive's. A deletion for good
  // made during the copy keeps its mark, or the text would stay on Drive.
  await recordLocalWin(factory, record, meta, account);
  return true;
}

async function uploadSession(deps: SyncDeps, meta: SyncMeta, record: SessionSyncRecord, report: SyncReport): Promise<void> {
  const { factory, api } = deps;
  const local = record.deleted_at ? null : await readLocal(factory, record.session_dir);
  if (!record.deleted_at && !local) return;
  const session = local?.session ?? { session_dir: record.session_dir, html_path: webSessionHtmlPath(record.session_dir), name: '', completed_at_iso: record.updated_at, effective_model: '', input_path: '' };
  // A text downloaded and sent on unedited (a rename here) keeps the time it was written.
  const file = toSessionFile(session, local?.document.body ?? '', textGeneration(local?.document), {
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
  await recordUpload(factory, record, written, meta.account);
}

/**
 * The folder tree with its sync state, read together (a folder saved in the app writes both at
 * once): a folder saved during this round's downloads carries the time it was saved, not an older one.
 */
async function readFolderState(factory: IDBFactory | undefined, roundMeta: SyncMeta): Promise<{ meta: SyncMeta; local: FolderState }> {
  const [folders, stored] = await inTransaction(factory, [FOLDERS, SYNC], 'readonly', transaction => Promise.all([
    requestValue(transaction.objectStore(FOLDERS).getAll() as IDBRequest<ArchiveFolder[]>),
    requestValue(transaction.objectStore(SYNC).get(META_KEY) as IDBRequest<SyncMeta | undefined>),
  ]));
  const meta = stored ?? roundMeta;
  const epoch = new Date(0).toISOString();
  return { meta, local: { folders: folders.map(folder => ({ ...folder, updated_at: meta.folders.times[folder.id] ?? epoch })), deleted: meta.folders.deleted } };
}

/** Whether the folders' marks are still the ones read: no folder saved since. */
const sameFolderMarks = (current: SyncMeta | undefined, before: SyncMeta) =>
  JSON.stringify([current?.folders.times ?? {}, current?.folders.deleted ?? {}]) === JSON.stringify([before.folders.times, before.folders.deleted]);

/** The account was switched during the round (bindAccount reset the state): its results are stale. */
const accountChanged = (current: SyncMeta, before: SyncMeta) => before.account !== undefined && current.account !== before.account;

/** A Drive file not merged this round (written by a newer version of the app, or held back): looked at again next round. */
const held = (file: DriveFileMeta): DeferredFile => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime });

/** The folder tree as stored, whatever the order, for telling whether it changed. */
const storedTree = (folders: Array<ArchiveFolder & { updated_at?: string }>) =>
  JSON.stringify(folders.map(({ updated_at: _time, ...folder }) => folder).sort((a, b) => a.id.localeCompare(b.id)));

/**
 * Merges the folder tree; returns the Drive files held back for the next round: written by a newer
 * version of the app, or merged while the tree here changed (a folder saved in the app or imported
 * from a backup during the download), which the merge would otherwise overwrite.
 */
async function syncFolders(deps: SyncDeps, roundMeta: SyncMeta, remoteFiles: DriveFileMeta[], report: SyncReport): Promise<DeferredFile[]> {
  const { factory, api } = deps;
  // Read again, not the state of the round's start: folders saved while it downloaded the sbobine
  // are newer than Drive's changes made before them.
  const { meta, local } = await readFolderState(factory, roundMeta);
  if (accountChanged(meta, roundMeta)) return [];
  const changed = remoteFiles.filter(file => file.id !== meta.folders.file_id || file.modifiedTime !== meta.folders.remote_modified);
  const nothingLocal = !local.folders.length && !Object.keys(local.deleted).length;
  if (!changed.length && !meta.folders.dirty && (meta.folders.file_id || nothingLocal)) return [];

  let merged = local;
  const remoteStates: Array<{ file: DriveFileMeta; state: FolderState }> = [];
  for (const file of changed) {
    const parsed = parseFoldersFile(await api.readJson(file.id));
    if (!parsed.ok) {
      report.skipped.push(file.name);
      // Written by a newer version of the app: never overwritten by this one, even with local
      // changes, until it reads that format.
      if ('reason' in parsed && parsed.reason === 'newer') return [held(file)];
      continue;
    }
    remoteStates.push({ file, state: parsed.file });
    merged = mergeFolders(merged, parsed.file);
  }
  if (!sameFolderState(merged, local)) {
    const written = await inTransaction(factory, [FOLDERS, SYNC], 'readwrite', async transaction => {
      const store = transaction.objectStore(FOLDERS);
      const [tree, current] = await Promise.all([
        requestValue(store.getAll() as IDBRequest<ArchiveFolder[]>),
        requestValue(transaction.objectStore(SYNC).get(META_KEY) as IDBRequest<SyncMeta | undefined>),
      ]);
      // Saved here during the download: not in `merged`, it would be lost. Nothing is written or
      // sent; the next round merges Drive's files again, with that change and its mark.
      if (storedTree(tree) !== storedTree(local.folders) || !sameFolderMarks(current, meta)) return false;
      store.clear();
      for (const { updated_at: _time, ...folder } of merged.folders) store.put(folder satisfies ArchiveFolder);
      return true;
    });
    if (!written) return changed.map(held);
    report.foldersChanged = true;
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
    if (accountChanged(current, meta)) return current;
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
  return [];
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
  // Sbobine with a Drive change not merged yet: their upload waits too, or it would overwrite that
  // change on Drive without leaving a conflict copy.
  const waiting = new Set<string>();
  const wait = (file: DeferredFile, dir: string, inEditor: boolean) => {
    deferred.push(file);
    waiting.add(dir);
    if (inEditor) report.deferred.push(dir);
  };

  for (const file of changed) {
    const dir = sessionDirFromFileName(file.name);
    if (!dir) continue;
    const record = await readRecord(factory, dir);
    if (record?.file_id === file.id && record.remote_modified === file.modifiedTime) continue;
    if (await deps.isOpenInEditor?.(dir)) {
      wait(file, dir, true);
      continue;
    }
    let content: unknown;
    try {
      content = await api.readJson(file.id);
    } catch (error) {
      // Removed from Drive since it was listed or held back ("Elimina tutti i miei dati" from another
      // device): nothing to merge, and a local change goes up as a new file.
      if ((error as { status?: number }).status === 404) continue;
      throw error;
    }
    const parsed = parseSessionFile(content, file.name);
    // The editor may have opened it during the download.
    if (await deps.isOpenInEditor?.(dir)) {
      wait(file, dir, true);
      continue;
    }
    if (!parsed.ok) {
      report.skipped.push(file.name);
      // Written by a newer version of the app: a local change stays here until this one reads it.
      if ('reason' in parsed && parsed.reason === 'newer') wait(held(file), dir, false);
      continue;
    }
    // Read again: a rename or a trashing made during the download is a local change.
    if (!await mergeSession(deps, await readRecord(factory, dir), parsed.file, file, report, meta.account)) wait(file, dir, false);
  }

  for (const record of (await readRecords(factory)).values()) {
    if (record.dirty && !waiting.has(record.session_dir)) await uploadSession(deps, meta, record, report);
  }
  deferred.push(...await syncFolders(deps, meta, changed.filter(file => file.name === FOLDERS_FILE), report));

  const watermark = listed.reduce<string | undefined>((latest, file) => (!latest || file.modifiedTime > latest ? file.modifiedTime : latest), meta.watermark);
  report.syncedAt = now().toISOString();
  // After an account switch the new state lists from scratch: this round's watermark is the old Drive's.
  await writeMeta(factory, current => (accountChanged(current, meta) ? current : { ...current, watermark, last_sync_at: report.syncedAt, deferred }));
  return report;
}

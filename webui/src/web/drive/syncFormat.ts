import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { WEB_SESSION_PREFIX } from '../webSessions';

// What the sync writes in the hidden Drive app folder (appDataFolder). One file per sbobina,
// sbobina-<uuid>.json, the uuid of its session_dir (crypto.randomUUID(), unique across devices),
// and raccolte.json with the folder tree. Audio, pipeline checkpoints and API keys never go there.
// The local file path of the lecture and the "last opened" time stay on each device.

export const SYNC_FORMAT = 'el-sbobinator-sync';
export const FOLDERS_FORMAT = 'el-sbobinator-sync-folders';
export const SYNC_VERSION = 1;
export const FOLDERS_FILE = 'raccolte.json';
const SESSION_FILE = /^sbobina-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/;

/** The sbobina's metadata as synced: device-local fields left out. */
export type SyncedSession = Omit<ArchiveSession, 'input_path' | 'html_path' | 'last_opened_at_iso'>;

export interface SyncSessionFile {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  session: SyncedSession;
  /** The editor document (HTML body); empty once deleted. */
  body: string;
  /** Autosave generation on the device that wrote it (informative: clocks differ across devices). */
  generation: number;
  /** When the sbobina last changed on the device that wrote it: the newer side wins a conflict. */
  updated_at: string;
  device_id: string;
  /** Moved to the trash in the app: other devices move it there too (text kept, restorable). */
  deleted_at?: string;
  /** Deleted for good (trash emptied or expired): a mark without text, so no device brings it back. */
  purged_at?: string;
}

/**
 * A mark of a sbobina deleted for good. B1–B3 previews wrote deleted_at with an empty body and no
 * purged_at for a deletion: those count as gone for good too.
 */
export function isPurged(file: Pick<SyncSessionFile, 'deleted_at' | 'purged_at' | 'body'>): boolean {
  return Boolean(file.purged_at) || (Boolean(file.deleted_at) && file.body === '');
}

export type SyncedFolder = ArchiveFolder & { updated_at: string };

export interface SyncFoldersFile {
  format: typeof FOLDERS_FORMAT;
  version: typeof SYNC_VERSION;
  folders: SyncedFolder[];
  /** Folders removed in the app, by id, with when: kept so an offline device does not bring them back. */
  deleted: Record<string, string>;
  updated_at: string;
  device_id: string;
}

export function sessionFileName(sessionDir: string): string {
  return `sbobina-${sessionDir.slice(WEB_SESSION_PREFIX.length)}.json`;
}

export function sessionDirFromFileName(name: string): string | null {
  const match = SESSION_FILE.exec(name);
  return match ? `${WEB_SESSION_PREFIX}${match[1]}` : null;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isDate = (value: unknown): value is string => isString(value) && !Number.isNaN(Date.parse(value));

/** Only the known fields, with their types: a file from Drive is not trusted. */
function syncedSession(value: unknown): SyncedSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!isString(raw.session_dir) || !isString(raw.name) || !isString(raw.completed_at_iso)) return null;
  const session: SyncedSession = {
    session_dir: raw.session_dir,
    name: raw.name.slice(0, 500),
    completed_at_iso: raw.completed_at_iso,
    effective_model: isString(raw.effective_model) ? raw.effective_model : '',
  };
  if (isString(raw.input_name)) session.input_name = raw.input_name;
  if (isNumber(raw.input_size)) session.input_size = raw.input_size;
  if (isNumber(raw.duration_sec)) session.duration_sec = raw.duration_sec;
  if (raw.completion_status === 'completed' || raw.completion_status === 'completed_with_warnings') session.completion_status = raw.completion_status;
  if (Array.isArray(raw.revision_failed_blocks)) session.revision_failed_blocks = raw.revision_failed_blocks.filter(isNumber);
  const identity = raw.input_identity as Record<string, unknown> | undefined;
  if (identity && isString(identity.name) && isNumber(identity.size) && isString(identity.headHash)) {
    session.input_identity = { name: identity.name, size: identity.size, headHash: identity.headHash };
  }
  return session;
}

export function toSyncedSession(session: ArchiveSession): SyncedSession {
  return syncedSession(session)!;
}

export function toSessionFile(
  session: ArchiveSession,
  body: string,
  generation: number,
  meta: { updated_at: string; device_id: string; deleted_at?: string; purged_at?: string },
): SyncSessionFile {
  if (meta.purged_at) {
    // Nothing of the sbobina stays on Drive: not its text, not its name.
    return {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      session: { session_dir: session.session_dir, name: '', completed_at_iso: '', effective_model: '' },
      body: '',
      generation: 0,
      updated_at: meta.updated_at,
      device_id: meta.device_id,
      deleted_at: meta.deleted_at ?? meta.purged_at,
      purged_at: meta.purged_at,
    };
  }
  return {
    format: SYNC_FORMAT,
    version: SYNC_VERSION,
    session: toSyncedSession(session),
    body,
    generation,
    updated_at: meta.updated_at,
    device_id: meta.device_id,
    ...(meta.deleted_at ? { deleted_at: meta.deleted_at } : {}),
  };
}

export type ParseResult<T> = { ok: true; file: T } | { ok: false; reason: 'invalid' | 'newer' };

/** A sbobina file read from Drive, checked against its own name. Newer versions are left alone. */
export function parseSessionFile(value: unknown, fileName: string): ParseResult<SyncSessionFile> {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null || raw.format !== SYNC_FORMAT) return { ok: false, reason: 'invalid' };
  if (isNumber(raw.version) && raw.version > SYNC_VERSION) return { ok: false, reason: 'newer' };
  const session = raw.version === SYNC_VERSION ? syncedSession(raw.session) : null;
  if (!session || session.session_dir !== sessionDirFromFileName(fileName)) return { ok: false, reason: 'invalid' };
  if (!isString(raw.body) || !isDate(raw.updated_at) || !isString(raw.device_id)) return { ok: false, reason: 'invalid' };
  if (raw.deleted_at !== undefined && !isDate(raw.deleted_at)) return { ok: false, reason: 'invalid' };
  if (raw.purged_at !== undefined && !isDate(raw.purged_at)) return { ok: false, reason: 'invalid' };
  return {
    ok: true,
    file: {
      format: SYNC_FORMAT,
      version: SYNC_VERSION,
      session,
      body: raw.body,
      generation: isNumber(raw.generation) ? raw.generation : 0,
      updated_at: raw.updated_at,
      device_id: raw.device_id,
      ...(isString(raw.deleted_at) ? { deleted_at: raw.deleted_at } : {}),
      ...(isString(raw.purged_at) ? { purged_at: raw.purged_at } : {}),
    },
  };
}

function syncedFolder(value: unknown): SyncedFolder | null {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null || !isString(raw.id) || !isString(raw.name) || !isDate(raw.updated_at)) return null;
  return {
    id: raw.id,
    name: raw.name.slice(0, 500),
    color: isString(raw.color) ? raw.color : '',
    parent_id: isString(raw.parent_id) ? raw.parent_id : null,
    session_dirs: Array.isArray(raw.session_dirs) ? raw.session_dirs.filter(isString) : [],
    updated_at: raw.updated_at,
  };
}

export function parseFoldersFile(value: unknown): ParseResult<SyncFoldersFile> {
  const raw = value as Record<string, unknown> | null;
  if (typeof raw !== 'object' || raw === null || raw.format !== FOLDERS_FORMAT) return { ok: false, reason: 'invalid' };
  if (isNumber(raw.version) && raw.version > SYNC_VERSION) return { ok: false, reason: 'newer' };
  if (raw.version !== SYNC_VERSION || !Array.isArray(raw.folders)) return { ok: false, reason: 'invalid' };
  const deleted: Record<string, string> = {};
  if (typeof raw.deleted === 'object' && raw.deleted !== null) {
    for (const [id, at] of Object.entries(raw.deleted as Record<string, unknown>)) if (isDate(at)) deleted[id] = at;
  }
  return {
    ok: true,
    file: {
      format: FOLDERS_FORMAT,
      version: SYNC_VERSION,
      folders: raw.folders.map(syncedFolder).filter((folder): folder is SyncedFolder => folder !== null),
      deleted,
      updated_at: isDate(raw.updated_at) ? raw.updated_at : new Date(0).toISOString(),
      device_id: isString(raw.device_id) ? raw.device_id : '',
    },
  };
}

/** Folder tree as each side knows it: the folders with their change times, and the removed ids. */
export interface FolderState {
  folders: SyncedFolder[];
  deleted: Record<string, string>;
}

const newer = (a: string | undefined, b: string | undefined) => (a ?? '') > (b ?? '');

/**
 * Per folder, the most recent change wins: an edit, or its removal. A sbobina filed in two folders
 * by two devices stays only in the folder changed last.
 */
export function mergeFolders(local: FolderState, remote: FolderState): FolderState {
  const deleted: Record<string, string> = { ...remote.deleted };
  for (const [id, at] of Object.entries(local.deleted)) if (newer(at, deleted[id])) deleted[id] = at;
  const byId = new Map<string, SyncedFolder>();
  // Local order first (the archive shows folders in their order), then folders new from Drive.
  for (const folder of [...local.folders, ...remote.folders]) {
    const current = byId.get(folder.id);
    if (!current || newer(folder.updated_at, current.updated_at)) byId.set(folder.id, folder);
  }
  const folders: SyncedFolder[] = [];
  for (const folder of byId.values()) {
    if (deleted[folder.id] && !newer(folder.updated_at, deleted[folder.id])) continue;
    delete deleted[folder.id];
    folders.push(folder);
  }
  const owner = new Map<string, SyncedFolder>();
  for (const folder of folders) {
    for (const dir of folder.session_dirs) {
      const other = owner.get(dir);
      if (!other || newer(folder.updated_at, other.updated_at)) owner.set(dir, folder);
    }
  }
  return {
    folders: folders.map(folder => ({ ...folder, session_dirs: folder.session_dirs.filter(dir => owner.get(dir) === folder) })),
    deleted,
  };
}

/** Whether two folder trees say the same thing (order aside). */
export function sameFolderState(a: FolderState, b: FolderState): boolean {
  const canonical = (state: FolderState) => JSON.stringify({
    folders: [...state.folders].sort((x, y) => x.id.localeCompare(y.id)),
    deleted: Object.fromEntries(Object.entries(state.deleted).sort(([x], [y]) => x.localeCompare(y))),
  });
  return canonical(a) === canonical(b);
}

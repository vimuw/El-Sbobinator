import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { DOCUMENTS, FOLDERS, MEDIA, MEDIA_BY_SESSION, SESSIONS, inTransaction, requestValue, type StoredDocument } from './webDatabase';
import type { StoredMedia } from './webMedia';
import { WEB_SESSION_PREFIX, webSessionHtmlPath } from './webSessions';
import { ZipFormatError, createZip, readZip } from './zipArchive';

// Backup of the web archive: one .zip with a JSON manifest (sbobine metadata, editor documents,
// collections) and, if the user wants them, the lecture audio files as they are. ZIP rather than a
// JSON with base64 audio: no 33% inflation, the audio never has to sit in memory as a string, the
// iPad Files app opens it, and the texts can be read without El Sbobinator. API keys stay out:
// they live in localStorage and this module never reads it except for the last backup date.

export const BACKUP_FORMAT = 'el-sbobinator-web-backup';
export const BACKUP_VERSION = 1;
export const BACKUP_MANIFEST = 'el-sbobinator-backup.json';

export interface BackupAudio {
  /** Entry of the audio file inside the zip. */
  file: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
}

export interface BackupSession {
  session: ArchiveSession;
  body: string;
  /** Last autosave (milliseconds, from the editor) or 0 when the sbobina was never edited. */
  generation: number;
  audio?: BackupAudio;
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  created_at: string;
  app_version: string;
  sessions: BackupSession[];
  folders: ArchiveFolder[];
}

export interface BackupInfo {
  sessions: number;
  /** Bytes of the manifest without audio: documents, metadata, collections. */
  textBytes: number;
  audioBytes: number;
  audioFiles: number;
}

export interface BackupFile {
  blob: Blob;
  filename: string;
  sessions: number;
  audioFiles: number;
}

export interface ImportSummary {
  added: number;
  replaced: number;
  /** Already here and not newer in the backup: left as they are. */
  skipped: number;
  /** In the trash here: the backup brings them back to the archive. */
  restored: number;
  /** Sbobine written by the import: the Drive sync sends them. */
  changed: string[];
  audioFiles: number;
  folders: number;
}

interface ArchiveSnapshot {
  sessions: ArchiveSession[];
  documents: Map<string, StoredDocument>;
  folders: ArchiveFolder[];
  media: Map<string, StoredMedia>;
}

async function readArchive(factory: IDBFactory | undefined): Promise<ArchiveSnapshot> {
  return inTransaction(factory, [SESSIONS, DOCUMENTS, FOLDERS, MEDIA], 'readonly', async transaction => {
    const all = <T,>(store: string) => requestValue(transaction.objectStore(store).getAll() as IDBRequest<T[]>);
    const [sessions, documents, folders, media] = await Promise.all([
      all<ArchiveSession>(SESSIONS), all<StoredDocument>(DOCUMENTS), all<ArchiveFolder>(FOLDERS), all<StoredMedia>(MEDIA),
    ]);
    const linked = new Map<string, StoredMedia>();
    for (const record of media) if (record.sessionDir) linked.set(record.sessionDir, record);
    // The trash is not part of a backup: it holds what the user deleted.
    return {
      sessions: sessions.filter(session => !session.trashed_at).sort((a, b) => (b.completed_at_iso || '').localeCompare(a.completed_at_iso || '')),
      documents: new Map(documents.map(document => [document.session_dir, document])),
      folders,
      media: linked,
    };
  });
}

function manifestOf(snapshot: ArchiveSnapshot, appVersion: string, now: Date, audioFiles?: Map<string, BackupAudio>): BackupManifest {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    created_at: now.toISOString(),
    app_version: appVersion,
    sessions: snapshot.sessions.map(session => {
      const document = snapshot.documents.get(session.session_dir);
      const audio = audioFiles?.get(session.session_dir);
      return { session, body: document?.body ?? '', generation: document?.generation ?? 0, ...(audio ? { audio } : {}) };
    }),
    folders: snapshot.folders,
  };
}

const encoder = new TextEncoder();

/** What a backup would contain, for the sizes shown before downloading it. */
export async function describeBackup(factory: IDBFactory | undefined): Promise<BackupInfo> {
  const snapshot = await readArchive(factory);
  let audioBytes = 0;
  for (const session of snapshot.sessions) audioBytes += snapshot.media.get(session.session_dir)?.blob.size ?? 0;
  return {
    sessions: snapshot.sessions.length,
    textBytes: encoder.encode(JSON.stringify(manifestOf(snapshot, '', new Date(0)))).length,
    audioBytes,
    audioFiles: snapshot.sessions.filter(session => snapshot.media.has(session.session_dir)).length,
  };
}

function safeFileName(name: string): string {
  const printable = Array.from(name, char => (char.charCodeAt(0) < 32 ? '_' : char)).join('');
  return printable.replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'audio';
}

export function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `El-Sbobinator-backup-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}

export async function createBackup(
  factory: IDBFactory | undefined,
  options: { includeAudio: boolean; appVersion: string; now?: Date; onProgress?: (done: number, total: number) => void },
): Promise<BackupFile> {
  const now = options.now ?? new Date();
  const snapshot = await readArchive(factory);
  const audioFiles = new Map<string, BackupAudio>();
  const entries: Array<{ name: string; data: Blob; lastModified: number }> = [];
  if (options.includeAudio) {
    snapshot.sessions.forEach((session, index) => {
      const record = snapshot.media.get(session.session_dir);
      if (!record) return;
      const file = `audio/${String(index + 1).padStart(3, '0')}-${safeFileName(record.name)}`;
      audioFiles.set(session.session_dir, { file, name: record.name, type: record.type, size: record.blob.size, lastModified: record.lastModified });
      entries.push({ name: file, data: record.blob, lastModified: record.lastModified });
    });
  }
  const manifest = manifestOf(snapshot, options.appVersion, now, audioFiles);
  entries.unshift({ name: BACKUP_MANIFEST, data: new Blob([JSON.stringify(manifest)], { type: 'application/json' }), lastModified: now.getTime() });
  const blob = await createZip(entries, options.onProgress);
  return { blob, filename: backupFileName(now), sessions: snapshot.sessions.length, audioFiles: audioFiles.size };
}

const NOT_A_BACKUP = 'Il file scelto non è un backup di El Sbobinator.';

function parseManifest(text: string): BackupManifest {
  let manifest: Partial<BackupManifest>;
  try {
    manifest = JSON.parse(text) as Partial<BackupManifest>;
  } catch {
    throw new Error(`${NOT_A_BACKUP} (indice illeggibile)`);
  }
  if (manifest?.format !== BACKUP_FORMAT || typeof manifest.version !== 'number') throw new Error(NOT_A_BACKUP);
  if (manifest.version > BACKUP_VERSION) {
    throw new Error('Questo backup è stato creato da una versione più recente di El Sbobinator: ricarica la pagina per aggiornarla e riprova.');
  }
  return {
    ...manifest,
    sessions: Array.isArray(manifest.sessions) ? manifest.sessions : [],
    folders: Array.isArray(manifest.folders) ? manifest.folders : [],
  } as BackupManifest;
}

function isWebSession(entry: BackupSession | null | undefined): entry is BackupSession {
  const dir = entry?.session?.session_dir;
  return typeof dir === 'string' && dir.startsWith(WEB_SESSION_PREFIX) && dir.length > WEB_SESSION_PREFIX.length && !dir.includes('/', WEB_SESSION_PREFIX.length);
}

/**
 * Merges a backup into this browser's archive, one sbobina per transaction. Merge rule: a sbobina
 * not here is added; one already here (same id, e.g. a backup made on this device) is replaced
 * only when the backup holds a later edit of its text, otherwise it stays as it is. Nothing here
 * is ever deleted. A sbobina left as it is still gets the backup's audio if it has none.
 */
export async function importBackup(
  factory: IDBFactory | undefined,
  file: Blob,
  options: { onProgress?: (done: number, total: number) => void } = {},
): Promise<ImportSummary> {
  let entries;
  try {
    entries = await readZip(file);
  } catch (error) {
    if (error instanceof ZipFormatError) throw new Error(`${NOT_A_BACKUP} ${error.message}`, { cause: error });
    throw error;
  }
  const manifestEntry = entries.get(BACKUP_MANIFEST);
  if (!manifestEntry) throw new Error(NOT_A_BACKUP);
  const manifest = parseManifest(await (await manifestEntry.blob()).text());
  const items = manifest.sessions.filter(isWebSession);
  const summary: ImportSummary = { added: 0, replaced: 0, skipped: 0, restored: 0, audioFiles: 0, folders: 0, changed: [] };

  for (const [index, item] of items.entries()) {
    const dir = item.session.session_dir;
    const audioEntry = item.audio?.file ? entries.get(item.audio.file) : undefined;
    const audioBlob = audioEntry ? await audioEntry.blob() : null;
    const { trashed_at: _trashedAt, ...fields } = item.session;
    const session: ArchiveSession = { ...fields, html_path: webSessionHtmlPath(dir) };
    const generation = Number.isFinite(item.generation) ? Number(item.generation) : 0;
    const outcome = await inTransaction(factory, [SESSIONS, DOCUMENTS, MEDIA], 'readwrite', async transaction => {
      const sessions = transaction.objectStore(SESSIONS);
      const documents = transaction.objectStore(DOCUMENTS);
      const media = transaction.objectStore(MEDIA);
      const [local, document, localAudio] = await Promise.all([
        requestValue(sessions.get(dir) as IDBRequest<ArchiveSession | undefined>),
        requestValue(documents.get(dir) as IDBRequest<StoredDocument | undefined>),
        requestValue(media.index(MEDIA_BY_SESSION).getAllKeys(dir)),
      ]);
      const replace = local === undefined || generation > (document?.generation ?? 0);
      // A sbobina in the trash here comes back: importing a backup is asking for its sbobine.
      const restore = !replace && Boolean(local?.trashed_at);
      if (replace) {
        sessions.put(session);
        documents.put({ session_dir: dir, body: typeof item.body === 'string' ? item.body : '', generation } satisfies StoredDocument);
      } else if (restore && local) {
        const { trashed_at: _localTrashedAt, ...kept } = local;
        sessions.put(kept satisfies ArchiveSession);
      }
      const addAudio = audioBlob !== null && (replace || localAudio.length === 0);
      if (addAudio && item.audio) {
        for (const id of localAudio) media.delete(id);
        media.put({
          id: crypto.randomUUID(),
          name: item.audio.name || 'audio',
          type: item.audio.type || '',
          size: audioBlob.size,
          lastModified: item.audio.lastModified || Date.now(),
          blob: audioBlob,
          addedAt: Date.now(),
          sessionDir: dir,
        } satisfies StoredMedia);
      }
      return { kind: local === undefined ? 'added' as const : replace ? 'replaced' as const : restore ? 'restored' as const : 'skipped' as const, audio: addAudio };
    });
    summary[outcome.kind] += 1;
    if (outcome.kind !== 'skipped') summary.changed.push(dir);
    if (outcome.audio) summary.audioFiles += 1;
    options.onProgress?.(index + 1, items.length);
  }

  // Collections: new ones are added, existing ones (same id) gain the sbobine of the backup. A
  // sbobina stays in one collection: where it already is here wins.
  summary.folders = await inTransaction(factory, [FOLDERS, SESSIONS], 'readwrite', async transaction => {
    const store = transaction.objectStore(FOLDERS);
    const [localFolders, sessionKeys] = await Promise.all([
      requestValue(store.getAll() as IDBRequest<ArchiveFolder[]>),
      requestValue(transaction.objectStore(SESSIONS).getAllKeys()),
    ]);
    const existing = new Set(sessionKeys.map(String));
    const byId = new Map(localFolders.map(folder => [folder.id, { ...folder, session_dirs: [...(folder.session_dirs ?? [])] }]));
    const placed = new Set(localFolders.flatMap(folder => folder.session_dirs ?? []));
    let added = 0;
    for (const folder of manifest.folders) {
      if (typeof folder?.id !== 'string' || !folder.id) continue;
      let target = byId.get(folder.id);
      if (!target) {
        target = { id: folder.id, name: String(folder.name ?? 'Raccolta'), color: String(folder.color ?? ''), parent_id: folder.parent_id ?? null, session_dirs: [] };
        byId.set(folder.id, target);
        added += 1;
      }
      for (const dir of Array.isArray(folder.session_dirs) ? folder.session_dirs : []) {
        if (typeof dir !== 'string' || placed.has(dir) || !existing.has(dir)) continue;
        target.session_dirs.push(dir);
        placed.add(dir);
      }
    }
    for (const folder of byId.values()) store.put(folder);
    return added;
  });
  return summary;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function describeImport(summary: ImportSummary): string {
  const parts: string[] = [];
  if (summary.added) parts.push(`${plural(summary.added, 'sbobina aggiunta', 'sbobine aggiunte')}`);
  if (summary.replaced) parts.push(`${plural(summary.replaced, 'sostituita con la versione più recente del backup', 'sostituite con la versione più recente del backup')}`);
  if (summary.restored) parts.push(`${plural(summary.restored, 'ripresa dal cestino', 'riprese dal cestino')}`);
  if (summary.skipped) parts.push(`${plural(summary.skipped, 'già presente e lasciata com’era', 'già presenti e lasciate com’erano')}`);
  if (summary.audioFiles) parts.push(`${plural(summary.audioFiles, 'audio importato', 'audio importati')}`);
  if (summary.folders) parts.push(`${plural(summary.folders, 'raccolta nuova', 'raccolte nuove')}`);
  return parts.length ? `${parts.join(', ')}.` : 'Il backup non contiene sbobine.';
}

/** When this browser last downloaded a backup (ISO date), or null. */
export function loadLastBackupAt(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.WEB_LAST_BACKUP_V1);
  } catch {
    return null;
  }
}

export function saveLastBackupAt(iso: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.WEB_LAST_BACKUP_V1, iso);
  } catch {
    // Only the "last backup" line is lost.
  }
}

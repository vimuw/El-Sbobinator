import type { FileItem } from './appState';
import type { ArchiveSession } from './bridge';
import { WEB_FILE_PREFIX } from './web/webFiles';

type ArchiveLookup = {
  byPath: Map<string, ArchiveSession[]>;
  byMeta: Map<string, ArchiveSession[]>;
  byNameSize: Map<string, ArchiveSession[]>;
};

function normalizeKey(value?: string): string {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * The web build gives every picked file a fresh local://<uuid>/<name> path and learns its duration only
 * while processing it, so neither the path nor the duration can recognize the same audio picked again.
 */
export function isWebLocalPath(path?: string): boolean {
  return normalizeKey(path).startsWith(WEB_FILE_PREFIX);
}

/** name::size key for a picked web file, or null when it is not a web file with a known size. */
export function webNameSizeKey(file: Pick<FileItem, 'name' | 'path' | 'size'>): string | null {
  const size = Number(file.size ?? 0);
  if (!isWebLocalPath(file.path) || size <= 0) return null;
  return `${normalizeKey(file.name)}::${size}`;
}

function archiveInputName(session: ArchiveSession): string {
  return session.input_name ?? (session.input_path.split(/[/\\]/).pop() || session.name);
}

function archiveMetaKey(session: ArchiveSession): string | null {
  const size = Number(session.input_size ?? 0);
  const dur = Math.round(Number(session.duration_sec ?? 0));
  if (size <= 0 || dur <= 0) return null;
  return `${normalizeKey(archiveInputName(session))}::${size}::${dur}`;
}

function archiveNameSizeKey(session: ArchiveSession): string | null {
  const size = Number(session.input_size ?? 0);
  if (size <= 0) return null;
  return `${normalizeKey(archiveInputName(session))}::${size}`;
}

function pushToBucket(map: Map<string, ArchiveSession[]>, key: string, session: ArchiveSession): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(session);
  else map.set(key, [session]);
}

export function filterArchiveSessionsByInputPath(
  inputPath: string | undefined,
  archiveSessions: Iterable<ArchiveSession>,
): ArchiveSession[] {
  const normalizedPath = normalizeKey(inputPath);
  if (!normalizedPath) return [];

  const matches: ArchiveSession[] = [];
  const seenSessionDirs = new Set<string>();

  for (const session of archiveSessions) {
    if (normalizeKey(session.input_path) !== normalizedPath) continue;
    if (seenSessionDirs.has(session.session_dir)) continue;
    seenSessionDirs.add(session.session_dir);
    matches.push(session);
  }

  return matches;
}

export function buildArchiveLookup(archiveSessions: ArchiveSession[]): ArchiveLookup {
  const byPath = new Map<string, ArchiveSession[]>();
  const byMeta = new Map<string, ArchiveSession[]>();
  const byNameSize = new Map<string, ArchiveSession[]>();

  for (const session of archiveSessions) {
    const normalizedPath = normalizeKey(session.input_path);
    if (normalizedPath) pushToBucket(byPath, normalizedPath, session);

    const mk = archiveMetaKey(session);
    if (mk) pushToBucket(byMeta, mk, session);

    const nk = archiveNameSizeKey(session);
    if (nk) pushToBucket(byNameSize, nk, session);
  }

  return { byPath, byMeta, byNameSize };
}

export function getArchiveMatchesForFile(
  file: Pick<FileItem, 'name' | 'path' | 'size' | 'duration'>,
  archiveLookup: ArchiveLookup,
): ArchiveSession[] {
  const normalizedPath = normalizeKey(file.path);
  if (normalizedPath) {
    const pathMatches = filterArchiveSessionsByInputPath(normalizedPath, archiveLookup.byPath.get(normalizedPath) ?? []);
    if (pathMatches.length > 0) return pathMatches;
  }

  const size = Number(file.size ?? 0);
  const dur = Math.round(Number(file.duration ?? 0));
  if (size > 0 && dur > 0) {
    const mk = `${normalizeKey(file.name)}::${size}::${dur}`;
    const metaMatches = archiveLookup.byMeta.get(mk);
    if (metaMatches && metaMatches.length > 0) return metaMatches;
  }

  const webKey = webNameSizeKey(file);
  if (webKey) {
    // Same name and exact byte size; a duration known on both sides must agree too.
    const webMatches = (archiveLookup.byNameSize.get(webKey) ?? []).filter(session => {
      const sessionDur = Math.round(Number(session.duration_sec ?? 0));
      return dur <= 0 || sessionDur <= 0 || sessionDur === dur;
    });
    if (webMatches.length > 0) return webMatches;
  }

  return [];
}

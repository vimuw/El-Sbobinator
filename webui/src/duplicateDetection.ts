import type { FileItem } from './appState';
import type { ArchiveSession } from './bridge';

type ArchiveLookup = {
  byPath: Map<string, ArchiveSession[]>;
};

function normalizeKey(value?: string): string {
  return String(value ?? '').trim().toLowerCase();
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

  for (const session of archiveSessions) {
    const normalizedPath = normalizeKey(session.input_path);
    if (!normalizedPath) continue;

    const pathBucket = byPath.get(normalizedPath);
    if (pathBucket) pathBucket.push(session);
    else byPath.set(normalizedPath, [session]);
  }

  return { byPath };
}

export function getArchiveMatchesForFile(
  file: Pick<FileItem, 'name' | 'path'>,
  archiveLookup: ArchiveLookup,
): ArchiveSession[] {
  const normalizedPath = normalizeKey(file.path);
  return normalizedPath
    ? filterArchiveSessionsByInputPath(normalizedPath, archiveLookup.byPath.get(normalizedPath) ?? [])
    : [];
}

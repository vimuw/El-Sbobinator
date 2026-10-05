import type { ArchiveFolder } from './bridge';
import { normalizeSessionPath } from './utils';

export const NEUTRAL_FOLDER_COLOR = '#94A3B8';

/** Invalid legacy links remain visible at the archive root. */
export function getFolderParentId(folder: ArchiveFolder, folders: ArchiveFolder[]): string | null {
  const byId = new Map(folders.map(item => [item.id, item]));
  const seen = new Set([folder.id]);
  let parentId = folder.parent_id;
  while (parentId) {
    if (seen.has(parentId)) return null;
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) return parentId === folder.parent_id ? null : folder.parent_id ?? null;
    parentId = parent.parent_id;
  }
  return folder.parent_id ?? null;
}

export function getFolderPath(folder: ArchiveFolder, folders: ArchiveFolder[]): ArchiveFolder[] {
  const path = [folder];
  let current = folder;
  let parentId = getFolderParentId(current, folders);
  while (parentId) {
    current = folders.find(item => item.id === parentId)!;
    path.unshift(current);
    parentId = getFolderParentId(current, folders);
  }
  return path;
}

export function getFolderColor(folder: ArchiveFolder, folders: ArchiveFolder[]): string {
  return getFolderPath(folder, folders).reverse().find(item => item.color)?.color || NEUTRAL_FOLDER_COLOR;
}

export function getFolderPresentation(folder: ArchiveFolder, folders: ArchiveFolder[]) {
  const path = getFolderPath(folder, folders).map(item => item.name);
  return { ...folder, color: getFolderColor(folder, folders), displayName: path.slice(-2).join(' › '), fullPath: path.join(' › ') };
}

export function getFolderChildren(folders: ArchiveFolder[], parentId: string | null): ArchiveFolder[] {
  return folders.filter(folder => getFolderParentId(folder, folders) === parentId);
}

export function getFolderSubtreeIds(folder: ArchiveFolder, folders: ArchiveFolder[]): Set<string> {
  return new Set(folders.filter(item => getFolderPath(item, folders).some(ancestor => ancestor.id === folder.id)).map(item => item.id));
}

export function getFolderSessionDirs(folder: ArchiveFolder, folders: ArchiveFolder[]): string[] {
  const ids = getFolderSubtreeIds(folder, folders);
  const dirs = new Map<string, string>();
  for (const item of [folder, ...folders.filter(item => item.id !== folder.id && ids.has(item.id))]) {
    for (const dir of item.session_dirs) dirs.set(normalizeSessionPath(dir), dir);
  }
  return [...dirs.values()];
}

export function moveSessionsToFolder(folders: ArchiveFolder[], dirs: string[], targetId: string | null): ArchiveFolder[] {
  if (targetId && !folders.some(folder => folder.id === targetId)) return folders;
  const targets = new Map(dirs.map(dir => [normalizeSessionPath(dir), dir]));
  return folders.map(folder => {
    const retained = folder.session_dirs.filter(dir => folder.id === targetId || !targets.has(normalizeSessionPath(dir)));
    const existing = new Set(retained.map(normalizeSessionPath));
    const incoming = [...targets].filter(([normalized]) => !existing.has(normalized)).map(([, dir]) => dir);
    return { ...folder, session_dirs: folder.id === targetId ? [...retained, ...incoming] : retained };
  });
}

export function moveFolder(folders: ArchiveFolder[], folderId: string, targetId: string | null): ArchiveFolder[] {
  const folder = folders.find(item => item.id === folderId);
  if (!folder || (targetId && (!folders.some(item => item.id === targetId) || getFolderSubtreeIds(folder, folders).has(targetId)))) return folders;
  return folders.map(item => item.id === folderId ? { ...item, parent_id: targetId } : item);
}

/** Removing a collection promotes its contents instead of deleting them. */
export function deleteFolder(folders: ArchiveFolder[], folderId: string): ArchiveFolder[] {
  const folder = folders.find(item => item.id === folderId);
  if (!folder) return folders;
  const parentId = getFolderParentId(folder, folders);
  const remaining = folders.filter(item => item.id !== folderId).map(item =>
    getFolderParentId(item, folders) === folderId ? { ...item, parent_id: parentId } : item);
  return parentId ? moveSessionsToFolder(remaining, folder.session_dirs, parentId) : remaining;
}

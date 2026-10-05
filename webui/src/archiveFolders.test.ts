import { describe, expect, it } from 'vitest';
import type { ArchiveFolder } from './bridge';
import { deleteFolder, getFolderChildren, getFolderColor, getFolderParentId, getFolderPath, getFolderPresentation, getFolderSessionDirs, moveFolder, moveSessionsToFolder, NEUTRAL_FOLDER_COLOR } from './archiveFolders';

const folders: ArchiveFolder[] = [
  { id: 'year', name: '3° anno', color: '', session_dirs: [] },
  { id: 'semester', name: '2° semestre', color: '', parent_id: 'year', session_dirs: ['/s/intro'] },
  { id: 'course', name: 'Microbiologia', color: '#4D96FF', parent_id: 'semester', session_dirs: ['/s/course'] },
  { id: 'module', name: 'Modulo 1', color: '', parent_id: 'course', session_dirs: ['/s/module'] },
  { id: 'other', name: 'Immunologia', color: '#FF6B6B', session_dirs: [] },
];

describe('archive collection hierarchy', () => {
  it('keeps legacy collections at the root and builds optional paths', () => {
    expect(getFolderChildren(folders, null).map(folder => folder.id)).toEqual(['year', 'other']);
    expect(getFolderPath(folders[3], folders).map(folder => folder.name)).toEqual(['3° anno', '2° semestre', 'Microbiologia', 'Modulo 1']);
  });
  it('inherits the nearest explicit color, with a neutral root', () => {
    expect(getFolderColor(folders[0], folders)).toBe(NEUTRAL_FOLDER_COLOR);
    expect(getFolderColor(folders[3], folders)).toBe('#4D96FF');
    expect(getFolderPresentation(folders[3], folders)).toMatchObject({ displayName: 'Microbiologia › Modulo 1', fullPath: '3° anno › 2° semestre › Microbiologia › Modulo 1', color: '#4D96FF' });
  });
  it('updates automatic colors after moving, while preserving explicit colors', () => {
    const moved = moveFolder(folders, 'module', 'other');
    expect(getFolderColor(moved[3], moved)).toBe('#FF6B6B');
    const courseMoved = moveFolder(folders, 'course', 'other');
    expect(getFolderColor(courseMoved[2], courseMoved)).toBe('#4D96FF');
    expect(getFolderPath(courseMoved[3], courseMoved).map(folder => folder.id)).toEqual(['other', 'course', 'module']);
  });
  it('counts subtree sessions once using normalized paths', () => {
    const duplicate = { ...folders[3], session_dirs: ['/s/module', '/S/COURSE/'] };
    expect(getFolderSessionDirs(folders[1], [...folders.slice(0, 3), duplicate, folders[4]])).toHaveLength(3);
    expect(getFolderSessionDirs(folders[1], folders)).toEqual(['/s/intro', '/s/course', '/s/module']);
  });
  it('prevents moving a collection into itself, a descendant or a missing destination', () => {
    expect(moveFolder(folders, 'course', 'course')).toBe(folders);
    expect(moveFolder(folders, 'year', 'module')).toBe(folders);
    expect(moveFolder(folders, 'course', 'missing')).toBe(folders);
    expect(moveFolder(folders, 'missing', null)).toBe(folders);
  });
  it('moves a module up to the archive without copying its lessons', () => {
    const moved = moveFolder(folders, 'module', null);
    expect(moved[3].parent_id).toBeNull();
    expect(moved[3].session_dirs).toEqual(['/s/module']);
    expect(getFolderChildren(moved, null).map(folder => folder.id)).toContain('module');
  });
  it('moves sessions down, up and outside collections with unique membership', () => {
    expect(moveSessionsToFolder(folders, ['/S/INTRO/'], 'semester')).toEqual(folders);
    const down = moveSessionsToFolder(folders, ['/s/course', '/S/COURSE/'], 'module');
    expect(down[2].session_dirs).toEqual([]);
    expect(down[3].session_dirs).toHaveLength(2);
    const up = moveSessionsToFolder(down, ['/s/module'], 'course');
    expect(up[2].session_dirs).toEqual(['/s/module']);
    expect(up[3].session_dirs).not.toContain('/s/module');
    const root = moveSessionsToFolder(up, ['/s/module'], null);
    expect(root.every(folder => !folder.session_dirs.includes('/s/module'))).toBe(true);
    expect(moveSessionsToFolder(folders, ['/s/course'], 'missing')).toBe(folders);
  });
  it('promotes children and direct lessons when deleting a nested collection', () => {
    const updated = deleteFolder(folders, 'course');
    expect(updated.find(folder => folder.id === 'module')?.parent_id).toBe('semester');
    expect(updated.find(folder => folder.id === 'module')?.session_dirs).toEqual(['/s/module']);
    expect(updated.find(folder => folder.id === 'semester')?.session_dirs).toEqual(['/s/intro', '/s/course']);
  });
  it('keeps child collections when deleting a root, leaving direct lessons unassigned', () => {
    const updated = deleteFolder(folders, 'year');
    expect(updated.find(folder => folder.id === 'semester')?.parent_id).toBeNull();
    expect(updated.find(folder => folder.id === 'course')?.parent_id).toBe('semester');
    expect(deleteFolder(folders, 'missing')).toBe(folders);
  });
  it('keeps broken or cyclic saved collections visible without infinite traversal', () => {
    const invalid: ArchiveFolder[] = [
      { ...folders[0], parent_id: 'missing' },
      { ...folders[1], parent_id: 'course' },
      { ...folders[2], parent_id: 'semester' },
      { ...folders[3], parent_id: 'year' },
    ];
    expect(getFolderChildren(invalid, null).map(folder => folder.id)).toEqual(['year', 'semester', 'course']);
    expect(getFolderParentId(invalid[3], invalid)).toBe('year');
    expect(getFolderPath(invalid[3], invalid).map(folder => folder.id)).toEqual(['year', 'module']);
  });
});

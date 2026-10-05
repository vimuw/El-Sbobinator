import type { ArchiveFolder } from '../bridge';
import { getFolderColor, getFolderPath, NEUTRAL_FOLDER_COLOR } from '../archiveFolders';

// Tiny shared chip — kept separate so QueueFileCard can import it
// without creating a QueueFileCard → ArchivePage circular dependency.
export function FolderIndicatorChip({ folder, folders, relativeTo }: { folder: Pick<ArchiveFolder, 'name' | 'color'> & Partial<Pick<ArchiveFolder, 'id' | 'parent_id'>> & { displayName?: string; fullPath?: string }; folders?: ArchiveFolder[]; relativeTo?: string }) {
  const fullFolder = folders?.find(item => item.id === folder.id);
  const path = fullFolder && folders ? getFolderPath(fullFolder, folders) : [folder];
  const folderColor = fullFolder && folders ? getFolderColor(fullFolder, folders) : folder.color || NEUTRAL_FOLDER_COLOR;
  const contextualPath = relativeTo ? path.slice(path.findIndex(item => item.id === relativeTo) + 1) : path;
  const label = folder.displayName ?? (contextualPath.length ? contextualPath : [folder]).slice(-2).map(item => item.name).join(' › ');
  return (
    <span
      className="folder-indicator-chip"
      style={{ '--folder-color': folderColor } as React.CSSProperties}
      title={`Raccolta: ${folder.fullPath ?? path.map(item => item.name).join(' › ')}`}
    >
      <span className="folder-color-dot is-small" />
      <span>{label}</span>
    </span>
  );
}

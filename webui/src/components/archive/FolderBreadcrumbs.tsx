import { ChevronRight } from 'lucide-react';
import type { ArchiveFolder } from '../../bridge';
import { getFolderPath } from '../../archiveFolders';

export function FolderBreadcrumbs({ folder, folders, onNavigate }: {
  folder?: ArchiveFolder;
  folders: ArchiveFolder[];
  onNavigate: (id: string | null) => void;
}) {
  return (
    <nav aria-label="Percorso della raccolta" className="flex flex-wrap items-center gap-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      <button type="button" onClick={() => onNavigate(null)} className="px-1 py-1 rounded hover:bg-[var(--bg-hover)] cursor-pointer">Archivio</button>
      {folder && getFolderPath(folder, folders).map(item => (
        <span key={item.id} className="inline-flex items-center gap-1 min-w-0">
          <ChevronRight className="w-3 h-3 shrink-0" aria-hidden="true" />
          <button type="button" onClick={() => onNavigate(item.id)} aria-current={item.id === folder.id ? 'page' : undefined}
            className="px-1 py-1 rounded [overflow-wrap:anywhere] text-left hover:bg-[var(--bg-hover)] cursor-pointer"
            style={item.id === folder.id ? { color: 'var(--text-primary)' } : undefined}>{item.name}</button>
        </span>
      ))}
    </nav>
  );
}

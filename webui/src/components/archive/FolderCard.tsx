import { useMemo } from 'react';
import { FolderPlus, Pencil, Trash2, FolderInput } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { normalizeSessionPath } from '../../utils';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FolderCardTitle } from './FolderCardTitle';
import { getFolderChildren, getFolderColor, getFolderSessionDirs } from '../../archiveFolders';

export interface FolderCardProps {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
  allFolders?: ArchiveFolder[];
  onMove?: () => void;
}

export function FolderCard({
  folder,
  sessionsByDir,
  onNavigate,
  onEdit,
  onDelete,
  allFolders = [folder],
  onMove,
}: FolderCardProps) {
  const count = useMemo(
    () => getFolderSessionDirs(folder, allFolders).filter(d => sessionsByDir.has(normalizeSessionPath(d))).length,
    [folder, allFolders, sessionsByDir],
  );
  const childCount = getFolderChildren(allFolders, folder.id).length;

  const kebabItems: KebabMenuItem[] = [
    ...(onMove ? [{ label: 'Sposta in…', icon: <FolderInput className="w-3.5 h-3.5" />, onClick: onMove }] : []),
    {
      label: 'Modifica',
      icon: <Pencil className="w-3.5 h-3.5" />,
      onClick: onEdit,
    },
    {
      label: 'Elimina',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <div
      className="folder-card cursor-pointer group/folder"
      style={{ '--folder-color': getFolderColor(folder, allFolders) } as React.CSSProperties}
      onClick={onNavigate}
    >
      <div className="grid grid-cols-[16px_minmax(0,1fr)_36px] gap-x-3 gap-y-2 px-4 py-3">
        <span className="folder-color-dot is-large mt-0.5" />
        <FolderCardTitle name={folder.name} onNavigate={onNavigate} />
        <div className="shrink-0 -my-2" onClick={e => e.stopPropagation()}>
          <KebabMenu items={kebabItems} />
        </div>
        <p className="col-start-2 col-span-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {childCount > 0 && `${childCount} ${childCount === 1 ? 'raccolta' : 'raccolte'} · `}
          {count === 1 ? '1 lezione' : `${count} lezioni`}
        </p>
      </div>
    </div>
  );
}

export function SortableFolderCard({
  folder,
  sessionsByDir,
  onNavigate,
  onEdit,
  onDelete,
  allFolders,
  onMove,
}: FolderCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: folder.id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px,${transform.y}px,0) scaleX(${transform.scaleX}) scaleY(${transform.scaleY})` : undefined,
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      {...attributes}
      {...listeners}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter') { event.preventDefault(); onNavigate(); }
        else listeners?.onKeyDown?.(event);
      }}
    >
      <FolderCard
        folder={folder}
        sessionsByDir={sessionsByDir}
        onNavigate={onNavigate}
        onEdit={onEdit}
        onDelete={onDelete}
        allFolders={allFolders}
        onMove={onMove}
      />
    </div>
  );
}

export function FolderCardOverlay({
  folder,
  sessionsByDir,
  allFolders = [folder],
}: {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  allFolders?: ArchiveFolder[];
}) {
  const count = getFolderSessionDirs(folder, allFolders).filter(d => sessionsByDir.has(normalizeSessionPath(d))).length;
  return (
    <div
      className="folder-card opacity-95 pointer-events-none cursor-grabbing"
      style={{
        '--folder-color': getFolderColor(folder, allFolders),
        boxShadow: 'var(--shadow-strong)',
      } as React.CSSProperties}
    >
      <div className="grid grid-cols-[16px_minmax(0,1fr)_36px] gap-x-3 gap-y-2 px-4 py-3">
        <span className="folder-color-dot is-large mt-0.5" />
        <span className="folder-card-title flex-1 min-w-0 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {folder.name}
        </span>
        <div className="compact-icon-button shrink-0 -my-2" aria-hidden="true" />
        <p className="col-start-2 col-span-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          {count === 1 ? '1 lezione' : `${count} lezioni`}
        </p>
      </div>
    </div>
  );
}

export function NewFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="folder-card folder-card-new cursor-pointer w-full text-left group/newfolder"
    >
      <FolderPlus className="w-5 h-5 transition-transform duration-200 group-hover/newfolder:scale-105" style={{ color: 'var(--accent-text)' }} />
      <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>Nuova raccolta</span>
    </button>
  );
}

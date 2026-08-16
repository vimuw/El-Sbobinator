import { useMemo, useState } from 'react';
import { FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';

export interface FolderCardProps {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function FolderCard({
  folder,
  sessionsByDir,
  onNavigate,
  onEdit,
  onDelete,
}: FolderCardProps) {
  const [isHover, setIsHover] = useState(false);

  const count = useMemo(
    () => folder.session_dirs.filter(d => sessionsByDir.has(d)).length,
    [folder.session_dirs, sessionsByDir],
  );

  const kebabItems: KebabMenuItem[] = [
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
      className="folder-card"
      style={{
        border: `2px solid ${isHover ? `${folder.color}90` : `${folder.color}40`}`,
        background: `${folder.color}26`,
        cursor: 'pointer',
      }}
      onClick={onNavigate}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
    >
      <div className="flex items-center gap-3 px-4 pt-3 pb-1">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: folder.color }} />
        <span className="flex-1 text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {folder.name}
        </span>
        <div onClick={e => e.stopPropagation()}>
          <KebabMenu items={kebabItems} />
        </div>
      </div>
      <div className="px-4 pb-3">
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
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
    >
      <FolderCard
        folder={folder}
        sessionsByDir={sessionsByDir}
        onNavigate={onNavigate}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </div>
  );
}

export function FolderCardOverlay({
  folder,
  sessionsByDir,
}: {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
}) {
  const count = folder.session_dirs.filter(d => sessionsByDir.has(d)).length;
  return (
    <div
      className="folder-card"
      style={{
        border: `2px solid ${folder.color}90`,
        background: `${folder.color}26`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        opacity: 0.95,
        pointerEvents: 'none',
        cursor: 'grabbing',
      }}
    >
      <div className="flex items-center gap-3 px-4 pt-3 pb-1">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: folder.color }} />
        <span className="flex-1 text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
          {folder.name}
        </span>
      </div>
      <div className="px-4 pb-3">
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
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
      className="folder-card folder-card-new cursor-pointer w-full text-left"
    >
      <FolderPlus className="w-5 h-5" style={{ color: 'var(--accent-text)' }} />
      <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>Nuova raccolta</span>
    </button>
  );
}

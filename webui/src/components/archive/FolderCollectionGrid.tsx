import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { getFolderChildren } from '../../archiveFolders';
import { FolderCardOverlay, SortableFolderCard } from './FolderCard';

export function FolderCollectionGrid({ folders, parentId, sessionsByDir, onNavigate, onCreate, onEdit, onDelete, onMove, onFoldersChange }: {
  folders: ArchiveFolder[];
  parentId: string | null;
  sessionsByDir: Map<string, ArchiveSession>;
  onNavigate: (id: string) => void;
  onCreate: () => void;
  onEdit: (folder: ArchiveFolder) => void;
  onDelete: (folder: ArchiveFolder) => void;
  onMove: (folder: ArchiveFolder) => void;
  onFoldersChange: (folders: ArchiveFolder[]) => void;
}) {
  const children = getFolderChildren(folders, parentId);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const dragged = children.find(folder => folder.id === draggedId);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggedId(null);
    if (!over || active.id === over.id) return;
    const from = children.findIndex(folder => folder.id === active.id);
    const to = children.findIndex(folder => folder.id === over.id);
    if (from < 0 || to < 0) return;
    const ordered = arrayMove(children, from, to);
    const ids = new Set(children.map(folder => folder.id));
    let index = 0;
    onFoldersChange(folders.map(folder => ids.has(folder.id) ? ordered[index++] : folder));
  };
  return (
    <section className="flex flex-col gap-3" aria-label="Raccolte">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Raccolte</span>
        <button type="button" onClick={onCreate} className="archive-action-button is-collection-create"><FolderPlus className="w-3.5 h-3.5" />Nuova raccolta</button>
      </div>
      <DndContext sensors={sensors} onDragStart={event => setDraggedId(String(event.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setDraggedId(null)}>
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 250px), 1fr))' }}>
          <SortableContext items={children.map(folder => folder.id)} strategy={rectSortingStrategy}>
            {children.map(folder => <SortableFolderCard key={folder.id} folder={folder} allFolders={folders} sessionsByDir={sessionsByDir}
              onNavigate={() => onNavigate(folder.id)} onEdit={() => onEdit(folder)} onDelete={() => onDelete(folder)} onMove={() => onMove(folder)} />)}
          </SortableContext>
        </div>
        <DragOverlay>{dragged && <FolderCardOverlay folder={dragged} allFolders={folders} sessionsByDir={sessionsByDir} />}</DragOverlay>
      </DndContext>
    </section>
  );
}

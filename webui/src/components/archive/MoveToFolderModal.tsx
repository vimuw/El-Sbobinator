import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronRight, FolderPlus, X } from 'lucide-react';
import type { ArchiveFolder } from '../../bridge';
import { getFolderChildren, getFolderColor, getFolderSubtreeIds } from '../../archiveFolders';
import { FolderBreadcrumbs } from './FolderBreadcrumbs';

export function MoveToFolderModal({ folders, movingFolderId, initialParentId = null, onClose, onConfirm }: {
  folders: ArchiveFolder[];
  movingFolderId?: string;
  initialParentId?: string | null;
  onClose: () => void;
  onConfirm: (targetId: string | null, createdFolders: ArchiveFolder[]) => void;
}) {
  const [parentId, setParentId] = useState(initialParentId);
  const [created, setCreated] = useState<ArchiveFolder[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const allFolders = [...folders, ...created];
  const current = allFolders.find(folder => folder.id === parentId);
  const destinationId = current?.id ?? null;
  const movingFolder = allFolders.find(folder => folder.id === movingFolderId);
  const excluded = movingFolder ? getFolderSubtreeIds(movingFolder, allFolders) : new Set<string>();
  const children = getFolderChildren(allFolders, destinationId).filter(folder => !excluded.has(folder.id));

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/') event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(closeRef.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => { window.removeEventListener('keydown', handler, true); previous?.focus(); };
  }, []);

  return (
    <motion.div className="fixed inset-0 z-[60] flex items-center justify-center p-4" exit={{ opacity: 0 }}>
      <div className="modal-overlay absolute inset-0" />
      <div role="dialog" aria-modal="true" aria-labelledby="move-folder-title" className="modal-card relative w-full max-w-md max-h-[86vh] overflow-hidden flex flex-col">
        <div className="modal-header">
          <h2 id="move-folder-title" className="text-lg font-semibold">Sposta in…</h2>
          <button ref={closeRef} type="button" onClick={onClose} className="icon-button modal-icon-button" aria-label="Chiudi finestra"><X className="w-4 h-4" /></button>
        </div>
        <div className="modal-body overflow-y-auto app-scroll space-y-3">
          <FolderBreadcrumbs folder={current} folders={allFolders} onNavigate={id => { setParentId(id); setCreating(false); }} />
          <div className="flex flex-col gap-1">
            {children.map(folder => (
              <button key={folder.id} type="button" onClick={() => { setParentId(folder.id); setCreating(false); }} className="flex items-center gap-3 w-full text-left rounded-lg px-3 py-3 hover:bg-[var(--bg-hover)] cursor-pointer">
                <span className="folder-color-dot is-small shrink-0" style={{ '--folder-color': getFolderColor(folder, allFolders) } as React.CSSProperties} />
                <span className="flex-1 min-w-0 [overflow-wrap:anywhere] text-sm">{folder.name}</span><ChevronRight className="w-4 h-4 shrink-0" />
              </button>
            ))}
            {!children.length && <p className="text-sm py-2" style={{ color: 'var(--text-muted)' }}>Nessuna sottoraccolta.</p>}
          </div>
          {creating ? (
            <form className="flex flex-wrap gap-2" onSubmit={event => {
              event.preventDefault(); if (!name.trim()) return;
              const folder = { id: crypto.randomUUID(), name: name.trim(), color: '', parent_id: destinationId, session_dirs: [] };
              setCreated([...created, folder]); setParentId(folder.id); setCreating(false); setName('');
            }}>
              <label htmlFor="move-new-folder-name" className="sr-only">Nome raccolta</label>
              <input id="move-new-folder-name" autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={48} placeholder="Nome raccolta" className="app-input flex-1 min-w-0" />
              <button type="submit" disabled={!name.trim()} className="modal-action-button">Crea</button>
              <button type="button" onClick={() => setCreating(false)} className="modal-action-button">Annulla</button>
            </form>
          ) : <button type="button" onClick={() => setCreating(true)} className="flex items-center gap-2 text-sm py-2 cursor-pointer" style={{ color: 'var(--accent-text)' }}><FolderPlus className="w-4 h-4" />Nuova raccolta…</button>}
          <p className="text-xs [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>Destinazione: {current?.name ?? 'Archivio (senza raccolta)'}</p>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={onClose} className="modal-action-button flex-1">Annulla</button>
          <button type="button" disabled={creating || (destinationId !== null && excluded.has(destinationId))} onClick={() => onConfirm(destinationId, created)} className="modal-action-button is-primary flex-1">Sposta qui</button>
        </div>
      </div>
    </motion.div>
  );
}

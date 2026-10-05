import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, FileSearch, FileText,
  Loader2, Pencil, Plus, Search, Trash2, X, FolderInput,
} from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { ArchiveFolder, ArchiveSession, SearchSessionResult } from '../../bridge';
import type { EditorSession } from '../../editorSessions';
import { normalizeSessionPath } from '../../utils';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FullTextResultList } from './FullTextResults';
import { FolderSessionCardOverlay, SortableSessionCard } from './SessionCard';
import { ArchiveSelectionBar } from './ArchiveSelectionBar';
import { AddSessionsToFolderModal } from './AddSessionsToFolderModal';
import { type ArchivePageProps } from './types';
import { getFolderColor, getFolderSessionDirs } from '../../archiveFolders';
import { FolderBreadcrumbs } from './FolderBreadcrumbs';
import { FolderIndicatorChip } from '../FolderChip';

export interface FolderDetailViewProps {
  folder: ArchiveFolder;
  allFolders?: ArchiveFolder[];
  sessionsByDir: Map<string, ArchiveSession>;
  editorSessionsMap?: Record<string, EditorSession>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemoveSession: (dir: string) => void;
  onRemoveMultipleSessions?: (dirs: string[]) => void;
  onAddSession: (dir: string) => void;
  onAddMultipleSessions?: (dirs: string[]) => void;
  onReorderSessions: (dirs: string[]) => void;
  onAssignMultipleToFolder?: (dirs: string[], targetFolderId: string) => void;
  onNewFolder?: () => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onDeleteMultipleSessions?: ArchivePageProps['onDeleteMultipleSessions'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
  onShareSession?: (session: ArchiveSession) => void;
  onNavigate?: (id: string | null) => void;
  collectionGrid?: React.ReactNode;
  onMove?: () => void;
  onMoveSessions?: (dirs: string[], onComplete?: () => void) => void;
}

export function FolderDetailView({
  folder,
  allFolders,
  sessionsByDir,
  editorSessionsMap,
  onBack,
  onEdit,
  onDelete,
  onRemoveSession,
  onRemoveMultipleSessions,
  onAddSession,
  onAddMultipleSessions,
  onReorderSessions,
  onAssignMultipleToFolder,
  onNewFolder,
  onPreview,
  onOpenFile,
  onDeleteSession,
  onDeleteMultipleSessions,
  onRetryFailedRevisionBlocks,
  onShareSession,
  onNavigate,
  collectionGrid,
  onMove,
  onMoveSessions,
}: FolderDetailViewProps) {
  const [search, setSearch] = useState('');
  const [fullTextMode, setFullTextMode] = useState(false);
  const [ftResults, setFtResults] = useState<SearchSessionResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ftError, setFtError] = useState<string | null>(null);
  const searchGenRef = useRef(0);
  const ftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedFolderSessionDirs, setSelectedFolderSessionDirs] = useState<Set<string>>(new Set());

  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const [folderSearchFocused, setFolderSearchFocused] = useState(false);

  const scopedDirs = useMemo(() => getFolderSessionDirs(folder, allFolders ?? [folder]), [folder, allFolders]);
  const folderColor = getFolderColor(folder, allFolders ?? [folder]);
  const hasNestedSessions = scopedDirs.some(dir => !folder.session_dirs.some(own => normalizeSessionPath(own) === normalizeSessionPath(dir)));
  const sessionFolders = new Map((allFolders ?? [folder]).flatMap(item => item.session_dirs.map(dir => [normalizeSessionPath(dir), item] as const)));
  const folderSessions = useMemo(() => {
    const all = scopedDirs.map(d => sessionsByDir.get(normalizeSessionPath(d))).filter(Boolean) as ArchiveSession[];
    const q = search.trim().toLowerCase();
    return q ? all.filter(s => s.name.toLowerCase().includes(q)) : all;
  }, [scopedDirs, sessionsByDir, search]);

  useEffect(() => {
    if (selectedFolderSessionDirs.size === 0) return;
    const existingDirs = new Set(folderSessions.map(s => normalizeSessionPath(s.session_dir)));
    setSelectedFolderSessionDirs(prev => {
      const filtered = new Set([...prev].filter(d => existingDirs.has(normalizeSessionPath(d))));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [folderSessions, selectedFolderSessionDirs.size]);

  const filteredFtResults = useMemo(() => {
    if (!ftResults) return null;
    const inFolder = new Set(scopedDirs.map(normalizeSessionPath));
    return ftResults.filter(r => inFolder.has(normalizeSessionPath(r.session_dir)));
  }, [ftResults, scopedDirs]);

  const pageData = folderSessions;

  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const isFilteringName = hasNestedSessions || (!fullTextMode && search.trim().length > 0);

  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSortStart = useCallback((event: DragStartEvent) => {
    setActiveSortId(String(event.active.id));
  }, []);

  const handleSortEnd = useCallback((event: DragEndEvent) => {
    setActiveSortId(null);
    if (hasNestedSessions) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const activeNorm = normalizeSessionPath(String(active.id));
    const overNorm = normalizeSessionPath(String(over.id));
    const oldIndex = folderSessions.findIndex(s => normalizeSessionPath(s.session_dir) === activeNorm);
    const newIndex = folderSessions.findIndex(s => normalizeSessionPath(s.session_dir) === overNorm);
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedVisible = arrayMove(folderSessions, oldIndex, newIndex).map(s => s.session_dir);
    const visibleSet = new Set(folderSessions.map(s => normalizeSessionPath(s.session_dir)));
    let vi = 0;
    const merged = folder.session_dirs.map(d => visibleSet.has(normalizeSessionPath(d)) ? reorderedVisible[vi++] : d);
    onReorderSessions(merged);
  }, [folder.session_dirs, folderSessions, onReorderSessions, hasNestedSessions]);

  const availableToAddAll = useMemo(() => {
    const inFolder = new Set(scopedDirs.map(normalizeSessionPath));
    return Array.from(sessionsByDir.values()).filter(s => !inFolder.has(normalizeSessionPath(s.session_dir)));
  }, [scopedDirs, sessionsByDir]);

  const handleAddSessions = useCallback((dirs: string[]) => {
    if (onAddMultipleSessions) {
      onAddMultipleSessions(dirs);
    } else {
      dirs.forEach(d => onAddSession(d));
    }
  }, [onAddMultipleSessions, onAddSession]);

  const prevManualFolderSelectionRef = useRef<Set<string> | null>(null);

  const toggleSelectFolderSession = useCallback((dir: string) => {
    setSelectedFolderSessionDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      prevManualFolderSelectionRef.current = next.size > 0 ? new Set(next) : null;
      return next;
    });
  }, []);

  const selectAllFolderSessions = useCallback(() => {
    if (selectedFolderSessionDirs.size < folderSessions.length && selectedFolderSessionDirs.size > 0) {
      prevManualFolderSelectionRef.current = new Set(selectedFolderSessionDirs);
    }
    setSelectedFolderSessionDirs(new Set(folderSessions.map(s => s.session_dir)));
  }, [folderSessions, selectedFolderSessionDirs]);

  const handleDeselectOrRestoreFolderSessions = useCallback(() => {
    if (prevManualFolderSelectionRef.current && prevManualFolderSelectionRef.current.size > 0 && prevManualFolderSelectionRef.current.size < folderSessions.length) {
      setSelectedFolderSessionDirs(new Set(prevManualFolderSelectionRef.current));
      prevManualFolderSelectionRef.current = null;
    } else {
      setSelectedFolderSessionDirs(new Set());
      prevManualFolderSelectionRef.current = null;
    }
  }, [folderSessions.length]);

  const clearSelectFolderSessions = useCallback(() => {
    setSelectedFolderSessionDirs(new Set());
    prevManualFolderSelectionRef.current = null;
  }, []);

  useEffect(() => {
    if (ftDebounceRef.current) clearTimeout(ftDebounceRef.current);
    const q = search.trim();
    if (!fullTextMode || q.length < 3) {
      searchGenRef.current++;
      setFtResults(null);
      setFtError(null);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setFtError(null);
    const gen = ++searchGenRef.current;
    ftDebounceRef.current = setTimeout(async () => {
      try {
        const res = await window.pywebview?.api?.search_sessions?.(q, 100);
        if (searchGenRef.current !== gen) return;
        if (res?.ok) {
          setFtResults(res.results ?? []);
        } else {
          setFtError(res?.error ?? 'Errore durante la ricerca');
          setFtResults([]);
        }
      } catch {
        if (searchGenRef.current !== gen) return;
        setFtError('Errore durante la ricerca');
        setFtResults([]);
      } finally {
        if (searchGenRef.current === gen) setIsSearching(false);
      }
    }, 400);
    return () => { if (ftDebounceRef.current) clearTimeout(ftDebounceRef.current); };
  }, [fullTextMode, search]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      folderSearchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const headerKebabItems: KebabMenuItem[] = [
    ...(onMove ? [{ label: 'Sposta in…', icon: <FolderInput className="w-3.5 h-3.5" />, onClick: onMove }] : []),
    {
      label: 'Modifica raccolta',
      icon: <Pencil className="w-3.5 h-3.5" />,
      onClick: onEdit,
    },
    {
      label: 'Elimina raccolta',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <div className="flex flex-col gap-6 w-full">
      {onNavigate && <FolderBreadcrumbs folder={folder} folders={allFolders ?? [folder]} onNavigate={onNavigate} />}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-[36px_16px_1fr] sm:flex flex-1 min-w-[min(100%,16rem)] items-center gap-3">
          <button
            onClick={onBack}
            className="icon-button compact-icon-button shrink-0 group/back"
            aria-label="Torna al livello superiore"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
          </button>
          <span className="folder-color-dot is-large" style={{ '--folder-color': folderColor } as React.CSSProperties} />
          <div className="col-span-3 row-start-2 flex flex-wrap items-center gap-3 min-w-0">
            <h1 className="min-w-0 max-w-full [overflow-wrap:anywhere] text-[1.75rem] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {folder.name}
            </h1>
            <span className="status-pill shrink-0">{folderSessions.length}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="archive-action-button is-accent folder-add-lessons-btn"
            title="Aggiungi lezioni a questa raccolta"
          >
            <Plus className="w-3.5 h-3.5 folder-add-lessons-plus" />
            <span>Aggiungi lezioni</span>
            {availableToAddAll.length > 0 && (
              <span className="folder-add-lessons-badge">
                {availableToAddAll.length}
              </span>
            )}
          </button>
          <KebabMenu items={headerKebabItems} />
        </div>
      </div>

      {collectionGrid}
      <div className="flex flex-col gap-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Lezioni</h3>
        <div className="archive-sticky-toolbar sticky top-0 z-20 py-2 -my-2 bg-[var(--bg-base)]/95 backdrop-blur-md flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div className="search-pill-wrap">
              {isSearching
                ? <Loader2 className="search-pill-icon w-3.5 h-3.5 animate-spin" />
                : <Search className="search-pill-icon w-3.5 h-3.5" />}
              <input
                ref={folderSearchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={() => setFolderSearchFocused(true)}
                onBlur={() => setFolderSearchFocused(false)}
                placeholder={fullTextMode ? 'Cerca nel contenuto...' : 'Cerca per nome...'}
                className="search-pill-input"
              />
              <AnimatePresence>
                {search.trim().length > 0 ? (
                  <motion.button
                    key="clear"
                    initial={{ opacity: 0, scale: 0.7 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.7 }}
                    transition={{ duration: 0.1 }}
                    onClick={() => { setSearch(''); folderSearchInputRef.current?.focus(); }}
                    className="search-pill-clear"
                    aria-label="Cancella ricerca"
                  >
                    <X className="w-3 h-3" />
                  </motion.button>
                ) : !folderSearchFocused ? (
                  <motion.span
                    key="hint"
                    className="search-pill-hint"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12 }}
                  >
                    <kbd>/</kbd>
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </div>
            <button
              type="button"
              onClick={() => { setFullTextMode(m => !m); setSearch(''); }}
              className="filter-chip w-9 p-0 flex items-center justify-center group/ft"
              style={fullTextMode ? { color: 'var(--accent-text)', borderColor: 'var(--accent-text)', background: 'var(--accent-subtle)' } : undefined}
              title={fullTextMode ? 'Testo completo (Attivo - Clicca per disattivare)' : 'Testo completo (Ricerca nel contenuto)'}
              aria-label="Testo completo"
            >
              <FileSearch className="w-4 h-4 transition-transform duration-200 opacity-80 group-hover/ft:opacity-100 group-hover/ft:scale-110" />
            </button>
          </div>
          {!fullTextMode && search.trim().length > 0 && (
            <span className="search-results-count">
              {folderSessions.length === 0
                ? 'Nessun risultato'
                : folderSessions.length === 1
                  ? '1 risultato'
                  : `${folderSessions.length} risultati`}
            </span>
          )}
          {fullTextMode && filteredFtResults !== null && !isSearching && (
            <span className="search-results-count">
              {ftError
                ? ftError
                : filteredFtResults.length === 0
                  ? `Nessun risultato per «${search.trim()}»`
                  : filteredFtResults.length === 1
                    ? '1 sbobina corrisponde'
                    : `${filteredFtResults.length} sbobine corrispondono`}
            </span>
          )}
          {fullTextMode && search.trim().length > 0 && search.trim().length < 3 && (
            <span className="search-results-count">Digita almeno 3 caratteri</span>
          )}
        </div>

        {!fullTextMode ? (
          <DndContext
            sensors={sortSensors}
            onDragStart={handleSortStart}
            onDragEnd={handleSortEnd}
          >
            <div className="flex flex-col gap-2">
              {folderSessions.length === 0 && !search.trim() && (
                <div className="py-12 text-center flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-muted)' }}>
                  <FileText className="w-8 h-8 opacity-30" />
                  <p className="text-sm">Nessuna sbobina in questa raccolta.</p>
                  {availableToAddAll.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAddModal(true)}
                      className="archive-action-button is-accent mt-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Aggiungi lezioni ({availableToAddAll.length} disponibili)</span>
                    </button>
                  )}
                </div>
              )}
              {folderSessions.length === 0 && search.trim() && (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nessun risultato per &ldquo;{search}&rdquo;
                </div>
              )}
              <div className="py-1">
                <SortableContext
                  items={pageData.map(s => s.session_dir)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {pageData.map((session) => (
                      <SortableSessionCard
                        key={session.session_dir}
                        session={session}
                        folderColor={getFolderColor(sessionFolders.get(normalizeSessionPath(session.session_dir)) ?? folder, allFolders ?? [folder])}
                        onMove={onMoveSessions ? () => onMoveSessions([session.session_dir]) : undefined}
                        collectionIndicator={sessionFolders.get(normalizeSessionPath(session.session_dir))?.id !== folder.id ? <FolderIndicatorChip folder={sessionFolders.get(normalizeSessionPath(session.session_dir)) ?? folder} folders={allFolders} relativeTo={folder.id} /> : undefined}
                        disabled={isFilteringName}
                        selected={selectedFolderSessionDirs.has(session.session_dir)}
                        onToggleSelect={() => toggleSelectFolderSession(session.session_dir)}
                        editorSessionsMap={editorSessionsMap}
                        onRemove={() => onRemoveSession(session.session_dir)}
                        onPreview={onPreview}
                        onOpenFile={onOpenFile}
                        onDeleteSession={onDeleteSession}
                        onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
                        onShareSession={onShareSession}
                      />
                    ))}
                  </div>
                </SortableContext>
              </div>
            </div>
            <DragOverlay>
              {activeSortId ? (() => {
                const activeNorm = normalizeSessionPath(activeSortId);
                const s = folderSessions.find(x => normalizeSessionPath(x.session_dir) === activeNorm);
                return s ? <FolderSessionCardOverlay session={s} folderColor={folderColor} /> : null;
              })() : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="py-1">
              <FullTextResultList
                query={search.trim()}
                results={filteredFtResults}
                isSearching={isSearching}
                onPreview={(r) => onPreview(r.html_path, r.name, undefined, undefined, r.session_dir, search.trim())}
              />
              {filteredFtResults !== null && filteredFtResults.length === 0 && !isSearching && search.trim().length >= 3 && !ftError && (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nessun risultato nel testo delle sbobine per &ldquo;{search.trim()}&rdquo;
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedFolderSessionDirs.size > 0 && (
          <ArchiveSelectionBar
            selectedCount={selectedFolderSessionDirs.size}
            totalCount={folderSessions.length}
            folders={allFolders ?? [folder]}
            onSelectAll={selectAllFolderSessions}
            onDeselectAll={handleDeselectOrRestoreFolderSessions}
            onAssignToFolder={targetFolderId => {
              if (onAssignMultipleToFolder) {
                onAssignMultipleToFolder(Array.from(selectedFolderSessionDirs), targetFolderId);
              }
              clearSelectFolderSessions();
            }}
            onNewFolder={onNewFolder ?? (() => {})}
            onMove={onMoveSessions ? () => onMoveSessions(Array.from(selectedFolderSessionDirs), clearSelectFolderSessions) : undefined}
            hasAssignedFolder={true}
            onRemoveFromFolder={() => {
              const dirs = Array.from(selectedFolderSessionDirs);
              if (onRemoveMultipleSessions) {
                onRemoveMultipleSessions(dirs);
              } else {
                dirs.forEach(d => onRemoveSession(d));
              }
              clearSelectFolderSessions();
            }}
            onDeleteSelected={onDeleteMultipleSessions ? () => {
              const targets = folderSessions
                .filter(s => selectedFolderSessionDirs.has(s.session_dir))
                .map(s => ({ sessionDir: s.session_dir, name: s.name }));
              onDeleteMultipleSessions(targets);
            } : undefined}
            onClose={clearSelectFolderSessions}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAddModal && (
          <AddSessionsToFolderModal
            folder={{ ...folder, color: folderColor }}
            availableSessions={availableToAddAll}
            onClose={() => setShowAddModal(false)}
            onAdd={handleAddSessions}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

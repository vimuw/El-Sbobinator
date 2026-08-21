import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, Check, ChevronDown, ChevronUp, FileSearch, FileText,
  FolderPlus, Loader2, Pencil, Plus, Search, Trash2, X,
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
import { formatRelativeTime, normalizeSessionPath } from '../../utils';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FullTextResultList } from './FullTextResults';
import { FolderSessionCardOverlay, SortableSessionCard } from './SessionCard';
import { ArchiveSelectionBar } from './ArchiveSelectionBar';
import type { ArchivePageProps } from './types';

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
}: FolderDetailViewProps) {
  const [search, setSearch] = useState('');
  const [fullTextMode, setFullTextMode] = useState(false);
  const [ftResults, setFtResults] = useState<SearchSessionResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ftError, setFtError] = useState<string | null>(null);
  const searchGenRef = useRef(0);
  const ftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selectedAddDirs, setSelectedAddDirs] = useState<Set<string>>(new Set());
  const [selectedFolderSessionDirs, setSelectedFolderSessionDirs] = useState<Set<string>>(new Set());

  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const [folderSearchFocused, setFolderSearchFocused] = useState(false);

  const folderSessions = useMemo(() => {
    const all = folder.session_dirs.map(d => sessionsByDir.get(normalizeSessionPath(d))).filter(Boolean) as ArchiveSession[];
    const q = search.trim().toLowerCase();
    return q ? all.filter(s => s.name.toLowerCase().includes(q)) : all;
  }, [folder.session_dirs, sessionsByDir, search]);

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
    const inFolder = new Set(folder.session_dirs.map(normalizeSessionPath));
    return ftResults.filter(r => inFolder.has(normalizeSessionPath(r.session_dir)));
  }, [ftResults, folder.session_dirs]);

  const pageData = folderSessions;

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const isFilteringName = !fullTextMode && search.trim().length > 0;

  const sortSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleSortStart = useCallback((event: DragStartEvent) => {
    setActiveSortId(String(event.active.id));
  }, []);

  const handleSortEnd = useCallback((event: DragEndEvent) => {
    setActiveSortId(null);
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
  }, [folder.session_dirs, folderSessions, onReorderSessions]);

  const availableToAddAll = useMemo(() => {
    const inFolder = new Set(folder.session_dirs.map(normalizeSessionPath));
    return Array.from(sessionsByDir.values()).filter(s => !inFolder.has(normalizeSessionPath(s.session_dir)));
  }, [folder.session_dirs, sessionsByDir]);

  const availableToAdd = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    const filtered = q ? availableToAddAll.filter(s => s.name.toLowerCase().includes(q)) : availableToAddAll;
    return [...filtered].sort((a, b) => {
      const ta = a.completed_at_iso ? new Date(a.completed_at_iso).getTime() : 0;
      const tb = b.completed_at_iso ? new Date(b.completed_at_iso).getTime() : 0;
      return tb - ta;
    });
  }, [availableToAddAll, addSearch]);

  const toggleSelectAdd = useCallback((dir: string) => {
    setSelectedAddDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  const selectAllAdd = useCallback(() => {
    setSelectedAddDirs(new Set(availableToAdd.map(s => s.session_dir)));
  }, [availableToAdd]);

  const clearSelectAdd = useCallback(() => {
    setSelectedAddDirs(new Set());
  }, []);

  const handleBatchAdd = useCallback(() => {
    if (selectedAddDirs.size === 0) return;
    const dirs = Array.from(selectedAddDirs);
    if (onAddMultipleSessions) {
      onAddMultipleSessions(dirs);
    } else {
      dirs.forEach(d => onAddSession(d));
    }
    setSelectedAddDirs(new Set());
  }, [selectedAddDirs, onAddMultipleSessions, onAddSession]);

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
        const res = await window.pywebview?.api?.search_sessions?.(q, 50);
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
    {
      label: 'Modifica cartella',
      icon: <Pencil className="w-3.5 h-3.5" />,
      onClick: onEdit,
    },
    {
      label: 'Elimina cartella',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: onDelete,
    },
  ];

  return (
    <div className="flex flex-col gap-6 w-full">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="icon-button compact-icon-button group/back"
            aria-label="Torna all'archivio"
          >
            <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover/back:-translate-x-0.5" />
          </button>
          <span className="folder-color-dot is-large" style={{ '--folder-color': folder.color } as React.CSSProperties} />
          <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            {folder.name}
          </h2>
          <span className="status-pill">{folderSessions.length}</span>
        </div>
        <KebabMenu items={headerKebabItems} />
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="notion-search-wrap">
            {isSearching
              ? <Loader2 className="notion-search-icon w-3.5 h-3.5 animate-spin" />
              : <Search className="notion-search-icon w-3.5 h-3.5" />}
            <input
              ref={folderSearchInputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onFocus={() => setFolderSearchFocused(true)}
              onBlur={() => setFolderSearchFocused(false)}
              placeholder={fullTextMode ? 'Cerca nel contenuto...' : 'Cerca per nome...'}
              className="notion-search-input"
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
                  className="notion-search-clear"
                  aria-label="Cancella ricerca"
                >
                  <X className="w-3 h-3" />
                </motion.button>
              ) : !folderSearchFocused ? (
                <motion.span
                  key="hint"
                  className="notion-search-hint"
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
            className="notion-sort-chip w-9 p-0 flex items-center justify-center"
            style={fullTextMode ? { color: 'var(--accent-text)', borderColor: 'var(--accent-text)', background: 'var(--accent-subtle)' } : undefined}
            title={fullTextMode ? 'Testo completo (Attivo - Clicca per disattivare)' : 'Testo completo (Ricerca nel contenuto)'}
            aria-label="Testo completo"
          >
            <FileSearch className="w-4 h-4" style={{ opacity: 0.85 }} />
          </button>
        </div>
        {!fullTextMode && search.trim().length > 0 && (
          <span className="notion-results-count">
            {folderSessions.length === 0
              ? 'Nessun risultato'
              : folderSessions.length === 1
                ? '1 risultato'
                : `${folderSessions.length} risultati`}
          </span>
        )}
        {fullTextMode && filteredFtResults !== null && !isSearching && (
          <span className="notion-results-count">
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
          <span className="notion-results-count">Digita almeno 3 caratteri</span>
        )}
      </div>

      {/* Add lesson panel */}
      <div
        className="rounded-xl border transition-all overflow-hidden"
        style={{
          borderColor: showAddPanel ? 'var(--border-strong)' : 'var(--border-default)',
          background: 'var(--bg-elevated)',
        }}
      >
        <button
          type="button"
          onClick={() => setShowAddPanel(v => !v)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none group/add"
          style={{
            background: showAddPanel ? 'var(--sidebar-active-bg)' : 'var(--bg-input)',
            borderBottom: showAddPanel ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200 group-hover/add:scale-105"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}
            >
              <Plus className="w-3.5 h-3.5 transition-transform duration-200 group-hover/add:rotate-90" />
            </span>
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Aggiungi lezione
            </span>
            {availableToAddAll.length > 0 && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{ background: 'var(--border-subtle)', color: 'var(--text-muted)' }}
              >
                {availableToAddAll.length} disponibili
              </span>
            )}
          </div>
          {showAddPanel ? (
            <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          ) : (
            <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          )}
        </button>

        <AnimatePresence>
          {showAddPanel && (
            <motion.div
              key="add-panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <div className="p-3 flex flex-col gap-3">
                {availableToAddAll.length === 0 && !addSearch.trim() && (
                  <div className="py-5 text-center flex flex-col items-center justify-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <FolderPlus className="w-7 h-7 opacity-35" />
                    <p className="text-xs font-medium">Tutte le sbobine sono già in una cartella.</p>
                  </div>
                )}
                {(availableToAddAll.length > 0 || addSearch.trim().length > 0) && (
                  <div className="flex items-center gap-2">
                    <div className="notion-search-wrap flex-1">
                      <Search className="notion-search-icon w-3.5 h-3.5" />
                      <input
                        type="text"
                        value={addSearch}
                        onChange={e => setAddSearch(e.target.value)}
                        placeholder="Cerca sbobina per nome..."
                        className="notion-search-input"
                      />
                      <AnimatePresence>
                        {addSearch.trim().length > 0 && (
                          <motion.button
                            key="clear-add"
                            initial={{ opacity: 0, scale: 0.7 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.7 }}
                            transition={{ duration: 0.1 }}
                            onClick={() => setAddSearch('')}
                            className="notion-search-clear"
                            aria-label="Cancella ricerca"
                          >
                            <X className="w-3 h-3" />
                          </motion.button>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
                {availableToAdd.length > 0 && (
                  <div className="flex items-center justify-between gap-2 px-1 text-xs">
                    <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>
                      {availableToAdd.length} {availableToAdd.length === 1 ? 'sbobina disponibile' : 'sbobine disponibili'}
                    </span>
                    <div className="flex items-center gap-2">
                      {selectedAddDirs.size > 0 && (
                        <button
                          type="button"
                          onClick={clearSelectAdd}
                          className="text-xs hover:underline cursor-pointer"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Deseleziona
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={selectedAddDirs.size === availableToAdd.length ? clearSelectAdd : selectAllAdd}
                        className="text-xs font-semibold flex items-center gap-1 cursor-pointer hover:underline"
                        style={{ color: 'var(--accent-text)' }}
                      >
                        {selectedAddDirs.size === availableToAdd.length ? 'Deseleziona tutte' : `Seleziona tutte (${availableToAdd.length})`}
                      </button>
                    </div>
                  </div>
                )}
                {selectedAddDirs.size > 0 && (
                  <div
                    className="flex items-center justify-between gap-2 p-2.5 rounded-xl border"
                    style={{ background: 'var(--sidebar-active-bg)', borderColor: 'var(--border-subtle)' }}
                  >
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {selectedAddDirs.size} {selectedAddDirs.size === 1 ? 'lezione selezionata' : 'lezioni selezionate'}
                    </span>
                    <button
                      type="button"
                      onClick={handleBatchAdd}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-transform active:scale-95 cursor-pointer"
                      style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Aggiungi alla cartella ({selectedAddDirs.size})</span>
                    </button>
                  </div>
                )}
                {availableToAdd.length === 0 && addSearch.trim() && (
                  <p className="text-xs py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                    Nessun risultato per &ldquo;{addSearch}&rdquo;
                  </p>
                )}
                {availableToAdd.length > 0 && (
                  <div
                    className="flex flex-col gap-2 overflow-y-auto app-scroll pr-1"
                    style={{ maxHeight: 280 }}
                  >
                    {availableToAdd.map(session => {
                      const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
                      const isSelected = selectedAddDirs.has(session.session_dir);
                      return (
                        <div
                          key={session.session_dir}
                          className="archive-session-card flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border cursor-pointer"
                          style={{
                            borderColor: isSelected ? 'var(--accent-text)' : 'var(--border-subtle)',
                            background: isSelected ? 'var(--accent-subtle)' : undefined,
                          }}
                          onClick={() => toggleSelectAdd(session.session_dir)}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation();
                                toggleSelectAdd(session.session_dir);
                              }}
                              className={`w-4 h-4 rounded flex items-center justify-center transition-all shrink-0 cursor-pointer ${
                                isSelected
                                  ? 'bg-[var(--accent-text)] text-white'
                                  : 'border border-[var(--border-strong)] bg-[var(--bg-input)] hover:border-[var(--accent-text)] opacity-70 group-hover:opacity-100'
                              }`}
                              aria-label={isSelected ? `Deseleziona ${session.name}` : `Seleziona ${session.name}`}
                              title={isSelected ? 'Deseleziona' : 'Seleziona'}
                            >
                              {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                            </button>
                            <FileText className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-text)', opacity: 0.8 }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                                {session.name}
                              </p>
                              {ts > 0 && (
                                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                                  {formatRelativeTime(ts)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              onAddSession(session.session_dir);
                            }}
                            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all cursor-pointer hover:scale-105 active:scale-95"
                            style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-text)' }}
                            title="Aggiungi alla cartella"
                            aria-label="Aggiungi alla cartella"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!fullTextMode ? (
        <DndContext
          sensors={sortSensors}
          onDragStart={handleSortStart}
          onDragEnd={handleSortEnd}
        >
          <div className="flex flex-col gap-2">
            {folderSessions.length === 0 && !search.trim() && (
              <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Nessuna sbobina in questa cartella.</p>
              </div>
            )}
            {folderSessions.length === 0 && search.trim() && (
              <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Nessun risultato per &ldquo;{search}&rdquo;
              </div>
            )}
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto app-scroll pr-1 py-1">
              <SortableContext
                items={pageData.map(s => s.session_dir)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {pageData.map((session) => (
                    <SortableSessionCard
                      key={session.session_dir}
                      session={session}
                      folderColor={folder.color}
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
              return s ? <FolderSessionCardOverlay session={s} folderColor={folder.color} /> : null;
            })() : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="flex flex-col gap-2">
          <FullTextResultList
            query={search.trim()}
            results={filteredFtResults}
            isSearching={isSearching}
            onPreview={(r) => onPreview(r.html_path, r.name, undefined, undefined, r.session_dir, search.trim())}
          />
          {filteredFtResults !== null && filteredFtResults.length === 0 && !isSearching && search.trim().length >= 3 && (
            <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Nessun risultato nel testo delle sbobine per &ldquo;{search}&rdquo;
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

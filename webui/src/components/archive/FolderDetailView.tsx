import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft, ChevronDown, ChevronUp, FileSearch, FileText,
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
import { formatRelativeTime } from '../../utils';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FullTextResultList } from './FullTextResults';
import { FolderSessionCardOverlay, SortableSessionCard } from './SessionCard';
import type { ArchivePageProps } from './types';

export interface FolderDetailViewProps {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  editorSessionsMap?: Record<string, EditorSession>;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRemoveSession: (dir: string) => void;
  onAddSession: (dir: string) => void;
  onReorderSessions: (dirs: string[]) => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
  onShareSession?: (session: ArchiveSession) => void;
}

export function FolderDetailView({
  folder,
  sessionsByDir,
  editorSessionsMap,
  onBack,
  onEdit,
  onDelete,
  onRemoveSession,
  onAddSession,
  onReorderSessions,
  onPreview,
  onOpenFile,
  onDeleteSession,
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

  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const [folderSearchFocused, setFolderSearchFocused] = useState(false);

  const folderSessions = useMemo(() => {
    const all = folder.session_dirs.map(d => sessionsByDir.get(d)).filter(Boolean) as ArchiveSession[];
    const q = search.trim().toLowerCase();
    return q ? all.filter(s => s.name.toLowerCase().includes(q)) : all;
  }, [folder.session_dirs, sessionsByDir, search]);

  const filteredFtResults = useMemo(() => {
    if (!ftResults) return null;
    const inFolder = new Set(folder.session_dirs);
    return ftResults.filter(r => inFolder.has(r.session_dir));
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
    const oldIndex = folderSessions.findIndex(s => s.session_dir === String(active.id));
    const newIndex = folderSessions.findIndex(s => s.session_dir === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    const reorderedVisible = arrayMove(folderSessions, oldIndex, newIndex).map(s => s.session_dir);
    const visibleSet = new Set(folderSessions.map(s => s.session_dir));
    let vi = 0;
    const merged = folder.session_dirs.map(d => visibleSet.has(d) ? reorderedVisible[vi++] : d);
    onReorderSessions(merged);
  }, [folder.session_dirs, folderSessions, onReorderSessions]);

  const availableToAddAll = useMemo(() => {
    const inFolder = new Set(folder.session_dirs);
    return Array.from(sessionsByDir.values()).filter(s => !inFolder.has(s.session_dir));
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
            className="icon-button compact-icon-button"
            aria-label="Torna all'archivio"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="w-4 h-4 rounded-full shrink-0" style={{ background: folder.color }} />
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
          className="w-full flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer select-none"
          style={{
            background: showAddPanel ? 'var(--sidebar-active-bg)' : 'var(--bg-input)',
            borderBottom: showAddPanel ? '1px solid var(--border-subtle)' : 'none',
          }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-transform"
              style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}
            >
              <Plus className="w-3.5 h-3.5" />
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
                  <div className="notion-search-wrap">
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
                      return (
                        <div
                          key={session.session_dir}
                          className="archive-session-card flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-lg border"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <div className="flex items-center gap-2.5 overflow-hidden flex-1">
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
                            onClick={() => onAddSession(session.session_dir)}
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
            <div className="max-h-[calc(100vh-300px)] overflow-y-auto app-scroll pr-1">
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
              const s = folderSessions.find(x => x.session_dir === activeSortId);
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
    </div>
  );
}

import { type FormEvent, type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle, ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  ExternalLink, FileSearch, FolderOpen, FolderPlus, History,
  Loader2, Pencil, Plus, RefreshCw, Search, Trash2, X,
} from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ArchiveFolder, ArchiveSession, SearchSessionResult } from '../bridge';
import { formatRelativeTime, shortModelName } from '../utils';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';

const FOLDER_COLORS = [
  '#FF6B6B', '#FF922B', '#FFD93D', '#6BCB77',
  '#4D96FF', '#CC5DE8', '#FF8FAB', '#20C997',
  '#748FFC', '#94A3B8',
];
const ARCHIVE_PAGE_SIZE = 5;

interface ArchivePageProps {
  sessions: ArchiveSession[];
  total?: number;
  folders: ArchiveFolder[];
  onFoldersChange: (folders: ArchiveFolder[]) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string, searchTerm?: string) => void;
  onOpenFile: (path: string) => void;
  onDeleteSession: (sessionDir: string, name: string) => void;
  onRefresh?: () => void;
  onLoadAll?: () => void;
  onRetryFailedRevisionBlocks?: (sessionDir: string) => Promise<void>;
}

type FolderModalState =
  | { type: 'create' }
  | { type: 'edit'; folder: ArchiveFolder };

export function ArchivePage({
  sessions, total, folders, onFoldersChange,
  onPreview, onOpenFile, onDeleteSession, onRefresh, onLoadAll,
  onRetryFailedRevisionBlocks,
}: ArchivePageProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState | null>(null);
  const [sessionPage, setSessionPage] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeDragFolderId, setActiveDragFolderId] = useState<string | null>(null);
  const [fullTextMode, setFullTextMode] = useState(false);
  const [ftResults, setFtResults] = useState<SearchSessionResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [ftError, setFtError] = useState<string | null>(null);
  const ftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);

  const folderDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleFolderDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragFolderId(String(event.active.id));
  }, []);

  const handleFolderDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDragFolderId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = folders.findIndex(f => f.id === String(active.id));
    const newIndex = folders.findIndex(f => f.id === String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onFoldersChange(arrayMove(folders, oldIndex, newIndex));
  }, [folders, onFoldersChange]);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    try {
      await Promise.all([onRefresh(), new Promise<void>(r => setTimeout(r, 600))]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing, onRefresh]);

  const sessionsByDir = useMemo(() => {
    const map = new Map<string, ArchiveSession>();
    for (const s of sessions) map.set(s.session_dir, s);
    return map;
  }, [sessions]);

  const sessionFolderMap = useMemo(() => {
    const map = new Map<string, ArchiveFolder>();
    for (const f of folders) for (const d of f.session_dirs) map.set(d, f);
    return map;
  }, [folders]);

  const sortSessions = useCallback((arr: ArchiveSession[]) => {
    const q = search.trim().toLowerCase();
    const filtered = q ? arr.filter(s => s.name.toLowerCase().includes(q)) : arr;
    return [...filtered].sort((a, b) => {
      const ta = a.completed_at_iso ? new Date(a.completed_at_iso).getTime() : 0;
      const tb = b.completed_at_iso ? new Date(b.completed_at_iso).getTime() : 0;
      return sort === 'newest' ? tb - ta : ta - tb;
    });
  }, [search, sort]);

  const allSortedSessions = useMemo(
    () => sortSessions(sessions),
    [sessions, sortSessions],
  );
  const sessionPages = Math.ceil(allSortedSessions.length / ARCHIVE_PAGE_SIZE);
  const sessionPageData = useMemo(
    () => allSortedSessions.slice(sessionPage * ARCHIVE_PAGE_SIZE, (sessionPage + 1) * ARCHIVE_PAGE_SIZE),
    [allSortedSessions, sessionPage],
  );

  useEffect(() => { setSessionPage(0); }, [search, sort]);
  useEffect(() => { if (sessionPages > 0 && sessionPage >= sessionPages) setSessionPage(sessionPages - 1); }, [sessionPages, sessionPage]);

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
        const res = await window.pywebview?.api?.search_sessions?.(q, 20);
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
    if (selectedFolderId && !folders.find(f => f.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).isContentEditable) return;
      e.preventDefault();
      searchInputRef.current?.focus();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const assignToFolder = useCallback((sessionDir: string, folderId: string) => {
    const next = folders.map(f => {
      if (f.id === folderId) {
        if (f.session_dirs.includes(sessionDir)) return f;
        return { ...f, session_dirs: [...f.session_dirs, sessionDir] };
      }
      return { ...f, session_dirs: f.session_dirs.filter(d => d !== sessionDir) };
    });
    onFoldersChange(next);
  }, [folders, onFoldersChange]);

  const removeFromFolder = useCallback((sessionDir: string, folderId: string) => {
    const next = folders.map(f =>
      f.id === folderId ? { ...f, session_dirs: f.session_dirs.filter(d => d !== sessionDir) } : f,
    );
    onFoldersChange(next);
  }, [folders, onFoldersChange]);

  const selectedFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) ?? null : null;

  if (selectedFolder) {
    return (
      <>
        <FolderDetailView
          folder={selectedFolder}
          sessionsByDir={sessionsByDir}
          onBack={() => setSelectedFolderId(null)}
          onEdit={() => setFolderModal({ type: 'edit', folder: selectedFolder })}
          onDelete={() => {
            onFoldersChange(folders.filter(f => f.id !== selectedFolder.id));
            setSelectedFolderId(null);
          }}
          onRemoveSession={dir => removeFromFolder(dir, selectedFolder.id)}
          onAddSession={dir => assignToFolder(dir, selectedFolder.id)}
          onReorderSessions={dirs => onFoldersChange(folders.map(f =>
            f.id === selectedFolder.id ? { ...f, session_dirs: dirs } : f,
          ))}
          onPreview={onPreview}
          onOpenFile={onOpenFile}
          onDeleteSession={onDeleteSession}
          onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
        />
        <AnimatePresence>
          {folderModal && (
            <FolderModal
              state={folderModal}
              onClose={() => setFolderModal(null)}
              onSave={(name, color) => {
                if (folderModal.type === 'edit') {
                  onFoldersChange(folders.map(f =>
                    f.id === folderModal.folder.id ? { ...f, name: name.trim(), color } : f,
                  ));
                }
                setFolderModal(null);
              }}
            />
          )}
        </AnimatePresence>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
          Archivio Sbobine
        </h2>
        <span className="status-pill">{total != null && total > sessions.length ? total : sessions.length}</span>
      </div>

      {/* Truncation notice */}
      {total != null && total > sessions.length && onLoadAll && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl text-sm"
          style={{ background: 'var(--accent-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--accent-text)22' }}
        >
          <span style={{ color: 'var(--text-muted)' }}>
            Mostrate <strong style={{ color: 'var(--text-primary)' }}>{sessions.length}</strong> di <strong style={{ color: 'var(--text-primary)' }}>{total}</strong> sbobine
          </span>
          <button
            onClick={onLoadAll}
            className="compact-button"
            style={{ color: 'var(--accent-text)', fontWeight: 600, flexShrink: 0 }}
          >
            Mostra tutte
          </button>
        </div>
      )}

      {/* Folders grid — always visible, first card is "new folder" */}
      <DndContext
        sensors={folderDndSensors}
        onDragStart={handleFolderDragStart}
        onDragEnd={handleFolderDragEnd}
      >
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <NewFolderCard onClick={() => setFolderModal({ type: 'create' })} />
          <SortableContext items={folders.map(f => f.id)} strategy={rectSortingStrategy}>
            {folders.map(folder => (
              <SortableFolderCard
                key={folder.id}
                folder={folder}
                sessionsByDir={sessionsByDir}
                onNavigate={() => setSelectedFolderId(folder.id)}
                onEdit={() => setFolderModal({ type: 'edit', folder })}
                onDelete={() => onFoldersChange(folders.filter(f => f.id !== folder.id))}
              />
            ))}
          </SortableContext>
        </div>
        <DragOverlay>
          {activeDragFolderId ? (() => {
            const f = folders.find(x => x.id === activeDragFolderId);
            return f ? <FolderCardOverlay folder={f} sessionsByDir={sessionsByDir} /> : null;
          })() : null}
        </DragOverlay>
      </DndContext>

      {/* Unfiled sessions */}
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
          Tutte le sbobine
        </h3>

        {/* Search + Sort */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div className="notion-search-wrap">
              {isSearching
                ? <Loader2 className="notion-search-icon w-3.5 h-3.5 animate-spin" />
                : <Search className="notion-search-icon w-3.5 h-3.5" />}
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
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
                    onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                    className="notion-search-clear"
                    aria-label="Cancella ricerca"
                  >
                    <X className="w-3 h-3" />
                  </motion.button>
                ) : !searchFocused ? (
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
              onClick={() => { setFullTextMode(m => !m); setSearch(''); }}
              className="notion-sort-chip"
              style={fullTextMode ? { color: 'var(--accent-text)', borderColor: 'var(--accent-text)', background: 'var(--accent-subtle)' } : undefined}
              title={fullTextMode ? 'Disattiva ricerca nel contenuto' : 'Attiva ricerca nel contenuto'}
            >
              <FileSearch className="w-3.5 h-3.5" style={{ opacity: 0.8 }} />
              Testo completo
            </button>
            {!fullTextMode && (
              <button
                onClick={() => setSort(s => s === 'newest' ? 'oldest' : 'newest')}
                className="notion-sort-chip"
              >
                <ChevronDown className="w-3.5 h-3.5" style={{ opacity: 0.55 }} />
                {sort === 'newest' ? 'Recente' : 'Meno recente'}
              </button>
            )}
            {onRefresh && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="icon-button compact-icon-button"
                style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                title="Aggiorna archivio"
                aria-label="Aggiorna archivio"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>
          {!fullTextMode && search.trim().length > 0 && (
            <span className="notion-results-count">
              {allSortedSessions.length === 0
                ? 'Nessun risultato'
                : allSortedSessions.length === 1
                  ? '1 risultato'
                  : `${allSortedSessions.length} risultati`}
            </span>
          )}
          {fullTextMode && ftResults !== null && !isSearching && (
            <span className="notion-results-count">
              {ftError
                ? ftError
                : ftResults.length === 0
                  ? `Nessun risultato per «${search.trim()}»`
                  : ftResults.length === 1
                    ? '1 sbobina corrisponde'
                    : `${ftResults.length} sbobine corrispondono`}
            </span>
          )}
          {fullTextMode && search.trim().length > 0 && search.trim().length < 3 && (
            <span className="notion-results-count">Digita almeno 3 caratteri</span>
          )}
        </div>

        {!fullTextMode && sessionPageData.length === 0 && sessions.length === 0 && (
          <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
            <History className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nessuna sbobina nell&apos;archivio.</p>
          </div>
        )}

        {!fullTextMode && sessionPageData.length === 0 && sessions.length > 0 && search.trim() && (
          <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
            {`Nessun risultato per "${search}"`}
          </div>
        )}

        {fullTextMode && (
          <FullTextResultList
            query={search.trim()}
            results={ftResults}
            isSearching={isSearching}
            onPreview={(r) => onPreview(r.html_path, r.name, undefined, undefined, r.session_dir, search.trim())}
          />
        )}

        {!fullTextMode && (
          <>
            <AnimatePresence mode="wait">
              <motion.div
                key={`session-page-${sessionPage}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="flex flex-col gap-3"
              >
                {sessionPageData.map(session => (
                  <DraggableSessionCard
                    key={session.session_dir}
                    session={session}
                    allFolders={folders}
                    currentFolder={sessionFolderMap.get(session.session_dir)}
                    onAssignToFolder={fId => assignToFolder(session.session_dir, fId)}
                    onRemoveFromFolder={() => {
                      const f = sessionFolderMap.get(session.session_dir);
                      if (f) removeFromFolder(session.session_dir, f.id);
                    }}
                    onPreview={onPreview}
                    onOpenFile={onOpenFile}
                    onDeleteSession={onDeleteSession}
                    onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
                  />
                ))}
              </motion.div>
            </AnimatePresence>

            {sessionPages > 1 && (
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  onClick={() => setSessionPage(p => Math.max(0, p - 1))}
                  disabled={sessionPage === 0}
                  className="icon-button compact-icon-button"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Pagina precedente"
                ><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sessionPage + 1} / {sessionPages}</span>
                <button
                  onClick={() => setSessionPage(p => Math.min(sessionPages - 1, p + 1))}
                  disabled={sessionPage >= sessionPages - 1}
                  className="icon-button compact-icon-button"
                  style={{ color: 'var(--text-muted)' }}
                  aria-label="Pagina successiva"
                ><ChevronRight className="w-4 h-4" /></button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Folder modal */}
      <AnimatePresence>
        {folderModal && (
          <FolderModal
            state={folderModal}
            onClose={() => setFolderModal(null)}
            onSave={(name, color) => {
              if (folderModal.type === 'create') {
                const newFolder: ArchiveFolder = {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  color,
                  session_dirs: [],
                };
                onFoldersChange([...folders, newFolder]);
              } else {
                onFoldersChange(folders.map(f =>
                  f.id === folderModal.folder.id ? { ...f, name: name.trim(), color } : f,
                ));
              }
              setFolderModal(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── FullTextResultList ───────────────────────────────────────────────────────

function FullTextResultList({
  query, results, isSearching, onPreview,
}: {
  query: string;
  results: SearchSessionResult[] | null;
  isSearching: boolean;
  onPreview: (r: SearchSessionResult) => void;
}) {
  if (query.length < 3) return null;

  if (isSearching) {
    return (
      <div className="py-8 flex items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <Loader2 className="w-4 h-4 animate-spin" />
        Ricerca in corso…
      </div>
    );
  }

  if (!results || results.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {results.map(result => (
        <button
          key={result.session_dir}
          onClick={() => onPreview(result)}
          className="archive-session-card w-full text-left px-4 py-3 flex flex-col gap-2"
          style={{ cursor: 'pointer' }}
        >
          <div className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-text)' }} />
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{result.name}</span>
            {result.completed_at_iso && (
              <span className="text-xs shrink-0" style={{ color: 'var(--text-faint)' }}>
                {formatRelativeTime(new Date(result.completed_at_iso).getTime())}
              </span>
            )}
            <span className="ml-auto text-xs px-1.5 py-0.5 rounded-full shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}>
              {result.match_count === 1 ? '1 occorrenza' : `${result.match_count} occorrenze`}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 pl-6">
            {result.snippets.map((s, i) => (
              <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {s.before && <span>…{s.before} </span>}
                <mark style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)', borderRadius: 3, padding: '0 2px', fontWeight: 600 }}>{s.match}</mark>
                {s.after && <span> {s.after}…</span>}
              </p>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── SortableFolderCard ─────────────────────────────────────────────────────

function FolderIndicatorChip({ folder }: { folder: Pick<ArchiveFolder, 'name' | 'color'> }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: `${folder.color}22`, color: folder.color, border: `1px solid ${folder.color}55` }}
      title={`Raccolta: ${folder.name}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: folder.color }} />
      {folder.name}
    </span>
  );
}

function SortableFolderCard({
  folder, sessionsByDir, onNavigate, onEdit, onDelete,
}: {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
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

// ─── FolderCardOverlay ───────────────────────────────────────────────────────

function FolderCardOverlay({
  folder, sessionsByDir,
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
        borderRadius: 20,
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

// ─── NewFolderCard ───────────────────────────────────────────────────────────

function NewFolderCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="folder-card cursor-pointer w-full text-left"
      style={{
        border: '2px dashed var(--border-default)',
        borderRadius: 20,
        background: 'transparent',
        minHeight: 72,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--accent-text)';
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-subtle)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--border-default)';
        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
      }}
    >
      <FolderPlus className="w-5 h-5" style={{ color: 'var(--accent-text)' }} />
      <span className="text-xs font-semibold" style={{ color: 'var(--accent-text)' }}>Nuova raccolta</span>
    </button>
  );
}

// ─── FolderCard ──────────────────────────────────────────────────────────────

function FolderCard({
  folder, sessionsByDir,
  onNavigate, onEdit, onDelete,
}: {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
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
        borderRadius: 20,
        background: `${folder.color}26`,
        transition: 'border-color 0.15s, background 0.15s',
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

// ─── DraggableSessionCard ─────────────────────────────────────────────────────

function DraggableSessionCard({
  session, allFolders, currentFolder, onAssignToFolder, onRemoveFromFolder,
  onPreview, onOpenFile, onDeleteSession, onRetryFailedRevisionBlocks,
}: {
  session: ArchiveSession;
  allFolders: ArchiveFolder[];
  currentFolder?: ArchiveFolder;
  onAssignToFolder: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
}) {
  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const [isRetryingBlocks, setIsRetryingBlocks] = useState(false);
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  const canRetryBlocks = failedBlockCount > 0 && Boolean(onRetryFailedRevisionBlocks);
  const handleRetryBlocks = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canRetryBlocks || isRetryingBlocks) return;
    setIsRetryingBlocks(true);
    try {
      await onRetryFailedRevisionBlocks?.(session.session_dir);
    } finally {
      setIsRetryingBlocks(false);
    }
  };

  const kebabItems: KebabMenuItem[] = [
    ...allFolders.map(f => ({
      label: f.name,
      icon: <span className="w-3 h-3 rounded-full inline-block" style={{ background: f.color }} />,
      onClick: () => onAssignToFolder(f.id),
    })),
    ...(currentFolder ? [{
      label: `Rimuovi da "${currentFolder.name}"`,
      icon: <X className="w-3.5 h-3.5" />,
      onClick: onRemoveFromFolder,
    } as KebabMenuItem] : []),
    ...(allFolders.length > 0 || currentFolder ? [{ separator: true } as KebabMenuItem] : []),
    {
      label: 'Apri nel browser',
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path),
    },
    {
      label: 'Elimina',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDeleteSession(session.session_dir, session.name),
    },
  ];

  return (
    <div
      onClick={() => onPreview(session.html_path, session.name, session.input_path, undefined, session.session_dir)}
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
      style={hasRevisionWarnings ? { borderColor: 'var(--warning-ring)', boxShadow: 'inset 3px 0 0 var(--warning-ring)', background: 'var(--warning-subtle)' } : undefined}
    >
      <div className="flex items-center gap-3 overflow-hidden flex-1">
        <History className="w-4 h-4 shrink-0" style={{ color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--text-faint)' }} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{session.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {currentFolder && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <FolderIndicatorChip folder={currentFolder} />
              </>
            )}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
            {failedBlockCount > 0 && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}><AlertTriangle className="w-3 h-3" />{failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}</span></>
            )}
          </div>
          {canRetryBlocks && (
            <div className="mt-2 flex flex-col gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid var(--warning-ring)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--warning-text)' }}>
                Alcune sezioni sono nella nota senza revisione AI.
              </p>
              <button
                type="button"
                onClick={handleRetryBlocks}
                disabled={isRetryingBlocks}
                className="premium-button-secondary compact-button text-xs self-start"
                style={{ color: 'var(--warning-text)', borderColor: 'var(--warning-ring)', background: 'var(--warning-subtle)', opacity: isRetryingBlocks ? 0.65 : 1 }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingBlocks ? 'animate-spin' : ''}`} />
                {isRetryingBlocks ? 'Riprovo...' : 'Riprova revisione AI'}
              </button>
            </div>
          )}
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px] hover:underline"
            style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path); }}
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className="truncate">{session.html_path.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>
          </div>
        </div>
      </div>

      <div onClick={e => e.stopPropagation()}>
        <KebabMenu items={kebabItems} />
      </div>
    </div>
  );
}

// ─── FolderSessionCardOverlay (DragOverlay for folder detail view) ────────────

function FolderSessionCardOverlay({ session, folderColor }: {
  session: ArchiveSession;
  folderColor: string;
}) {
  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  return (
    <div
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3"
      style={{ pointerEvents: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.18)', opacity: 0.95, cursor: 'grabbing', borderColor: hasRevisionWarnings ? 'var(--warning-ring)' : undefined, background: hasRevisionWarnings ? 'var(--warning-subtle)' : undefined }}
    >
      <div className="flex items-center gap-3 overflow-hidden flex-1">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: folderColor, opacity: 0.85 }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{session.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className="truncate">{session.html_path.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SortableSessionCard (inside folder detail view) ─────────────────────────

function SortableSessionCard({
  session, folderColor, disabled, onRemove,
  onPreview, onOpenFile, onDeleteSession, onRetryFailedRevisionBlocks,
  canMoveToPreviousPage, canMoveToNextPage, onMoveToPreviousPage, onMoveToNextPage,
}: {
  session: ArchiveSession;
  folderColor: string;
  disabled: boolean;
  onRemove: () => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
  canMoveToPreviousPage?: boolean;
  canMoveToNextPage?: boolean;
  onMoveToPreviousPage?: () => void;
  onMoveToNextPage?: () => void;
}) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: session.session_dir, disabled });

  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const [isRetryingBlocks, setIsRetryingBlocks] = useState(false);
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  const canRetryBlocks = failedBlockCount > 0 && Boolean(onRetryFailedRevisionBlocks);
  const handleRetryBlocks = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canRetryBlocks || isRetryingBlocks) return;
    setIsRetryingBlocks(true);
    try {
      await onRetryFailedRevisionBlocks?.(session.session_dir);
    } finally {
      setIsRetryingBlocks(false);
    }
  };

  const kebabItems: KebabMenuItem[] = [
    {
      label: 'Apri nel browser',
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path),
    },
    {
      label: 'Rimuovi dalla cartella',
      icon: <X className="w-3.5 h-3.5" />,
      onClick: onRemove,
    },
    {
      label: 'Elimina',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDeleteSession(session.session_dir, session.name),
    },
  ];

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(!disabled ? listeners : {})}
      onClick={() => onPreview(session.html_path, session.name, session.input_path, undefined, session.session_dir)}
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: disabled ? undefined : 'none',
        cursor: isDragging ? 'grabbing' : disabled ? 'pointer' : 'grab',
        borderColor: hasRevisionWarnings ? 'var(--warning-ring)' : undefined,
        boxShadow: hasRevisionWarnings ? 'inset 3px 0 0 var(--warning-ring)' : undefined,
        background: hasRevisionWarnings ? 'var(--warning-subtle)' : undefined,
      }}
    >
      <div className="flex items-center gap-3 overflow-hidden flex-1">
        <span className="w-4 h-4 rounded-full shrink-0" style={{ background: folderColor, opacity: 0.85 }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{session.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
            {failedBlockCount > 0 && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}><AlertTriangle className="w-3 h-3" />{failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}</span></>
            )}
          </div>
          {canRetryBlocks && (
            <div className="mt-2 flex flex-col gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid var(--warning-ring)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--warning-text)' }}>
                Alcune sezioni sono nella nota senza revisione AI.
              </p>
              <button
                type="button"
                onClick={handleRetryBlocks}
                disabled={isRetryingBlocks}
                className="premium-button-secondary compact-button text-xs self-start"
                style={{ color: 'var(--warning-text)', borderColor: 'var(--warning-ring)', background: 'var(--warning-subtle)', opacity: isRetryingBlocks ? 0.65 : 1 }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetryingBlocks ? 'animate-spin' : ''}`} />
                {isRetryingBlocks ? 'Riprovo...' : 'Riprova revisione AI'}
              </button>
            </div>
          )}
          <div
            className="mt-0.5 flex items-center gap-1 text-[11px] hover:underline"
            style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
            onClick={e => { e.stopPropagation(); onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path); }}
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className="truncate">{session.html_path.replace(/\\/g, '/').split('/').slice(-2).join('/')}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
        {(onMoveToPreviousPage || onMoveToNextPage) && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMoveToPreviousPage}
              disabled={!canMoveToPreviousPage}
              className="icon-button compact-icon-button"
              style={{ color: 'var(--text-muted)' }}
              title="Sposta alla pagina precedente"
              aria-label={`Sposta ${session.name} alla pagina precedente`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onMoveToNextPage}
              disabled={!canMoveToNextPage}
              className="icon-button compact-icon-button"
              style={{ color: 'var(--text-muted)' }}
              title="Sposta alla pagina successiva"
              aria-label={`Sposta ${session.name} alla pagina successiva`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        <KebabMenu items={kebabItems} />
      </div>
    </div>
  );
}

// ─── FolderDetailView ─────────────────────────────────────────────────────────

function FolderDetailView({
  folder, sessionsByDir,
  onBack, onEdit, onDelete,
  onRemoveSession, onAddSession, onReorderSessions,
  onPreview, onOpenFile, onDeleteSession, onRetryFailedRevisionBlocks,
}: {
  folder: ArchiveFolder;
  sessionsByDir: Map<string, ArchiveSession>;
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
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const folderSearchInputRef = useRef<HTMLInputElement>(null);
  const [folderSearchFocused, setFolderSearchFocused] = useState(false);

  const folderSessions = useMemo(() => {
    const all = folder.session_dirs.map(d => sessionsByDir.get(d)).filter(Boolean) as ArchiveSession[];
    const q = search.trim().toLowerCase();
    return q ? all.filter(s => s.name.toLowerCase().includes(q)) : all;
  }, [folder.session_dirs, sessionsByDir, search]);

  const totalPages = Math.ceil(folderSessions.length / ARCHIVE_PAGE_SIZE);
  const pageData = useMemo(
    () => folderSessions.slice(page * ARCHIVE_PAGE_SIZE, (page + 1) * ARCHIVE_PAGE_SIZE),
    [folderSessions, page],
  );

  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [activeSortId, setActiveSortId] = useState<string | null>(null);
  const isSearching = search.trim().length > 0;

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

  const moveSessionAcrossPages = useCallback((sessionDir: string, direction: -1 | 1) => {
    const visibleDirs = folderSessions.map(s => s.session_dir);
    const oldIndex = visibleDirs.indexOf(sessionDir);
    if (oldIndex === -1) return;
    const newIndex = Math.max(
      0,
      Math.min(visibleDirs.length - 1, oldIndex + direction * ARCHIVE_PAGE_SIZE),
    );
    if (oldIndex === newIndex) return;
    const reorderedVisible = arrayMove(visibleDirs, oldIndex, newIndex);
    const visibleSet = new Set(visibleDirs);
    let vi = 0;
    const merged = folder.session_dirs.map(d => visibleSet.has(d) ? reorderedVisible[vi++] : d);
    onReorderSessions(merged);
    setPage(Math.floor(newIndex / ARCHIVE_PAGE_SIZE));
  }, [folder.session_dirs, folderSessions, onReorderSessions]);

  const availableToAdd = useMemo(() => {
    const inFolder = new Set(folder.session_dirs);
    const all = Array.from(sessionsByDir.values()).filter(s => !inFolder.has(s.session_dir));
    const q = addSearch.trim().toLowerCase();
    const filtered = q ? all.filter(s => s.name.toLowerCase().includes(q)) : all;
    return [...filtered].sort((a, b) => {
      const ta = a.completed_at_iso ? new Date(a.completed_at_iso).getTime() : 0;
      const tb = b.completed_at_iso ? new Date(b.completed_at_iso).getTime() : 0;
      return tb - ta;
    });
  }, [folder.session_dirs, sessionsByDir, addSearch]);

  useEffect(() => { setPage(0); }, [search]);
  useEffect(() => { if (totalPages > 0 && page >= totalPages) setPage(totalPages - 1); }, [totalPages, page]);

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
    <div className="flex flex-col gap-6">
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
        <div className="notion-search-wrap">
          <Search className="notion-search-icon w-3.5 h-3.5" />
          <input
            ref={folderSearchInputRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onFocus={() => setFolderSearchFocused(true)}
            onBlur={() => setFolderSearchFocused(false)}
            placeholder="Cerca per nome..."
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
        {search.trim().length > 0 && (
          <span className="notion-results-count">
            {folderSessions.length === 0
              ? 'Nessun risultato'
              : folderSessions.length === 1
                ? '1 risultato'
                : `${folderSessions.length} risultati`}
          </span>
        )}
      </div>

      {/* Add lesson panel */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => setShowAddPanel(v => !v)}
          className="flex items-center gap-2 text-sm font-semibold w-full text-left py-1"
          style={{ color: 'var(--accent-text)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Plus className="w-4 h-4" />
          Aggiungi lezione
          {showAddPanel
            ? <ChevronUp className="w-3.5 h-3.5 ml-auto" />
            : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
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
              <div className="flex flex-col gap-3">
                {availableToAdd.length === 0 && !addSearch.trim() && (
                  <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                    Tutte le sbobine sono già in una cartella.
                  </p>
                )}
                {(availableToAdd.length > 0 || addSearch.trim().length > 0) && (
                  <div className="notion-search-wrap">
                    <Search className="notion-search-icon w-3.5 h-3.5" />
                    <input
                      type="text"
                      value={addSearch}
                      onChange={e => setAddSearch(e.target.value)}
                      placeholder="Cerca per nome..."
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
                  <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                    Nessun risultato per &ldquo;{addSearch}&rdquo;
                  </p>
                )}
                <div
                  className="flex flex-col gap-2"
                  style={{ maxHeight: 320, overflowY: 'auto' }}
                >
                  {availableToAdd.map(session => {
                    const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
                    return (
                      <div
                        key={session.session_dir}
                        className="archive-session-card flex items-center justify-between gap-3 px-4 py-3"
                        style={{}}
                      >
                        <div className="flex items-center gap-3 overflow-hidden flex-1">
                          <History className="w-4 h-4 shrink-0" style={{ color: 'var(--text-faint)' }} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                              {session.name}
                            </p>
                            {ts > 0 && (
                              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                {formatRelativeTime(ts)}
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => onAddSession(session.session_dir)}
                          className="icon-button compact-icon-button shrink-0"
                          style={{ color: 'var(--accent-text)' }}
                          title="Aggiungi alla cartella"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DndContext
        sensors={sortSensors}
        onDragStart={handleSortStart}
        onDragEnd={handleSortEnd}
      >
        <div className="flex flex-col gap-2">
          {folderSessions.length === 0 && !search.trim() && (
            <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <History className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Nessuna sbobina in questa cartella.</p>
            </div>
          )}
          {folderSessions.length === 0 && search.trim() && (
            <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              Nessun risultato per &ldquo;{search}&rdquo;
            </div>
          )}
          <SortableContext
            items={pageData.map(s => s.session_dir)}
            strategy={verticalListSortingStrategy}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={`folder-page-${page}`}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12, ease: 'easeOut' }}
                className="flex flex-col gap-2"
              >
                {pageData.map((session, index) => {
                  const visibleIndex = page * ARCHIVE_PAGE_SIZE + index;
                  const showPageMoveControls = totalPages > 1 && !isSearching;
                  return (
                    <SortableSessionCard
                      key={session.session_dir}
                      session={session}
                      folderColor={folder.color}
                      disabled={isSearching}
                      onRemove={() => onRemoveSession(session.session_dir)}
                      onPreview={onPreview}
                      onOpenFile={onOpenFile}
                      onDeleteSession={onDeleteSession}
                      onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
                      canMoveToPreviousPage={visibleIndex >= ARCHIVE_PAGE_SIZE}
                      canMoveToNextPage={visibleIndex < (totalPages - 1) * ARCHIVE_PAGE_SIZE}
                      onMoveToPreviousPage={showPageMoveControls ? () => moveSessionAcrossPages(session.session_dir, -1) : undefined}
                      onMoveToNextPage={showPageMoveControls ? () => moveSessionAcrossPages(session.session_dir, 1) : undefined}
                    />
                  );
                })}
              </motion.div>
            </AnimatePresence>
          </SortableContext>
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 pt-1">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="icon-button compact-icon-button"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Pagina precedente"
              ><ChevronLeft className="w-4 h-4" /></button>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{page + 1} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="icon-button compact-icon-button"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Pagina successiva"
              ><ChevronRight className="w-4 h-4" /></button>
            </div>
          )}
        </div>
        <DragOverlay>
          {activeSortId ? (() => {
            const s = folderSessions.find(x => x.session_dir === activeSortId);
            return s ? <FolderSessionCardOverlay session={s} folderColor={folder.color} /> : null;
          })() : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

// ─── FolderModal ─────────────────────────────────────────────────────────────

function FolderModal({
  state, onClose, onSave,
}: {
  state: FolderModalState;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
}) {
  const [name, setName] = useState(state.type === 'edit' ? state.folder.name : '');
  const [color, setColor] = useState(state.type === 'edit' ? state.folder.color : FOLDER_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name, color);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'var(--bg-overlay)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="modal-card w-full max-w-sm p-6"
        style={{ background: 'var(--bg-elevated)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {state.type === 'create' ? 'Nuova cartella' : 'Modifica cartella'}
        </h3>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text-muted)' }}>Nome</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="es. Anatomia"
              maxLength={48}
              className="premium-button-secondary w-full px-3 py-2 rounded-xl text-sm outline-none"
              style={{ borderColor: 'var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)' }}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-2" style={{ color: 'var(--text-muted)' }}>Colore</label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full transition-transform hover:scale-110 focus:outline-none"
                  style={{
                    background: c,
                    border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent',
                    outline: color === c ? `2px solid ${c}` : 'none',
                    outlineOffset: 2,
                  }}
                  aria-label={`Colore ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={onClose}
              className="premium-button-secondary compact-button px-4 py-2 text-sm"
              style={{ color: 'var(--text-muted)' }}
            >Annulla</button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="modal-action-button is-primary compact-button"
            >
              {state.type === 'create' ? 'Crea' : 'Salva'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

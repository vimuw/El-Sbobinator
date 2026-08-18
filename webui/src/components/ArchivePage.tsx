import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight, Clock, Eye, FileSearch, FileText,
  Loader2, Pencil, RefreshCw, Search, Upload, Users, X,
} from 'lucide-react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import type { ArchiveFolder, ArchiveSession, SearchSessionResult } from '../bridge';
import { loadAllEditorSessions } from '../editorSessions';
import { formatRelativeTime, normalizeSessionPath, shortModelName } from '../utils';
import { FolderIndicatorChip } from './FolderChip';
import { ShareExportModal } from './modals/ShareExportModal';

import {
  type ArchivePageProps,
  type DeleteFolderConfirmState,
  type DeleteMultipleSessionsConfirmState,
  type FolderModalState,
  getOpenedAtMs,
  type SortOption,
} from './archive/types';
import { SortMenu } from './archive/SortMenu';
import { FolderCardOverlay, NewFolderCard, SortableFolderCard } from './archive/FolderCard';
import { DraggableSessionCard } from './archive/SessionCard';
import { FolderDetailView } from './archive/FolderDetailView';
import { DeleteFolderConfirmModal, DeleteMultipleSessionsConfirmModal, FolderModal } from './archive/FolderModals';
import { ArchiveSelectionBar } from './archive/ArchiveSelectionBar';
import { FullTextResultList } from './archive/FullTextResults';

export type { ArchivePageProps, SortOption, FolderModalState, DeleteFolderConfirmState, DeleteMultipleSessionsConfirmState };
export { SortMenu } from './archive/SortMenu';
export { FolderCard, SortableFolderCard, FolderCardOverlay, NewFolderCard } from './archive/FolderCard';
export { DraggableSessionCard, SortableSessionCard, FolderSessionCardOverlay } from './archive/SessionCard';
export { FolderDetailView } from './archive/FolderDetailView';
export { FolderModal, DeleteFolderConfirmModal, DeleteMultipleSessionsConfirmModal } from './archive/FolderModals';
export { ArchiveSelectionBar } from './archive/ArchiveSelectionBar';
export { FullTextResultList } from './archive/FullTextResults';

export function ArchivePage({
  sessions, total, folders, onFoldersChange,
  onPreview, onOpenFile, onDeleteSession, onDeleteMultipleSessions, onRefresh,
  onRetryFailedRevisionBlocks, onOpenJoinRoom,
}: ArchivePageProps) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortOption>('newest');

  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<DeleteFolderConfirmState | null>(null);
  const [deleteMultipleConfirm, setDeleteMultipleConfirm] = useState<DeleteMultipleSessionsConfirmState | null>(null);
  const [selectedSessionDirs, setSelectedSessionDirs] = useState<Set<string>>(new Set());

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

  const [sharingSession, setSharingSession] = useState<ArchiveSession | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportSbobina = useCallback(async () => {
    if (isImporting) return;
    setIsImporting(true);
    try {
      if (window.pywebview?.api?.import_sbobina_package) {
        const res = await window.pywebview.api.import_sbobina_package();
        if (res.ok) {
          onRefresh?.();
        } else if (!res.cancelled && res.error) {
          alert(res.error);
        }
      }
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, onRefresh]);

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
    for (const s of sessions) map.set(normalizeSessionPath(s.session_dir), s);
    return map;
  }, [sessions]);

  const sessionFolderMap = useMemo(() => {
    const map = new Map<string, ArchiveFolder>();
    for (const f of folders) for (const d of f.session_dirs) map.set(normalizeSessionPath(d), f);
    return map;
  }, [folders]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editorSessionsMap = useMemo(() => loadAllEditorSessions(), [sessions]);

  const lastOpenedOrModifiedSessionData = useMemo(() => {
    if (!sessions || sessions.length === 0) return null;
    let bestSession: ArchiveSession | null = null;
    let maxTime = -1;
    let bestOpenedAtMs = 0;
    let bestSavedAtMs = 0;
    let bestCompletedAtMs = 0;

    for (const s of sessions) {
      const openedAtMs = getOpenedAtMs(s, editorSessionsMap);
      const completedAtMs = s.completed_at_iso ? new Date(s.completed_at_iso).getTime() : 0;
      const savedAtMs = editorSessionsMap[s.session_dir]?.savedAt
        ?? editorSessionsMap[s.html_path]?.savedAt
        ?? 0;

      const time = Math.max(openedAtMs, completedAtMs, savedAtMs);
      if (time > maxTime) {
        maxTime = time;
        bestSession = s;
        bestOpenedAtMs = openedAtMs;
        bestSavedAtMs = savedAtMs;
        bestCompletedAtMs = completedAtMs;
      }
    }

    if (!bestSession || maxTime <= 0) return null;

    const isOpenedRecently = bestOpenedAtMs >= bestCompletedAtMs && bestOpenedAtMs >= bestSavedAtMs && bestOpenedAtMs > 0;
    const isSavedRecently = bestSavedAtMs > bestOpenedAtMs && bestSavedAtMs >= bestCompletedAtMs;

    return {
      session: bestSession,
      activityTimeMs: maxTime,
      isOpened: isOpenedRecently,
      isSaved: isSavedRecently,
      folder: sessionFolderMap.get(normalizeSessionPath(bestSession.session_dir)),
    };
  }, [sessions, editorSessionsMap, sessionFolderMap]);

  const sortSessions = useCallback((arr: ArchiveSession[]) => {
    const q = search.trim().toLowerCase();
    const filtered = q ? arr.filter(s => s.name.toLowerCase().includes(q)) : arr;
    return [...filtered].sort((a, b) => {
      if (sort === 'name') {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }
      if (sort === 'recently_opened') {
        const oa = getOpenedAtMs(a, editorSessionsMap);
        const ob = getOpenedAtMs(b, editorSessionsMap);
        if (oa !== ob) return ob - oa;
      }
      const ta = a.completed_at_iso ? new Date(a.completed_at_iso).getTime() : 0;
      const tb = b.completed_at_iso ? new Date(b.completed_at_iso).getTime() : 0;
      return sort === 'oldest' ? ta - tb : tb - ta;
    });
  }, [search, sort, editorSessionsMap]);

  const allSortedSessions = useMemo(
    () => sortSessions(sessions),
    [sessions, sortSessions],
  );
  const sessionPageData = allSortedSessions;

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

  useEffect(() => {
    if (selectedSessionDirs.size === 0) return;
    const existingDirs = new Set(sessions.map(s => normalizeSessionPath(s.session_dir)));
    setSelectedSessionDirs(prev => {
      const filtered = new Set([...prev].filter(d => existingDirs.has(normalizeSessionPath(d))));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [sessions, selectedSessionDirs.size]);

  const assignToFolder = useCallback((sessionDir: string, folderId: string) => {
    const normTarget = normalizeSessionPath(sessionDir);
    const next = folders.map(f => {
      if (f.id === folderId) {
        if (f.session_dirs.some(d => normalizeSessionPath(d) === normTarget)) return f;
        return { ...f, session_dirs: [...f.session_dirs, sessionDir] };
      }
      return { ...f, session_dirs: f.session_dirs.filter(d => normalizeSessionPath(d) !== normTarget) };
    });
    onFoldersChange(next);
  }, [folders, onFoldersChange]);

  const removeFromFolder = useCallback((sessionDir: string, folderId: string) => {
    const normTarget = normalizeSessionPath(sessionDir);
    const next = folders.map(f =>
      f.id === folderId ? { ...f, session_dirs: f.session_dirs.filter(d => normalizeSessionPath(d) !== normTarget) } : f,
    );
    onFoldersChange(next);
  }, [folders, onFoldersChange]);

  const prevManualSelectionRef = useRef<Set<string> | null>(null);

  const toggleSelectSession = useCallback((dir: string) => {
    setSelectedSessionDirs(prev => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      prevManualSelectionRef.current = next.size > 0 ? new Set(next) : null;
      return next;
    });
  }, []);

  const selectAllSessions = useCallback(() => {
    if (selectedSessionDirs.size < sessionPageData.length && selectedSessionDirs.size > 0) {
      prevManualSelectionRef.current = new Set(selectedSessionDirs);
    }
    setSelectedSessionDirs(new Set(sessionPageData.map(s => s.session_dir)));
  }, [sessionPageData, selectedSessionDirs]);

  const handleDeselectOrRestore = useCallback(() => {
    if (prevManualSelectionRef.current && prevManualSelectionRef.current.size > 0 && prevManualSelectionRef.current.size < sessionPageData.length) {
      setSelectedSessionDirs(new Set(prevManualSelectionRef.current));
      prevManualSelectionRef.current = null;
    } else {
      setSelectedSessionDirs(new Set());
      prevManualSelectionRef.current = null;
    }
  }, [sessionPageData.length]);

  const clearSelection = useCallback(() => {
    setSelectedSessionDirs(new Set());
    prevManualSelectionRef.current = null;
  }, []);

  const bulkAssignToFolder = useCallback((folderId: string, customDirs?: string[]) => {
    const targetDirs = customDirs ?? Array.from(selectedSessionDirs);
    const normDirSet = new Set(targetDirs.map(d => normalizeSessionPath(d)));
    const next = folders.map(f => {
      if (f.id === folderId) {
        const existingNorm = new Set(f.session_dirs.map(d => normalizeSessionPath(d)));
        const toAdd = targetDirs.filter(d => !existingNorm.has(normalizeSessionPath(d)));
        return { ...f, session_dirs: [...f.session_dirs, ...toAdd] };
      }
      return { ...f, session_dirs: f.session_dirs.filter(d => !normDirSet.has(normalizeSessionPath(d))) };
    });
    onFoldersChange(next);
    if (!customDirs) clearSelection();
  }, [folders, onFoldersChange, selectedSessionDirs, clearSelection]);

  const bulkRemoveFromFolders = useCallback((customDirs?: string[]) => {
    const targetDirs = customDirs ?? Array.from(selectedSessionDirs);
    const normDirSet = new Set(targetDirs.map(d => normalizeSessionPath(d)));
    const next = folders.map(f => ({
      ...f,
      session_dirs: f.session_dirs.filter(d => !normDirSet.has(normalizeSessionPath(d))),
    }));
    onFoldersChange(next);
    if (!customDirs) clearSelection();
  }, [folders, onFoldersChange, selectedSessionDirs, clearSelection]);

  const handleOpenDeleteMultiple = useCallback((targets?: { sessionDir: string; name: string }[]) => {
    const list = targets ?? sessionPageData
      .filter(s => selectedSessionDirs.has(s.session_dir))
      .map(s => ({ sessionDir: s.session_dir, name: s.name }));
    if (list.length === 0) return;
    if (onDeleteMultipleSessions) {
      onDeleteMultipleSessions(list);
    } else {
      setDeleteMultipleConfirm({ sessions: list });
    }
  }, [sessionPageData, selectedSessionDirs, onDeleteMultipleSessions]);

  const selectedFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) ?? null : null;

  if (selectedFolder) {
    return (
      <>
        <FolderDetailView
          folder={selectedFolder}
          allFolders={folders}
          sessionsByDir={sessionsByDir}
          editorSessionsMap={editorSessionsMap}
          onBack={() => setSelectedFolderId(null)}
          onEdit={() => setFolderModal({ type: 'edit', folder: selectedFolder })}
          onDelete={() => setDeleteFolderConfirm({ folder: selectedFolder })}
          onRemoveSession={dir => removeFromFolder(dir, selectedFolder.id)}
          onRemoveMultipleSessions={dirs => bulkRemoveFromFolders(dirs)}
          onAddSession={dir => assignToFolder(dir, selectedFolder.id)}
          onAddMultipleSessions={dirs => bulkAssignToFolder(selectedFolder.id, dirs)}
          onReorderSessions={dirs => onFoldersChange(folders.map(f =>
            f.id === selectedFolder.id ? { ...f, session_dirs: dirs } : f,
          ))}
          onAssignMultipleToFolder={(dirs, fId) => bulkAssignToFolder(fId, dirs)}
          onNewFolder={() => setFolderModal({ type: 'create' })}
          onPreview={onPreview}
          onOpenFile={onOpenFile}
          onDeleteSession={onDeleteSession}
          onDeleteMultipleSessions={handleOpenDeleteMultiple}
          onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
          onShareSession={setSharingSession}
        />
        <AnimatePresence>
          {folderModal && (
            <FolderModal
              state={folderModal}
              onClose={() => setFolderModal(null)}
              onSave={(name, color) => {
                if (folderModal.type === 'create') {
                  const pending = folderModal.pendingSessionDirs ?? [];
                  const pendingNorm = new Set(pending.map(d => normalizeSessionPath(d)));
                  const newFolder: ArchiveFolder = {
                    id: crypto.randomUUID(),
                    name: name.trim(),
                    color,
                    session_dirs: pending,
                  };
                  const updated = folders.map(f => ({
                    ...f,
                    session_dirs: f.session_dirs.filter(d => !pendingNorm.has(normalizeSessionPath(d))),
                  }));
                  onFoldersChange([...updated, newFolder]);
                  clearSelection();
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
        <AnimatePresence>
          {deleteFolderConfirm && (
            <DeleteFolderConfirmModal
              folder={deleteFolderConfirm.folder}
              onClose={() => setDeleteFolderConfirm(null)}
              onConfirm={() => {
                onFoldersChange(folders.filter(f => f.id !== deleteFolderConfirm.folder.id));
                setDeleteFolderConfirm(null);
                setSelectedFolderId(null);
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {deleteMultipleConfirm && (
            <DeleteMultipleSessionsConfirmModal
              sessions={deleteMultipleConfirm.sessions}
              onClose={() => setDeleteMultipleConfirm(null)}
              onConfirm={() => {
                deleteMultipleConfirm.sessions.forEach(s => onDeleteSession(s.sessionDir, s.name));
                clearSelection();
                setDeleteMultipleConfirm(null);
              }}
            />
          )}
        </AnimatePresence>
        {sharingSession && (
          <ShareExportModal
            session={sharingSession}
            onClose={() => setSharingSession(null)}
          />
        )}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Archivio Sbobine
          </h2>
          <span className="status-pill">{total != null && total > sessions.length ? total : sessions.length}</span>
        </div>
      </div>

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
                onDelete={() => setDeleteFolderConfirm({ folder })}
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

      {/* Mini Section: Ultima sbobina aperta / modificata */}
      {lastOpenedOrModifiedSessionData && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              Ultima sbobina aperta / modificata
            </span>
          </div>
          <div
            onClick={() => onPreview(
              lastOpenedOrModifiedSessionData.session.html_path,
              lastOpenedOrModifiedSessionData.session.name,
              lastOpenedOrModifiedSessionData.session.input_path,
              undefined,
              lastOpenedOrModifiedSessionData.session.session_dir,
            )}
            className="archive-session-card flex items-center justify-between gap-4 p-4 cursor-pointer group/recent transition-all hover:border-[var(--border-strong)]"
            style={{
              borderRadius: '12px',
            }}
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover/recent:scale-105"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}
              >
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {lastOpenedOrModifiedSessionData.session.name}
                  </p>
                  {lastOpenedOrModifiedSessionData.folder && (
                    <FolderIndicatorChip folder={lastOpenedOrModifiedSessionData.folder} />
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {lastOpenedOrModifiedSessionData.isOpened ? (
                    <span className="inline-flex items-center gap-1 shrink-0" title={`Ultima apertura: ${new Date(lastOpenedOrModifiedSessionData.activityTimeMs).toLocaleString('it-IT')}`}>
                      <Eye className="w-3 h-3" style={{ opacity: 0.7 }} />
                      Aperto {formatRelativeTime(lastOpenedOrModifiedSessionData.activityTimeMs)}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 shrink-0" title={`Ultima modifica: ${new Date(lastOpenedOrModifiedSessionData.activityTimeMs).toLocaleString('it-IT')}`}>
                      <Pencil className="w-3 h-3" style={{ opacity: 0.7 }} />
                      {lastOpenedOrModifiedSessionData.isSaved ? 'Modificato' : 'Completato'} {formatRelativeTime(lastOpenedOrModifiedSessionData.activityTimeMs)}
                    </span>
                  )}
                  {lastOpenedOrModifiedSessionData.session.effective_model && (
                    <>
                      <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                      <span>{shortModelName(lastOpenedOrModifiedSessionData.session.effective_model)}</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-opacity hover:opacity-90"
              style={{
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
              }}
            >
              <span>Riprendi</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Unfiled sessions */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Tutte le sbobine
        </h3>

        {/* Search + Sort + Actions */}
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
              type="button"
              onClick={() => { setFullTextMode(m => !m); setSearch(''); }}
              className="notion-sort-chip w-9 p-0 flex items-center justify-center"
              style={fullTextMode ? { color: 'var(--accent-text)', borderColor: 'var(--accent-text)', background: 'var(--accent-subtle)' } : undefined}
              title={fullTextMode ? 'Testo completo (Attivo - Clicca per disattivare)' : 'Testo completo (Ricerca nel contenuto)'}
              aria-label="Testo completo"
            >
              <FileSearch className="w-4 h-4" style={{ opacity: 0.85 }} />
            </button>
            {!fullTextMode && (
              <SortMenu sort={sort} onSortChange={setSort} />
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {onOpenJoinRoom && (
                <button
                  type="button"
                  onClick={onOpenJoinRoom}
                  className="notion-sort-chip w-9 p-0 flex items-center justify-center"
                  title="Partecipa con codice (Stanza di collaborazione)"
                  aria-label="Partecipa con codice"
                >
                  <Users className="w-4 h-4" style={{ opacity: 0.85 }} />
                </button>
              )}
              <button
                type="button"
                onClick={handleImportSbobina}
                disabled={isImporting}
                className="notion-sort-chip w-9 p-0 flex items-center justify-center"
                title="Importa Sbobina (.sbobina)"
                aria-label="Importa Sbobina"
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" style={{ opacity: 0.85 }} />}
              </button>
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="notion-sort-chip w-9 p-0 flex items-center justify-center shrink-0"
                  title="Aggiorna archivio"
                  aria-label="Aggiorna archivio"
                >
                  <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} style={{ opacity: 0.85 }} />
                </button>
              )}
            </div>
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

        <div className="flex flex-col gap-3">
          {!fullTextMode && sessionPageData.length === 0 && sessions.length === 0 && (
            <div className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
              <FileText className="w-8 h-8 mx-auto mb-3 opacity-30" />
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
            <div className="max-h-[calc(100vh-380px)] overflow-y-auto app-scroll pr-1 py-1">
              <div className="flex flex-col gap-3">
                {sessionPageData.map(session => (
                  <DraggableSessionCard
                    key={session.session_dir}
                    session={session}
                    allFolders={folders}
                    currentFolder={sessionFolderMap.get(normalizeSessionPath(session.session_dir))}
                    editorSessionsMap={editorSessionsMap}
                    selected={selectedSessionDirs.has(session.session_dir)}
                    onToggleSelect={() => toggleSelectSession(session.session_dir)}
                    onAssignToFolder={fId => assignToFolder(session.session_dir, fId)}
                    onRemoveFromFolder={() => {
                      const f = sessionFolderMap.get(normalizeSessionPath(session.session_dir));
                      if (f) removeFromFolder(session.session_dir, f.id);
                    }}
                    onPreview={onPreview}
                    onOpenFile={onOpenFile}
                    onDeleteSession={onDeleteSession}
                    onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
                    onShareSession={setSharingSession}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Selection Action Bar */}
      <AnimatePresence>
        {selectedSessionDirs.size > 0 && (
          <ArchiveSelectionBar
            selectedCount={selectedSessionDirs.size}
            totalCount={sessionPageData.length}
            folders={folders}
            onSelectAll={selectAllSessions}
            onDeselectAll={handleDeselectOrRestore}
            onAssignToFolder={fId => bulkAssignToFolder(fId)}
            onNewFolder={() => setFolderModal({ type: 'create', pendingSessionDirs: Array.from(selectedSessionDirs) })}
            hasAssignedFolder={Array.from(selectedSessionDirs).some(d => sessionFolderMap.has(normalizeSessionPath(d)))}
            onRemoveFromFolder={() => bulkRemoveFromFolders()}
            onDeleteSelected={() => handleOpenDeleteMultiple()}
            onClose={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Folder modal */}
      <AnimatePresence>
        {folderModal && (
          <FolderModal
            state={folderModal}
            onClose={() => setFolderModal(null)}
            onSave={(name, color) => {
              if (folderModal.type === 'create') {
                const pending = folderModal.pendingSessionDirs ?? [];
                const pendingNorm = new Set(pending.map(d => normalizeSessionPath(d)));
                const newFolder: ArchiveFolder = {
                  id: crypto.randomUUID(),
                  name: name.trim(),
                  color,
                  session_dirs: pending,
                };
                const updated = folders.map(f => ({
                  ...f,
                  session_dirs: f.session_dirs.filter(d => !pendingNorm.has(normalizeSessionPath(d))),
                }));
                onFoldersChange([...updated, newFolder]);
                clearSelection();
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

      {/* Share/Export modal */}
      {sharingSession && (
        <ShareExportModal
          session={sharingSession}
          onClose={() => setSharingSession(null)}
        />
      )}

      {/* Delete-folder confirmation modal (grid view) */}
      <AnimatePresence>
        {deleteFolderConfirm && (
          <DeleteFolderConfirmModal
            folder={deleteFolderConfirm.folder}
            onClose={() => setDeleteFolderConfirm(null)}
            onConfirm={() => {
              onFoldersChange(folders.filter(f => f.id !== deleteFolderConfirm.folder.id));
              setDeleteFolderConfirm(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Delete multiple sessions modal */}
      <AnimatePresence>
        {deleteMultipleConfirm && (
          <DeleteMultipleSessionsConfirmModal
            sessions={deleteMultipleConfirm.sessions}
            onClose={() => setDeleteMultipleConfirm(null)}
            onConfirm={() => {
              deleteMultipleConfirm.sessions.forEach(s => onDeleteSession(s.sessionDir, s.name));
              clearSelection();
              setDeleteMultipleConfirm(null);
            }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

import { reportClientError } from '../diagnostics';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight, Eye, FileSearch, FileText,
  Loader2, Pencil, RefreshCw, Search, Upload, X,
} from 'lucide-react';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { loadAllEditorSessions } from '../editorSessions';
import { formatRelativeTime, normalizeSessionPath, shortModelName } from '../utils';
import { FolderIndicatorChip } from './FolderChip';
import { ShareExportModal } from './modals/ShareExportModal';

import {
  type ArchivePageProps,
  type DeleteFolderConfirmState,
  type DeleteMultipleSessionsConfirmState,
  type FolderModalState,
  FULL_TEXT_SORT_OPTIONS,
  getOpenedAtMs,
  SORT_OPTIONS,
  type SortOption,
} from './archive/types';
import { SortMenu } from './archive/SortMenu';
import { FolderCollectionGrid } from './archive/FolderCollectionGrid';
import { MoveToFolderModal } from './archive/MoveToFolderModal';
import { deleteFolder, getFolderChildren, getFolderParentId, moveFolder, moveSessionsToFolder } from '../archiveFolders';
import { DraggableSessionCard } from './archive/SessionCard';
import { FolderDetailView } from './archive/FolderDetailView';
import { DeleteFolderConfirmModal, DeleteMultipleSessionsConfirmModal, FolderModal } from './archive/FolderModals';
import { ArchiveSelectionBar } from './archive/ArchiveSelectionBar';
import { FullTextResultList } from './archive/FullTextResults';

import { useArchiveSearch } from '../hooks/useArchiveSearch';
import { useArchiveSelection } from '../hooks/useArchiveSelection';

export type { ArchivePageProps, SortOption, FolderModalState, DeleteFolderConfirmState, DeleteMultipleSessionsConfirmState };
export { SortMenu } from './archive/SortMenu';
export { FolderCard, SortableFolderCard, FolderCardOverlay, NewFolderCard } from './archive/FolderCard';
export { DraggableSessionCard, SortableSessionCard, FolderSessionCardOverlay } from './archive/SessionCard';
export { FolderDetailView } from './archive/FolderDetailView';
export {
  FolderModal,
  DeleteFolderConfirmModal,
  DeleteMultipleSessionsConfirmModal,
  AddSessionsToFolderModal,
  DEFAULT_FOLDER_COLOR,
  FOLDER_COLORS,
} from './archive/FolderModals';
export { ArchiveSelectionBar } from './archive/ArchiveSelectionBar';
export { FullTextResultList } from './archive/FullTextResults';

export function ArchivePage({
  sessions, total, folders, onFoldersChange,
  onPreview, onOpenFile, onDeleteSession, onDeleteMultipleSessions, onRefresh,
  onRetryFailedRevisionBlocks, onNotification,
}: ArchivePageProps) {
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderModal, setFolderModal] = useState<FolderModalState | null>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = useState<DeleteFolderConfirmState | null>(null);
  const [deleteMultipleConfirm, setDeleteMultipleConfirm] = useState<DeleteMultipleSessionsConfirmState | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{ folderId?: string; dirs?: string[]; parentId: string | null; onComplete?: () => void } | null>(null);

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
          if (onNotification) {
            onNotification('Importazione non riuscita', res.error, 'error');
          } else {
            reportClientError('Importazione non riuscita:', res.error);
          }
        }
      }
    } catch (e) {
      if (onNotification) {
        onNotification('Importazione non riuscita', String(e), 'error');
      } else {
        reportClientError('Importazione non riuscita:', e);
      }
    } finally {
      setIsImporting(false);
    }
  }, [isImporting, onNotification, onRefresh]);

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

  const {
    search,
    setSearch,
    sort,
    setSort,
    searchFocused,
    setSearchFocused,
    searchInputRef,
    fullTextMode,
    setFullTextMode,
    ftSort,
    setFtSort,
    ftResults,
    sortedFtResults,
    ftTotal,
    isSearching,
    ftError,
    allSortedSessions,
  } = useArchiveSearch({
    sessions,
    editorSessionsMap,
  });

  const sessionPageData = allSortedSessions;

  const {
    selectedSessionDirs,
    assignToFolder,
    removeFromFolder,
    toggleSelectSession,
    selectAllSessions,
    handleDeselectOrRestore,
    clearSelection,
    bulkAssignToFolder,
    bulkRemoveFromFolders,
    handleOpenDeleteMultiple,
  } = useArchiveSelection({
    sessions,
    folders,
    onFoldersChange,
    sessionPageData,
    onDeleteMultipleSessions,
    setDeleteMultipleConfirm,
  });

  useEffect(() => {
    if (selectedFolderId && !folders.find(f => f.id === selectedFolderId)) {
      setSelectedFolderId(null);
    }
  }, [folders, selectedFolderId]);

  const selectedFolder = selectedFolderId ? folders.find(f => f.id === selectedFolderId) ?? null : null;

  const handleFolderSave = (name: string, color?: string) => {
    if (!folderModal) return;
    const finalColor = color ?? '';
    if (folderModal.type === 'create') {
      const pending = folderModal.pendingSessionDirs ?? [];
      const pendingNorm = new Set(pending.map(d => normalizeSessionPath(d)));
      const newFolder: ArchiveFolder = {
        id: crypto.randomUUID(),
        name: name.trim(),
        color: finalColor,
        parent_id: folderModal.parentId ?? null,
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
        f.id === folderModal.folder.id ? { ...f, name: name.trim(), color: finalColor } : f,
      ));
    }
    setFolderModal(null);
  };

  const handleFolderDelete = () => {
    if (!deleteFolderConfirm) return;
    onFoldersChange(deleteFolder(folders, deleteFolderConfirm.folder.id));
    if (selectedFolderId === deleteFolderConfirm.folder.id) {
      setSelectedFolderId(getFolderParentId(deleteFolderConfirm.folder, folders));
    }
    setDeleteFolderConfirm(null);
  };

  const handleBulkDeleteSessions = () => {
    if (!deleteMultipleConfirm) return;
    deleteMultipleConfirm.sessions.forEach(s => onDeleteSession(s.sessionDir, s.name));
    clearSelection();
    setDeleteMultipleConfirm(null);
  };

  const renderModals = () => (
    <>
      <AnimatePresence>
        {moveTarget && <MoveToFolderModal folders={folders} movingFolderId={moveTarget.folderId} initialParentId={moveTarget.parentId}
          onClose={() => setMoveTarget(null)} onConfirm={(targetId, created) => {
            const updated = [...folders, ...created];
            onFoldersChange(moveTarget.folderId ? moveFolder(updated, moveTarget.folderId, targetId) : moveSessionsToFolder(updated, moveTarget.dirs ?? [], targetId));
            clearSelection(); moveTarget.onComplete?.(); setMoveTarget(null);
          }} />}
      </AnimatePresence>
      <AnimatePresence>
        {folderModal && (
          <FolderModal
            state={folderModal}
            folders={folders}
            onClose={() => setFolderModal(null)}
            onSave={handleFolderSave}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleteFolderConfirm && (
          <DeleteFolderConfirmModal
            folder={deleteFolderConfirm.folder}
            childCount={getFolderChildren(folders, deleteFolderConfirm.folder.id).length}
            onClose={() => setDeleteFolderConfirm(null)}
            onConfirm={handleFolderDelete}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {deleteMultipleConfirm && (
          <DeleteMultipleSessionsConfirmModal
            sessions={deleteMultipleConfirm.sessions}
            onClose={() => setDeleteMultipleConfirm(null)}
            onConfirm={handleBulkDeleteSessions}
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

  if (selectedFolder) {
    return (
      <>
        <FolderDetailView
          key={selectedFolder.id}
          folder={selectedFolder}
          allFolders={folders}
          sessionsByDir={sessionsByDir}
          editorSessionsMap={editorSessionsMap}
          onBack={() => setSelectedFolderId(getFolderParentId(selectedFolder, folders))}
          onNavigate={setSelectedFolderId}
          collectionGrid={<FolderCollectionGrid folders={folders} parentId={selectedFolder.id} sessionsByDir={sessionsByDir}
            onNavigate={setSelectedFolderId} onCreate={() => setFolderModal({ type: 'create', parentId: selectedFolder.id })}
            onEdit={folder => setFolderModal({ type: 'edit', folder })} onDelete={folder => setDeleteFolderConfirm({ folder })}
            onMove={folder => setMoveTarget({ folderId: folder.id, parentId: getFolderParentId(folder, folders) })} onFoldersChange={onFoldersChange} />}
          onMove={() => setMoveTarget({ folderId: selectedFolder.id, parentId: getFolderParentId(selectedFolder, folders) })}
          onMoveSessions={(dirs, onComplete) => setMoveTarget({ dirs, parentId: selectedFolder.id, onComplete })}
          onEdit={() => setFolderModal({ type: 'edit', folder: selectedFolder })}
          onDelete={() => setDeleteFolderConfirm({ folder: selectedFolder })}
          onRemoveSession={dir => bulkRemoveFromFolders([dir])}
          onRemoveMultipleSessions={dirs => bulkRemoveFromFolders(dirs)}
          onAddSession={dir => assignToFolder(dir, selectedFolder.id)}
          onAddMultipleSessions={dirs => bulkAssignToFolder(selectedFolder.id, dirs)}
          onReorderSessions={dirs => onFoldersChange(folders.map(f =>
            f.id === selectedFolder.id ? { ...f, session_dirs: dirs } : f,
          ))}
          onAssignMultipleToFolder={(dirs, fId) => bulkAssignToFolder(fId, dirs)}
          onNewFolder={() => setFolderModal({ type: 'create', parentId: selectedFolder.id })}
          onPreview={onPreview}
          onOpenFile={onOpenFile}
          onDeleteSession={onDeleteSession}
          onDeleteMultipleSessions={handleOpenDeleteMultiple}
          onRetryFailedRevisionBlocks={onRetryFailedRevisionBlocks}
          onShareSession={setSharingSession}
        />
        {renderModals()}
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Archivio Sbobine
          </h1>
          <span className="status-pill">{total != null && total > sessions.length ? total : sessions.length}</span>
        </div>
      </div>

      <FolderCollectionGrid folders={folders} parentId={null} sessionsByDir={sessionsByDir}
        onNavigate={setSelectedFolderId} onCreate={() => setFolderModal({ type: 'create' })}
        onEdit={folder => setFolderModal({ type: 'edit', folder })} onDelete={folder => setDeleteFolderConfirm({ folder })}
        onMove={folder => setMoveTarget({ folderId: folder.id, parentId: getFolderParentId(folder, folders) })} onFoldersChange={onFoldersChange} />

      {/* Mini Section: Ultima sbobina aperta / modificata */}
      {lastOpenedOrModifiedSessionData && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Ultima sbobina aperta / modificata
          </h3>
          <div
            onClick={() => onPreview(
              lastOpenedOrModifiedSessionData.session.html_path,
              lastOpenedOrModifiedSessionData.session.name,
              lastOpenedOrModifiedSessionData.session.input_path,
              undefined,
              lastOpenedOrModifiedSessionData.session.session_dir,
            )}
            className="archive-session-card flex items-center justify-between gap-4 p-4 cursor-pointer group/recent transition-all hover:border-[var(--border-strong)]"
          >
            <div className="flex items-center gap-3.5 min-w-0 flex-1">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover/recent:scale-105"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}
              >
                <FileText className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  {lastOpenedOrModifiedSessionData.session.name}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-xs min-w-0" style={{ color: 'var(--text-muted)' }}>
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
                      <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--border-default)' }} />
                      <span className="shrink-0">{shortModelName(lastOpenedOrModifiedSessionData.session.effective_model)}</span>
                    </>
                  )}
                  {lastOpenedOrModifiedSessionData.folder && (
                    <span className="inline-flex items-center gap-2 min-w-0 max-w-full">
                      <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--border-default)' }} />
                      <FolderIndicatorChip folder={lastOpenedOrModifiedSessionData.folder} folders={folders} />
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="archive-action-button is-accent recent-session-action"
            >
              <span>Riprendi</span>
              <ArrowRight className="w-3.5 h-3.5 recent-session-arrow" />
            </button>
          </div>
        </div>
      )}

      {/* Unfiled sessions */}
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          Tutte le sbobine
        </h3>

        {/* Search + Sort + Actions */}
        <div className="archive-sticky-toolbar sticky top-0 z-20 py-2 -my-2 bg-[var(--bg-base)]/95 backdrop-blur-md flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <div className="search-pill-wrap">
              {isSearching
                ? <Loader2 className="search-pill-icon w-3.5 h-3.5 animate-spin" />
                : <Search className="search-pill-icon w-3.5 h-3.5" />}
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
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
                    onClick={() => { setSearch(''); searchInputRef.current?.focus(); }}
                    className="search-pill-clear"
                    aria-label="Cancella ricerca"
                  >
                    <X className="w-3 h-3" />
                  </motion.button>
                ) : !searchFocused ? (
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
            <SortMenu
              sort={fullTextMode ? ftSort : sort}
              onSortChange={s => {
                if (fullTextMode) {
                  setFtSort(s);
                } else {
                  setSort(s);
                }
              }}
              options={fullTextMode ? FULL_TEXT_SORT_OPTIONS : SORT_OPTIONS}
            />
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleImportSbobina}
                disabled={isImporting}
                className="filter-chip w-9 p-0 flex items-center justify-center group/import"
                title="Importa Sbobina (.sbobina)"
                aria-label="Importa Sbobina"
              >
                {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 transition-transform duration-200 opacity-80 group-hover/import:opacity-100 group-hover/import:scale-110 group-hover/import:-translate-y-0.5" />}
              </button>
              {onRefresh && (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={isRefreshing}
                  className="filter-chip w-9 p-0 flex items-center justify-center shrink-0 group/refresh"
                  title="Aggiorna archivio"
                  aria-label="Aggiorna archivio"
                >
                  <RefreshCw className={`w-4 h-4 transition-transform duration-500 ease-out ${isRefreshing ? 'animate-spin' : 'opacity-80 group-hover/refresh:opacity-100 group-hover/refresh:rotate-180 group-hover/refresh:scale-105'}`} />
                </button>
              )}
            </div>
          </div>
          {!fullTextMode && search.trim().length > 0 && (
            <span className="search-results-count">
              {allSortedSessions.length === 0
                ? 'Nessun risultato'
                : allSortedSessions.length === 1
                  ? '1 risultato'
                  : `${allSortedSessions.length} risultati`}
            </span>
          )}
          {fullTextMode && ftResults !== null && !isSearching && (
            <span className="search-results-count">
              {ftError
                ? ftError
                : ftResults.length === 0
                  ? `Nessun risultato per «${search.trim()}»`
                  : ftTotal !== null && ftTotal > ftResults.length
                    ? `${ftResults.length}+ sbobine trovate`
                    : ftResults.length === 1
                      ? '1 sbobina corrisponde'
                      : `${ftResults.length} sbobine corrispondono`}
            </span>
          )}
          {fullTextMode && search.trim().length > 0 && search.trim().length < 3 && (
            <span className="search-results-count">Digita almeno 3 caratteri</span>
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
            <div className="py-1">
              <FullTextResultList
                query={search.trim()}
                results={sortedFtResults}
                isSearching={isSearching}
                onPreview={(r) => onPreview(r.html_path, r.name, undefined, undefined, r.session_dir, search.trim())}
              />
              {ftResults !== null && ftResults.length === 0 && !isSearching && search.trim().length >= 3 && !ftError && (
                <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Nessun risultato nel testo delle sbobine per &ldquo;{search.trim()}&rdquo;
                </div>
              )}
            </div>
          )}

          {!fullTextMode && (
            <div className="py-1">
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
                    onMove={() => setMoveTarget({ dirs: [session.session_dir], parentId: sessionFolderMap.get(normalizeSessionPath(session.session_dir))?.id ?? null })}
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
            onMove={() => setMoveTarget({ dirs: Array.from(selectedSessionDirs), parentId: null })}
            onAssignToFolder={fId => bulkAssignToFolder(fId)}
            onNewFolder={() => setFolderModal({ type: 'create', pendingSessionDirs: Array.from(selectedSessionDirs) })}
            hasAssignedFolder={Array.from(selectedSessionDirs).some(d => sessionFolderMap.has(normalizeSessionPath(d)))}
            onRemoveFromFolder={() => bulkRemoveFromFolders()}
            onDeleteSelected={() => handleOpenDeleteMultiple()}
            onClose={clearSelection}
          />
        )}
      </AnimatePresence>

      {/* Archive modals */}
      {renderModals()}

    </div>
  );
}

import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { GithubIcon } from './components/icons/GithubIcon';
import { GITHUB_URL, KOFI_URL } from './branding';
import { type ElSbobinatorBridge, type PywebviewApi } from './bridge';
import { initialProcessingState, processingReducer } from './appState';
import { GEMINI_KEY_PATTERN } from './utils';
import { STORAGE_KEYS } from './storageKeys';
import { useConsole } from './hooks/useConsole';
import { useTheme } from './hooks/useTheme';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useQueuePersistence } from './hooks/useQueuePersistence';
import { useApiReady } from './hooks/useApiReady';
import { useBridgeCallbacks } from './hooks/useBridgeCallbacks';
import { useBodyScrollLock } from './hooks/useBodyScrollLock';
import { usePreview } from './hooks/usePreview';
import { useNotifications } from './hooks/useNotifications';
import { useUpdateInstaller } from './hooks/useUpdateInstaller';
import { useArchiveSync } from './hooks/useArchiveSync';
import { useQueueIngest } from './hooks/useQueueIngest';
import { useConfirmModal } from './hooks/useConfirmModal';
import { useQueueProcessing } from './hooks/useQueueProcessing';
import { useRevisionRetry } from './hooks/useRevisionRetry';
import { useRegenerateDialog } from './hooks/useRegenerateDialog';
import { useSystemNotificationTriggers } from './hooks/useSystemNotificationTriggers';
import { QueuePage } from './components/QueuePage';
import { RegenerateModal } from './components/modals/RegenerateModal';
import { NewKeyModal } from './components/modals/NewKeyModal';
import { ConfirmActionModal } from './components/modals/ConfirmActionModal';
import { DuplicateFileModal } from './components/modals/DuplicateFileModal';
import { NavSidebar, type ActivePage } from './components/NavSidebar';
import { NotificationDropdown } from './components/NotificationDropdown';
import { JoinRoomModal } from './components/modals/JoinRoomModal';

const EditorFullPage = React.lazy(() => import('./components/EditorFullPage').then(m => ({ default: m.EditorFullPage })));
const SettingsModal = React.lazy(() => import('./components/modals/SettingsModal').then(m => ({ default: m.SettingsModal })));
const archivePagePromise = import('./components/ArchivePage');
const ArchivePage = React.lazy(() => archivePagePromise.then(m => ({ default: m.ArchivePage })));

declare global {
  interface Window {
    pywebview?: { api?: PywebviewApi };
    elSbobinatorBridge?: ElSbobinatorBridge;
  }
}

export default function App() {
  const [{ files, structuralVersion, appState, currentPhase, currentModel, activeProgress, workTotals, workDone }, dispatch] = useReducer(processingReducer, initialProcessingState);

  const { consoleLogs, appendConsole } = useConsole();
  const { themeMode, setThemeMode } = useTheme();
  const { updateAvailable, latestVersion, isCheckingUpdate, hasChecked, checkFailed, checkForUpdates, dismissUpdate } = useUpdateChecker();
  const {
    apiReady,
    bridgeDelayed,
    apiKey,
    setApiKey,
    hasProtectedKey,
    apiKeyInsecure,
    setApiKeyInsecure,
    apiKeyInsecureReason,
    setApiKeyInsecureReason,
    configRecoveredFrom,
    fallbackKeys,
    setFallbackKeys,
    preferredModel,
    setPreferredModel,
    fallbackModels,
    setFallbackModels,
    availableModels,
    refreshSettings,
  } = useApiReady(appendConsole);

  const [activePage, setActivePage] = useState<ActivePage>('queue');
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isPeakDismissed, setIsPeakDismissed] = useState(() => {
    const ts = localStorage.getItem(STORAGE_KEYS.PEAK_BANNER_DISMISSED_UNTIL);
    return ts ? Date.now() < Number(ts) : false;
  });

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isConsoleExpanded, setIsConsoleExpanded] = useState(false);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);
  const shouldRenderSettings = isSettingsOpen || hasOpenedSettings;

  useEffect(() => {
    if (isSettingsOpen) {
      setHasOpenedSettings(true);
    }
  }, [isSettingsOpen]);

  const handleRetryFailedRevisionBlocksRef = useRef<(sessionDir: string, fileId?: string) => Promise<void>>(() => Promise.resolve());
  const installUpdateRef = useRef<(version: string) => Promise<void>>(() => Promise.resolve());
  const startProcessingRef = useRef<(isContinuation?: boolean, overrideLowDisk?: boolean) => Promise<boolean>>(() => Promise.resolve(false));

  const {
    notifications,
    unreadNotificationsCount,
    shakeBell,
    addNotification,
    upsertNotification,
    deleteNotification,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearAllNotifications,
    removeNotificationByDedupeKey,
  } = useNotifications({
    onRetryFailedRevisionBlocks: useCallback((sessionDir: string, fileId?: string) => handleRetryFailedRevisionBlocksRef.current(sessionDir, fileId), []),
    onInstallUpdate: useCallback((version: string) => installUpdateRef.current(version), []),
    onDismissUpdate: dismissUpdate,
    updateAvailable,
    setIsPeakDismissed,
    onOpenSettings: useCallback(() => setIsSettingsOpen(true), [setIsSettingsOpen]),
  });

  const [askNewKeyPrompt, setAskNewKeyPrompt] = useState(false);
  const [showConsole, setShowConsole] = useState(() => localStorage.getItem(STORAGE_KEYS.SHOW_CONSOLE) === 'true');
  const [autoContinue, setAutoContinue] = useState(() => localStorage.getItem(STORAGE_KEYS.AUTO_CONTINUE) !== 'false');

  const filesRef = useRef(files);
  const appStateRef = useRef(appState);
  const autoContinueRef = useRef(autoContinue);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const isBusy = appStateRef.current === 'processing' || filesRef.current.some(f => f.isRetryingBlocks);
      if (isBusy && !(window as unknown as { __elSbobinatorQuitting?: boolean }).__elSbobinatorQuitting) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const {
    updateInstallState,
    installUpdate,
    handleDownloadProgress,
  } = useUpdateInstaller({
    latestVersion,
    appendConsole,
    upsertNotification,
  });

  const {
    archiveSessions,
    setArchiveSessions,
    archiveTotal,
    setArchiveTotal,
    isArchiveLoaded,
    folders,
    setFolders,
    archiveSessionsRef,
    foldersRef,
    pendingArchiveReplacementsRef,
    normalizeSessionDir,
    refreshArchiveSessions,
    handleLoadAll,
    handleOpenFailed,
    handleFoldersChange,
    handleSessionRootMoved,
    executeRetryFromArchive,
    archiveFiltered,
    completedSessionFolderMap,
  } = useArchiveSync({
    files,
    dispatch,
    activePage,
    setActivePage,
    appState,
    apiReady,
    appendConsole,
    addNotification,
    handleRetryFailedRevisionBlocks: useCallback((sessionDir: string, fileId?: string) => handleRetryFailedRevisionBlocksRef.current(sessionDir, fileId), []),
  });

  const {
    duplicatePrompt,
    setDuplicatePrompt,
    isDragging,
    enqueueUniqueFiles,
    handleDuplicateAddAgain,
    handleBrowseClick,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useQueueIngest({
    filesRef,
    archiveSessionsRef,
    pendingArchiveReplacementsRef,
    setArchiveSessions,
    setArchiveTotal,
    dispatch,
    appState,
    appStateRef,
    apiReady,
    appendConsole,
  });

  const {
    confirmAction,
    setConfirmAction,
    confirmModalCopy,
    handleConfirmAction,
    requestQuitConfirmation,
  } = useConfirmModal({
    dispatch,
    filesRef,
    foldersRef,
    setFolders,
    setArchiveSessions,
    setArchiveTotal,
    refreshArchiveSessions,
    startProcessingRef,
    executeRetryFromArchive,
    normalizeSessionDir,
    appendConsole,
  });

  const {
    handleRetryFailedRevisionBlocks,
    handleRevisionWarning,
  } = useRevisionRetry({
    filesRef,
    archiveSessionsRef,
    normalizeSessionDir,
    dispatch,
    setArchiveSessions,
    refreshArchiveSessions,
    addNotification,
    setConfirmAction,
  });

  const {
    batchTotal,
    batchCompleted,
    completionFlash,
    setCompletionFlash,
    startProcessing,
    onFileContinued,
    onBatchReset,
    onBatchFullyDone,
  } = useQueueProcessing({
    filesRef,
    appStateRef,
    apiKey,
    preferredModel,
    fallbackModels,
    dispatch,
    appendConsole,
    setConfirmAction,
    refreshArchiveSessions,
  });

  const { preview, openPreview, openSharedSession, closePreview, relinkPreviewAudio, handleAudioStateChange, handleScrollTopChange, handleCollaborationStateChange } = usePreview({ appendConsole, dispatch, setArchiveSessions, onOpenFailed: handleOpenFailed, onArchiveRefresh: refreshArchiveSessions });

  const {
    regeneratePrompt,
    setRegeneratePrompt,
    regenDirtyConfirm,
    handleRegenerateAnswer,
    handleRegenDirtyConfirm,
    handleRegenDirtyCancel,
  } = useRegenerateDialog({
    previewContent: preview.content,
    previewSessionDir: preview.sessionDir,
    closePreview,
  });

  useSystemNotificationTriggers({
    configRecoveredFrom,
    updateAvailable,
    addNotification,
    removeNotificationByDedupeKey,
    isPeakDismissed,
    setIsPeakDismissed,
  });

  const [isJoinRoomOpen, setIsJoinRoomOpen] = useState(false);
  const [hasOpenedPreview, setHasOpenedPreview] = useState(false);
  const shouldRenderPreview = preview.content !== null || hasOpenedPreview;

  useEffect(() => {
    if (preview.content !== null) {
      setHasOpenedPreview(true);
    }
  }, [preview.content]);

  useLayoutEffect(() => {
    installUpdateRef.current = installUpdate;
    handleRetryFailedRevisionBlocksRef.current = handleRetryFailedRevisionBlocks;
    startProcessingRef.current = startProcessing;
    filesRef.current = files;
    appStateRef.current = appState;
    autoContinueRef.current = autoContinue;
  }, [installUpdate, handleRetryFailedRevisionBlocks, startProcessing, files, appState, autoContinue]);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEYS.AUTO_CONTINUE, String(autoContinue)); } catch (_) {}
  }, [autoContinue]);

  const hasApiKey = Boolean(apiKey.trim());
  const isApiKeyValid = GEMINI_KEY_PATTERN.test(apiKey.trim());
  const isConsoleDisabled = !hasApiKey || !isApiKeyValid || !(files.length > 0 || appState === 'processing' || appState === 'canceling' || completionFlash);

  useEffect(() => {
    document.title = appState === 'processing' ? '⏳ El Sbobinator' : 'El Sbobinator';
  }, [appState]);

  useEffect(() => {
    if (appState !== 'processing' && confirmAction?.type === 'stop-processing') {
      setConfirmAction(null);
    }
  }, [appState, confirmAction, setConfirmAction]);

  const requestRemoveFile = useCallback((id: string) => {
    const targetFile = filesRef.current.find(file => file.id === id);
    if (!targetFile) return;
    if (appStateRef.current !== 'idle' && targetFile.status !== 'done') return;
    setConfirmAction({ type: 'remove-file', fileId: id, fileName: targetFile.name, isDone: targetFile.status === 'done' });
  }, [setConfirmAction]);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || appState !== 'idle') return;
    const fromIndex = files.findIndex(f => f.id === active.id);
    const toIndex = files.findIndex(f => f.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    dispatch({ type: 'queue/reorder', fromIndex, toIndex });
  }, [appState, files]);

  const handleClearAll = useCallback(() => {
    setConfirmAction({ type: 'clear-all' });
  }, [setConfirmAction]);

  const openFile = useCallback(async (path: string) => {
    if (!window.pywebview?.api) return;
    const res = await window.pywebview.api.open_file(path);
    if (res && !res.ok) appendConsole(`❌ Impossibile aprire il file: ${res.error ?? path}`);
  }, [appendConsole]);

  useQueuePersistence(files, structuralVersion, dispatch, appendConsole);
  useBridgeCallbacks({
    dispatch,
    appendConsole,
    filesRef,
    appStateRef,
    enqueueUniqueFiles,
    setRegeneratePrompt,
    setAskNewKeyPrompt,
    autoContinueRef,
    startProcessingRef,
    onFileContinued,
    onBatchReset,
    onBatchFullyDone,
    clearCompletionFlash: () => setCompletionFlash(false),
    onRevisionWarning: handleRevisionWarning,
    addNotification,
    batchTotal,
    onDownloadProgress: handleDownloadProgress,
    onRequestQuitConfirmation: requestQuitConfirmation,
  });
  useBodyScrollLock(isSettingsOpen || regeneratePrompt !== null || preview.content !== null || askNewKeyPrompt || confirmAction !== null || duplicatePrompt !== null || regenDirtyConfirm !== null);

  const handleQueueRetry = useCallback((id: string) => {
    dispatch({ type: 'queue/retry_one', id });
  }, [dispatch]);

  const handleQueueStart = useCallback(() => {
    void startProcessingRef.current();
  }, []);

  const handleQueueStop = useCallback(() => {
    setConfirmAction({ type: 'stop-processing' });
  }, [setConfirmAction]);

  const handleOpenSettings = useCallback(() => {
    setIsSettingsOpen(true);
  }, [setIsSettingsOpen]);

  const handleRemoveDoneFile = useCallback((id: string) => {
    const f = filesRef.current.find(item => item.id === id);
    if (!f) return;
    if (appStateRef.current !== 'idle' && f.status !== 'done') return;
    setConfirmAction({ type: 'remove-file', fileId: id, fileName: f.name, isDone: true });
  }, [setConfirmAction]);

  return (
    <div className="app-shell h-screen overflow-hidden font-sans flex flex-row bg-[var(--bg-base)] text-[var(--text-secondary)]">
      <NavSidebar
        activePage={activePage}
        setActivePage={setActivePage}
        apiReady={apiReady}
        bridgeDelayed={bridgeDelayed}
        hasApiKey={hasApiKey}
        isApiKeyValid={isApiKeyValid}
        appState={appState}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        showConsole={showConsole}
        setShowConsole={setShowConsole}
        setIsSettingsOpen={setIsSettingsOpen}
        hasPendingUpdate={updateAvailable !== null}
        consoleDisabled={isConsoleDisabled}
        unreadNotificationsCount={unreadNotificationsCount}
        isNotificationsOpen={isNotificationsOpen}
        setIsNotificationsOpen={setIsNotificationsOpen}
        shakeBell={shakeBell}
      />

      <div className="flex flex-col flex-1 min-w-0 h-screen overflow-hidden">
        <AnimatePresence mode="wait">
          {activePage === 'queue' ? (
            <QueuePage
              files={files}
              progress={{
                appState,
                currentPhase,
                currentModel,
                activeProgress,
                workDone,
                workTotals,
                batchCompleted,
                batchTotal,
                completionFlash,
              }}
              auth={{
                apiReady,
                bridgeDelayed,
                apiKey,
                setApiKey,
                hasProtectedKey,
                apiKeyInsecure,
                setApiKeyInsecure,
                apiKeyInsecureReason,
                setApiKeyInsecureReason,
                fallbackKeys,
                preferredModel,
                fallbackModels,
              }}
              ingest={{
                isDragging,
                handleDragOver,
                handleDragLeave,
                handleDrop,
                handleBrowseClick,
              }}
              console={{
                showConsole,
                setShowConsole,
                consoleLogs,
                isConsoleExpanded,
                setIsConsoleExpanded,
                appendConsole,
              }}
              actions={{
                requestRemoveFile,
                handleClearAll,
                handleQueueRetry,
                openPreview,
                openFile,
                handleQueueStart,
                handleQueueStop,
                handleOpenSettings,
                handleRemoveDoneFile,
                setConfirmAction,
                handleRetryFailedRevisionBlocks,
              }}
              autoContinue={autoContinue}
              setAutoContinue={setAutoContinue}
              archiveSessions={archiveSessions}
              isArchiveLoaded={isArchiveLoaded}
              completedSessionFolderMap={completedSessionFolderMap}
              dndSensors={dndSensors}
              handleDragEnd={handleDragEnd}
              setIsJoinRoomOpen={setIsJoinRoomOpen}
            />
          ) : (
            <motion.main
              key="archive"
              className="flex-1 w-full flex flex-col overflow-y-auto hide-scrollbar"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="flex-1 px-5 sm:px-6 py-8 flex flex-col max-w-4xl w-full mx-auto">
                <React.Suspense fallback={null}>
                  <ArchivePage
                    sessions={archiveFiltered}
                    total={archiveTotal - (archiveSessions.length - archiveFiltered.length)}
                    folders={folders}
                    onFoldersChange={handleFoldersChange}
                    onPreview={openPreview}
                    onOpenFile={openFile}
                    onDeleteSession={(sessionDir, name) => setConfirmAction({ type: 'delete-archive-session', sessionDir, name })}
                    onDeleteMultipleSessions={(sessionsList) => setConfirmAction({ type: 'delete-multiple-archive-sessions', sessions: sessionsList })}
                    onRefresh={refreshArchiveSessions}
                    onLoadAll={handleLoadAll}
                    onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
                  />
                </React.Suspense>
              </div>
              <footer className="app-footer">
                <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_URL); }} className="footer-link">
                  <GithubIcon className="w-3.5 h-3.5" /> Progetto Open-Source — GitHub
                </a>
                <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(KOFI_URL); }} className="footer-link">
                  ☕ Offrimi un caffè su Ko-fi!
                </a>
              </footer>
            </motion.main>
          )}
        </AnimatePresence>
      </div>

      <RegenerateModal
        prompt={regeneratePrompt}
        onAnswer={handleRegenerateAnswer}
        onDismiss={() => void handleRegenerateAnswer(null)}
      />
      <NewKeyModal isOpen={askNewKeyPrompt} onClose={() => setAskNewKeyPrompt(false)} />
      <DuplicateFileModal
        prompt={duplicatePrompt}
        onDismiss={() => setDuplicatePrompt(null)}
        onAddAgain={handleDuplicateAddAgain}
      />
      <ConfirmActionModal
        isOpen={confirmAction !== null && confirmModalCopy !== null}
        title={confirmModalCopy?.title ?? ''}
        description={confirmModalCopy?.description ?? ''}
        confirmLabel={confirmModalCopy?.confirmLabel ?? ''}
        cancelLabel={confirmModalCopy?.cancelLabel}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
      />
      <ConfirmActionModal
        isOpen={regenDirtyConfirm !== null}
        title="Conferma rigenerazione"
        description={`La rigenerazione sovrascriverà il testo revisionato di "${regenDirtyConfirm?.filename ?? ''}". Vuoi procedere comunque?`}
        confirmLabel="Rigenera comunque"
        cancelLabel="Annulla"
        onClose={() => void handleRegenDirtyCancel()}
        onConfirm={() => void handleRegenDirtyConfirm()}
      />
      {shouldRenderSettings && (
        <React.Suspense fallback={null}>
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => {
              setIsSettingsOpen(false);
            }}
            appendConsole={appendConsole}
            onSettingsSaved={refreshSettings}
            auth={{
              apiKey,
              setApiKey,
              hasProtectedKey,
              fallbackKeys,
              setFallbackKeys,
            }}
            models={{
              preferredModel,
              setPreferredModel,
              fallbackModels,
              setFallbackModels,
              availableModels,
            }}
            updater={{
              latestVersion,
              checkForUpdates,
              isCheckingUpdate,
              hasChecked,
              checkFailed,
              updateInstallState,
              onInstallUpdate: installUpdate,
            }}
            storage={{
              onSessionRootMoved: handleSessionRootMoved,
            }}
          />
        </React.Suspense>
      )}
      {shouldRenderPreview && (
        <React.Suspense fallback={null}>
          <EditorFullPage
            previewContent={preview.content}
            previewTitle={preview.title}
            htmlPath={preview.path}
            onClose={closePreview}
            audioSrc={preview.audioSrc}
            audioRelinkNeeded={preview.audioRelinkNeeded}
            onRelink={relinkPreviewAudio}
            previewInitAudio={preview.initAudio}
            previewInitScrollTop={preview.initScrollTop}
            initialSearchTerm={preview.initialSearchTerm}
            initialRoom={preview.initialRoom}
            initialUser={preview.initialUser}
            themeMode={themeMode}
            setThemeMode={setThemeMode}
            onAudioStateChange={handleAudioStateChange}
            onScrollTopChange={handleScrollTopChange}
            onCollaborationStateChange={handleCollaborationStateChange}
          />
        </React.Suspense>
      )}
      <JoinRoomModal
        isOpen={isJoinRoomOpen}
        onClose={() => setIsJoinRoomOpen(false)}
        onJoinRoom={(room, user) => {
          openSharedSession(room, user.name, user.color);
        }}
      />
      <NotificationDropdown
        isOpen={isNotificationsOpen}
        onClose={() => setIsNotificationsOpen(false)}
        notifications={notifications}
        onMarkAsRead={markNotificationAsRead}
        onMarkAllAsRead={markAllNotificationsAsRead}
        onDelete={deleteNotification}
        onClearAll={clearAllNotifications}
        onNotificationClick={(notification) => {
          if (notification.category === 'update' || notification.action?.type === 'open_settings') {
            setIsNotificationsOpen(false);
            setIsSettingsOpen(true);
          }
        }}
        align="left"
        leftOffset={72}
        valign="bottom"
        bottomOffset={16}
      />
    </div>
  );
}

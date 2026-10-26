import { credentialStorageWarning } from '../credentialStorage';
import React, { useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { AlertTriangle, Loader2, Settings } from 'lucide-react';
import { GithubIcon } from './icons/GithubIcon';
import { GITHUB_URL } from '../branding';
import { ReportProblemLink } from './ReportProblemLink';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { type AppStatus, type FileItem, type ProcessingWarning, getDoneFiles, getPendingFiles } from '../appState';
import { GEMINI_KEY_PATTERN } from '../utils';
import { STORAGE_KEYS } from '../storageKeys';
import { ProcessingStatusBanner } from './ProcessingStatusBanner';
import { DropOverlay, DropZone } from './DropZone';
import { WelcomeDashboard } from './WelcomeDashboard';
import { QueueSection } from './QueueSection';
import { CompletedSection } from './CompletedSection';
import { AutoHeight } from './AutoHeight';
import { fade, fadeUp } from '../motion';
import { ConsolePanel } from './ConsolePanel';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const SetupPage = React.lazy(() => import('./SetupPage').then(m => ({ default: m.SetupPage })));

export type UiMode = 'loading' | 'setup' | 'ready-empty' | 'ready-with-files' | 'processing' | 'canceling';

export interface QueueProgressProps {
  appState: AppStatus;
  currentPhase: string;
  currentModel: string;
  activeProgress: number;
  workDone: { chunks: number; macro: number };
  workTotals: { chunks: number; macro: number };
  processingWarnings: ProcessingWarning[];
  batchCompleted: number;
  batchTotal: number;
  completionFlash: boolean;
}

export interface QueueAuthProps {
  apiReady: boolean;
  bridgeDelayed: boolean;
  apiKey: string;
  setApiKey: (key: string) => void;
  hasProtectedKey: boolean;
  apiKeyInsecure: boolean;
  setApiKeyInsecure: (val: boolean) => void;
  apiKeyInsecureReason: string;
  setApiKeyInsecureReason: (val: string) => void;
  fallbackKeys: string[];
  preferredModel: string;
  setPreferredModel?: (model: string) => void;

}

export interface QueueIngestProps {
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e?: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleBrowseClick: () => void;
}

export interface QueueConsoleProps {
  showConsole: boolean;
  setShowConsole: (val: boolean) => void;
  consoleLogs: string[];
  isConsoleExpanded: boolean;
  setIsConsoleExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  appendConsole: (msg: string) => void;
}

export interface QueueActionProps {
  requestRemoveFile: (id: string) => void;
  handleClearAll: () => void;
  handleQueueRetry: (id: string) => void;
  handleQueueResumeAll?: () => void;
  openPreview: (htmlPath: string, title?: string, inputPath?: string, placeholder?: string, sessionDir?: string) => void;
  openFile: (path: string) => void;
  handleQueueStart: () => void;
  handleQueueStop: () => void;
  handleOpenSettings: () => void;
  handleRemoveDoneFile: (id: string) => void;
  handleRetryFailedRevisionBlocks: (sessionDir: string, fileId?: string) => Promise<void>;
}

export interface QueuePageProps {
  files: FileItem[];
  progress: QueueProgressProps;
  auth: QueueAuthProps;
  ingest: QueueIngestProps;
  console: QueueConsoleProps;
  actions: QueueActionProps;
  autoContinue: boolean;
  setAutoContinue: React.Dispatch<React.SetStateAction<boolean>>;
  archiveSessions: ArchiveSession[];
  isArchiveLoaded: boolean;
  completedSessionFolderMap: Map<string, ArchiveFolder>;
  dndSensors: SensorDescriptor<SensorOptions>[];
  handleDragEnd: (event: DragEndEvent) => void;
  onOpenArchive?: () => void;
}

// The dashboard shows the latest few; the archive keeps every transcript.
export function QueuePage({
  files,
  progress,
  auth,
  ingest,
  console: consoleState,
  actions,
  autoContinue,
  setAutoContinue,
  archiveSessions,
  isArchiveLoaded,
  completedSessionFolderMap,
  dndSensors,
  handleDragEnd,
  onOpenArchive,
}: QueuePageProps) {
  const {
    appState,
    currentPhase,
    currentModel,
    activeProgress,
    workDone,
    workTotals,
    processingWarnings,
    batchCompleted,
    batchTotal,
    completionFlash,
  } = progress;

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
    fallbackKeys,
    preferredModel,
    setPreferredModel,

  } = auth;

  const {
    isDragging,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleBrowseClick,
  } = ingest;

  const {
    showConsole,
    setShowConsole,
    consoleLogs,
    isConsoleExpanded,
    setIsConsoleExpanded,
    appendConsole,
  } = consoleState;

  const {
    requestRemoveFile,
    handleClearAll,
    handleQueueRetry,
    handleQueueResumeAll,
    openPreview,
    openFile,
    handleQueueStart,
    handleQueueStop,
    handleOpenSettings,
    handleRemoveDoneFile,
    handleRetryFailedRevisionBlocks,
  } = actions;

  const pendingFiles = useMemo(() => getPendingFiles(files), [files]);
  const doneFiles = useMemo(() => getDoneFiles(files), [files]);
  const { queuedCount, failedCount } = useMemo(() => {
    let queued = 0;
    let failed = 0;
    for (const f of files) {
      if (f.status === 'queued') queued++;
      else if (f.status === 'error' || f.status === 'paused') failed++;
    }
    return { queuedCount: queued, failedCount: failed };
  }, [files]);

  const hasApiKey = Boolean(apiKey.trim() || hasProtectedKey);
  const isApiKeyValid = hasProtectedKey || GEMINI_KEY_PATTERN.test(apiKey.trim());
  const handleNetworkChange = useCallback((online: boolean) => {
    if (online) {
      appendConsole('✅ Connessione a Internet ripristinata.');
    } else {
      appendConsole('⚠️ Connessione a Internet interrotta.');
    }
  }, [appendConsole]);
  const isOnline = useOnlineStatus(handleNetworkChange);
  const canStart = (queuedCount > 0 || failedCount > 0) && hasApiKey && isApiKeyValid && isOnline;
  const canResumeAll = failedCount > 0 && hasApiKey && isApiKeyValid && isOnline;

  const uiMode: UiMode =
    !apiReady ? 'loading' :
    appState === 'canceling' ? 'canceling' :
    appState === 'processing' ? 'processing' :
    (!hasApiKey || !isApiKeyValid) ? 'setup' :
    (queuedCount > 0 || failedCount > 0) ? 'ready-with-files' : 'ready-empty';

  const lastConsoleMessage = consoleLogs.length > 0 ? consoleLogs[consoleLogs.length - 1] : 'Pronto per iniziare.';
  const showProcessingBanner = appState === 'processing' || appState === 'canceling' || completionFlash;
  const apiKeyInsecureReasonLabel = apiKeyInsecureReason.trim() || 'Credenziali presenti in chiaro nel file di configurazione.';
  const bannerFile = useMemo(
    () => files.find(f => f.status === 'processing' || f.isRetryingBlocks) ?? (completionFlash ? doneFiles[0] : undefined),
    [files, completionFlash, doneFiles],
  );
  const hasWork = pendingFiles.length > 0 || doneFiles.length > 0 || showProcessingBanner;
  const isConsoleDisabled = !hasApiKey || !isApiKeyValid || !hasWork;

  // Only file drags light up the page; nested dragleave events (moving between
  // children) are ignored so the overlay never flickers while crossing the page.
  const isFileDrag = (e: React.DragEvent) => {
    const types = e.dataTransfer?.types;
    return !types || Array.from(types).includes('Files');
  };
  const onPageDragOver = useCallback((e: React.DragEvent) => {
    if (isFileDrag(e)) handleDragOver(e);
  }, [handleDragOver]);
  const onPageDragLeave = useCallback((e: React.DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    handleDragLeave(e);
  }, [handleDragLeave]);

  useEffect(() => {
    if (!isDragging) return;
    const clear = () => handleDragLeave();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clear();
    };
    // A drag cancelled or dropped outside the page never reaches the main element.
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('dragend', clear);
    window.addEventListener('drop', clear);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('dragend', clear);
      window.removeEventListener('drop', clear);
    };
  }, [isDragging, handleDragLeave]);

  useEffect(() => {
    if (isConsoleDisabled && showConsole) {
      setShowConsole(false);
      localStorage.setItem(STORAGE_KEYS.SHOW_CONSOLE, 'false');
    }
  }, [isConsoleDisabled, showConsole, setShowConsole]);

  return (
    <motion.main
      key="queue"
      className="flex-1 w-full flex flex-col overflow-y-auto app-scroll"
      {...fade}
      onDragOver={onPageDragOver}
      onDragLeave={onPageDragLeave}
      onDrop={handleDrop}
    >
      <DropOverlay visible={isDragging && uiMode !== 'setup' && uiMode !== 'loading'} />
      {/* With work on the page the column stays anchored to the top: a vertically
          centred column would shift everything above when the banner swaps in. */}
      <div
        data-testid="queue-column"
        className={`${hasWork ? 'mb-auto' : 'my-auto'} px-5 sm:px-6 py-8 flex flex-col gap-8 max-w-3xl w-full mx-auto`}
      >
        {apiKeyInsecure && (
          <motion.div
            key="api-key-insecure-banner"
            {...fadeUp}
            className="w-full alert-card is-warning px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3 text-sm leading-relaxed text-[var(--warning-text)]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                {apiKeyInsecureReasonLabel}
              </span>
            </div>
            <button
              type="button"
              onClick={handleOpenSettings}
              className="shrink-0 premium-button-secondary compact-button is-warning flex items-center justify-center gap-2"
            >
              <Settings className="w-4 h-4" />
              Gestisci credenziali
            </button>
          </motion.div>
        )}
        {uiMode === 'loading' ? (
          <motion.div
            key="connecting-loader"
            {...fadeUp}
            className="premium-panel py-12 px-6 flex flex-col items-center justify-center gap-4 text-center max-w-md mx-auto w-full"
          >
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--accent-text)' }} />
            <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}>
              Connessione in corso...
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Inizializzazione dell'applicazione e caricamento delle impostazioni.
            </p>
            {bridgeDelayed && (
              <motion.div
                {...fade}
                className="alert-card is-error p-3 rounded-lg text-xs leading-relaxed max-w-sm mt-2 text-[var(--error-text)]"
              >
                Il motore dell'applicazione sta impiegando più tempo del previsto.
                Verifica se l'app è bloccata o prova a riavviare.
              </motion.div>
            )}
          </motion.div>
        ) : uiMode === 'setup' ? (
          <React.Suspense fallback={null}>
            <SetupPage
              hasProtectedKey={hasProtectedKey}
              onSaved={(key, model, storage, legacyPlaintext) => {
                const warning = credentialStorageWarning(storage, legacyPlaintext);
                setApiKeyInsecure(Boolean(warning));
                setApiKeyInsecureReason(warning);
                setApiKey(key);
                if (model && setPreferredModel) {
                  setPreferredModel(model);
                }
              }}
              preferredModel={preferredModel}
              fallbackKeys={fallbackKeys}
            />
          </React.Suspense>
        ) : (
          <>
            {!hasWork && (
              <WelcomeDashboard archiveSessions={archiveSessions} isArchiveLoaded={isArchiveLoaded} />
            )}
            {/* Fade-through: the dropzone fades out, the slot settles to the banner's
                height, then the banner fades in. Nothing slides across the page. */}
            <AutoHeight testId="processing-slot">
              <AnimatePresence mode="wait" initial={false}>
                {showProcessingBanner ? (
                  <motion.div key="processing-banner" data-testid="processing-banner-slot" {...fade}>
                    <ProcessingStatusBanner
                      appState={appState}
                      currentPhase={completionFlash ? '__completed__' : currentPhase}
                      currentModel={currentModel}
                      activeProgress={completionFlash ? 100 : activeProgress}
                      workTotals={workTotals}
                      workDone={workDone}
                      currentFileIndex={batchCompleted}
                      currentBatchTotal={batchTotal}
                      currentFileName={bannerFile?.name}
                      startedAt={bannerFile?.startedAt}
                      warnings={processingWarnings}
                      onStop={handleQueueStop}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="dropzone" {...fade}>
                    <DropZone
                      compact={pendingFiles.length > 0 || doneFiles.length > 0}
                      isDragging={isDragging}
                      onClick={handleBrowseClick}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </AutoHeight>
          </>
        )}

        {uiMode !== 'setup' && uiMode !== 'loading' && (
          <>
            <QueueSection
              pendingFiles={pendingFiles}
              progress={progress}
              auth={auth}
              status={{
                queuedCount,
                failedCount,
                canStart,
                canResumeAll,
                hasApiKey,
                isApiKeyValid,
                isOnline,
                autoContinue,
                setAutoContinue,
              }}
              dnd={{
                sensors: dndSensors,
                onDragEnd: handleDragEnd,
              }}
              actions={{
                onRemove: requestRemoveFile,
                onClearAll: handleClearAll,
                onRetry: handleQueueRetry,
                onResumeAll: handleQueueResumeAll,
                onPreview: openPreview,
                onOpenFile: openFile,
                onStart: handleQueueStart,
                onOpenSettings: handleOpenSettings,
                onAddFiles: handleBrowseClick,
              }}
            />

            <CompletedSection
              doneFiles={doneFiles}
              onRemove={handleRemoveDoneFile}
              onPreview={openPreview}
              onOpenFile={openFile}
              onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
              sessionFolderMap={completedSessionFolderMap}
              onOpenArchive={onOpenArchive}
            />
          </>
        )}

        {showConsole && uiMode !== 'setup' && uiMode !== 'loading' && (
          <ConsolePanel
            consoleLogs={consoleLogs}
            lastConsoleMessage={lastConsoleMessage}
            appState={appState}
            isConsoleExpanded={isConsoleExpanded}
            setIsConsoleExpanded={setIsConsoleExpanded}
          />
        )}
      </div>
      <footer className="app-footer app-footer-links">
        <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_URL); }} className="footer-link">
          <GithubIcon className="w-3.5 h-3.5" /> Progetto Open-Source — GitHub
        </a>
        <ReportProblemLink />
      </footer>
    </motion.main>
  );
}

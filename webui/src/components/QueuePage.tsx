import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { AlertTriangle, ArrowRight, Loader2, Trash2, Users } from 'lucide-react';
import { GithubIcon } from './icons/GithubIcon';
import { GITHUB_URL, KOFI_URL } from '../branding';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { type AppStatus, type FileItem, getDoneFiles, getPendingFiles } from '../appState';
import { GEMINI_KEY_PATTERN } from '../utils';
import { STORAGE_KEYS } from '../storageKeys';
import { ProcessingStatusBanner } from './ProcessingStatusBanner';
import { DropZone } from './DropZone';
import { WelcomeDashboard } from './WelcomeDashboard';
import { QueueSection } from './QueueSection';
import { CompletedSection } from './CompletedSection';
import { ConsolePanel } from './ConsolePanel';
import type { ConfirmAction } from '../hooks/useConfirmModal';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

const SetupPage = React.lazy(() => import('./SetupPage').then(m => ({ default: m.SetupPage })));

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type UiMode = 'loading' | 'setup' | 'ready-empty' | 'ready-with-files' | 'processing' | 'canceling';

export interface QueueProgressProps {
  appState: AppStatus;
  currentPhase: string;
  currentModel: string;
  activeProgress: number;
  workDone: { chunks: number; macro: number };
  workTotals: { chunks: number; macro: number };
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
  fallbackModels: string[];
}

export interface QueueIngestProps {
  isDragging: boolean;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
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
  openPreview: (htmlPath: string, title?: string, inputPath?: string, placeholder?: string, sessionDir?: string) => void;
  openFile: (path: string) => void;
  handleQueueStart: () => void;
  handleQueueStop: () => void;
  handleOpenSettings: () => void;
  handleRemoveDoneFile: (id: string) => void;
  setConfirmAction: (action: ConfirmAction | null) => void;
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
  setIsJoinRoomOpen: (val: boolean) => void;
}

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
  setIsJoinRoomOpen,
}: QueuePageProps) {
  const {
    appState,
    currentPhase,
    currentModel,
    activeProgress,
    workDone,
    workTotals,
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
    fallbackModels,
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
    openPreview,
    openFile,
    handleQueueStart,
    handleQueueStop,
    handleOpenSettings,
    handleRemoveDoneFile,
    setConfirmAction,
    handleRetryFailedRevisionBlocks,
  } = actions;
  const [isRemovingInsecureKey, setIsRemovingInsecureKey] = useState(false);

  const pendingFiles = useMemo(() => getPendingFiles(files), [files]);
  const doneFiles = useMemo(() => getDoneFiles(files), [files]);
  const { queuedCount } = useMemo(() => {
    let count = 0;
    for (const f of files) { if (f.status === 'queued') count++; }
    return { queuedCount: count };
  }, [files]);

  const hasApiKey = Boolean(apiKey.trim());
  const isApiKeyValid = GEMINI_KEY_PATTERN.test(apiKey.trim());
  const handleNetworkChange = useCallback((online: boolean) => {
    if (online) {
      appendConsole('Connessione a Internet ripristinata.');
    } else {
      appendConsole('⚠️ Connessione a Internet interrotta.');
    }
  }, [appendConsole]);
  const isOnline = useOnlineStatus(handleNetworkChange);
  const canStart = queuedCount > 0 && hasApiKey && isApiKeyValid && isOnline;

  const uiMode: UiMode =
    !apiReady ? 'loading' :
    appState === 'canceling' ? 'canceling' :
    appState === 'processing' ? 'processing' :
    (!hasApiKey || !isApiKeyValid) ? 'setup' :
    queuedCount > 0 ? 'ready-with-files' : 'ready-empty';

  const lastConsoleMessage = consoleLogs.length > 0 ? consoleLogs[consoleLogs.length - 1] : 'Pronto per iniziare.';
  const showProcessingBanner = appState === 'processing' || appState === 'canceling' || completionFlash;
  const apiKeyInsecureReasonLabel = apiKeyInsecureReason.trim() || 'DPAPI non disponibile.';
  const bannerFile = useMemo(
    () => files.find(f => f.status === 'processing') ?? (completionFlash ? doneFiles[0] : undefined),
    [files, completionFlash, doneFiles],
  );
  const isConsoleDisabled = !hasApiKey || !isApiKeyValid || !(pendingFiles.length > 0 || doneFiles.length > 0 || showProcessingBanner);

  useEffect(() => {
    if (isConsoleDisabled && showConsole) {
      setShowConsole(false);
      localStorage.setItem(STORAGE_KEYS.SHOW_CONSOLE, 'false');
    }
  }, [isConsoleDisabled, showConsole, setShowConsole]);

  const handleRemoveInsecureApiKey = useCallback(async () => {
    if (isRemovingInsecureKey) return;
    setIsRemovingInsecureKey(true);
    try {
      const result = await window.pywebview?.api?.save_settings?.('', fallbackKeys, preferredModel, fallbackModels);
      if (!result?.ok) {
        appendConsole(`❌ Errore rimozione chiave API: ${result?.error ?? 'errore sconosciuto'}`);
        return;
      }
      setApiKey('');
      setApiKeyInsecure(false);
      setApiKeyInsecureReason('');
      appendConsole('Chiave API rimossa dal disco.');
    } catch (error: unknown) {
      appendConsole(`❌ Errore rimozione chiave API: ${getErrorMessage(error)}`);
    } finally {
      setIsRemovingInsecureKey(false);
    }
  }, [
    appendConsole,
    fallbackKeys,
    fallbackModels,
    isRemovingInsecureKey,
    preferredModel,
    setApiKey,
    setApiKeyInsecure,
    setApiKeyInsecureReason,
  ]);

  return (
    <motion.main
      key="queue"
      className="flex-1 w-full flex flex-col overflow-y-auto hide-scrollbar"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="my-auto px-5 sm:px-6 py-8 flex flex-col gap-5 max-w-3xl w-full mx-auto">
        {apiKeyInsecure && (
          <motion.div
            key="api-key-insecure-banner"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="w-full alert-card is-warning px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          >
            <div className="flex items-start gap-3 text-sm leading-relaxed text-[var(--warning-text)]">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                La tua chiave API è salvata in chiaro su disco perché la protezione Windows (DPAPI) non è disponibile. Motivo: {apiKeyInsecureReasonLabel} Cancella e reinserisci la chiave, oppure conservala in un password manager.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleRemoveInsecureApiKey()}
              disabled={isRemovingInsecureKey}
              className="shrink-0 premium-button-secondary compact-button is-warning flex items-center justify-center gap-2"
            >
              <Trash2 className="w-4 h-4" />
              {isRemovingInsecureKey ? 'Rimozione...' : 'Rimuovi chiave'}
            </button>
          </motion.div>
        )}
        {uiMode === 'loading' ? (
          <motion.div
            key="connecting-loader"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
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
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
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
              onSaved={(key) => setApiKey(key)}
              preferredModel={preferredModel}
              fallbackKeys={fallbackKeys}
              fallbackModels={fallbackModels}
            />
          </React.Suspense>
        ) : (
          <>
            {!(pendingFiles.length > 0 || doneFiles.length > 0 || showProcessingBanner) && (
              <WelcomeDashboard archiveSessions={archiveSessions} isArchiveLoaded={isArchiveLoaded} />
            )}
            <AnimatePresence>
              {showProcessingBanner ? (
                <motion.div
                  key="processing-banner"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
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
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="dropzone"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className={!(pendingFiles.length > 0 || doneFiles.length > 0) ? 'space-y-3' : undefined}
                >
                  {pendingFiles.length > 0 || doneFiles.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <DropZone
                          compact={true}
                          isDragging={isDragging}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onClick={handleBrowseClick}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsJoinRoomOpen(true)}
                        className="dropzone-compact-join-btn"
                        title="Partecipa a una sessione live con codice stanza"
                        aria-label="Partecipa a una sessione live con codice stanza"
                      >
                        <Users className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                        <span className="hidden sm:inline">Codice stanza</span>
                      </button>
                    </div>
                  ) : (
                    <>
                      <DropZone
                        compact={false}
                        isDragging={isDragging}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={handleBrowseClick}
                      />
                      <button
                        type="button"
                        onClick={() => setIsJoinRoomOpen(true)}
                        className="join-room-hero-card"
                        title="Partecipa a una sessione collaborativa live con codice stanza"
                        aria-label="Partecipa alla sessione live"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="join-room-hero-icon">
                            <Users className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 text-left">
                            <div className="text-sm font-semibold text-[var(--text-primary)]">
                              Hai un codice stanza?
                            </div>
                            <div className="text-xs text-[var(--text-muted)] truncate">
                              Partecipa alla sessione di gruppo in tempo reale
                            </div>
                          </div>
                        </div>
                        <div className="join-room-hero-action">
                          <span>Partecipa</span>
                          <ArrowRight className="w-3.5 h-3.5 join-room-hero-arrow" />
                        </div>
                      </button>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
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
                canStart,
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
                onPreview: openPreview,
                onOpenFile: openFile,
                onStart: handleQueueStart,
                onStop: handleQueueStop,
                onOpenSettings: handleOpenSettings,
              }}
            />

            <CompletedSection
              doneFiles={doneFiles}
              appState={appState}
              onRemove={handleRemoveDoneFile}
              onPreview={openPreview}
              onOpenFile={openFile}
              onClearAll={() => setConfirmAction({ type: 'clear-completed', count: doneFiles.length })}
              onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
              sessionFolderMap={completedSessionFolderMap}
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
      <footer className="app-footer">
        <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_URL); }} className="footer-link">
          <GithubIcon className="w-3.5 h-3.5" /> Progetto Open-Source — GitHub
        </a>
        <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(KOFI_URL); }} className="footer-link">
          ☕ Offrimi un caffè su Ko-fi!
        </a>
      </footer>
    </motion.main>
  );
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useIsPresent } from 'motion/react';
import { type DragEndEvent, type SensorDescriptor, type SensorOptions } from '@dnd-kit/core';
import { Loader2 } from 'lucide-react';
import { AppFooterLinks } from './AppFooterLinks';
import { ConsoleHint } from './ConsoleHint';
import { ConsoleToggle } from './ConsoleToggle';
import { useConsoleHint } from '../hooks/useConsoleHint';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import { type AppStatus, type FileItem, type ProcessingWarning, type RunOutcome, getDoneFiles, getPendingFiles } from '../appState';
import { RunOutcomeBanner, type RunOutcomeActions } from './RunOutcomeBanner';
import { GEMINI_KEY_PATTERN, normalizeSessionPath } from '../utils';
import { STORAGE_KEYS } from '../storageKeys';
import { ProcessingStatusBanner } from './ProcessingStatusBanner';
import { DropOverlay, DropZone } from './DropZone';
import { WelcomeDashboard } from './WelcomeDashboard';
import { QueueSection } from './QueueSection';
import { CompletedSection } from './CompletedSection';
import { AutoHeight } from './AutoHeight';
import { fade, fadeUp, quickFade, unfold } from '../motion';
import { ConsolePanel } from './ConsolePanel';
import { useOnlineStatus } from '../hooks/useOnlineStatus';
import { settleRevisionRetry } from '../hooks/useRevisionRetry';

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
  /** What the last batch left to do; shown where the processing banner was. */
  runOutcome?: RunOutcome | null;
}

export interface QueueAuthProps {
  apiReady: boolean;
  bridgeDelayed: boolean;
  apiKey: string;
  setApiKey: (key: string) => void;
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
  handleQueueStart: () => void;
  handleQueueStop: () => void;
  handleOpenSettings: () => void;
  handleRemoveDoneFile: (id: string) => void;
  handleRetryFailedRevisionBlocks: (sessionDir: string, fileId?: string) => Promise<void>;
  handleDismissRunOutcome?: () => void;
  /** Settings opened on Archiviazione. */
  handleOpenStorageSettings?: () => void;
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
    runOutcome = null,
  } = progress;

  const {
    apiReady,
    bridgeDelayed,
    apiKey,
    setApiKey,
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
    handleQueueStart,
    handleQueueStop,
    handleOpenSettings,
    handleRemoveDoneFile,
    handleRetryFailedRevisionBlocks,
    handleDismissRunOutcome,
    handleOpenStorageSettings,
  } = actions;

  const pendingFiles = useMemo(() => getPendingFiles(files), [files]);
  const doneFiles = useMemo(() => getDoneFiles(files), [files]);
  // Web: only sbobine whose kept audio was actually read are known; an unread or missing one claims nothing.
  const keptAudioByDir = useMemo(() => new Map(archiveSessions.flatMap(session => {
    const bytes = session.kept_audio_bytes;
    return typeof bytes === 'number' ? [[normalizeSessionPath(session.session_dir), bytes > 0] as const] : [];
  })), [archiveSessions]);
  const { queuedCount, failedCount } = useMemo(() => {
    let queued = 0;
    let failed = 0;
    for (const f of files) {
      if (f.status === 'queued') queued++;
      else if (f.status === 'error' || f.status === 'paused') failed++;
    }
    return { queuedCount: queued, failedCount: failed };
  }, [files]);

  const hasApiKey = Boolean(apiKey.trim());
  const isApiKeyValid = GEMINI_KEY_PATTERN.test(apiKey.trim());
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
  const bannerFile = useMemo(
    () => files.find(f => f.status === 'processing' || f.isRetryingBlocks) ?? (completionFlash ? doneFiles[0] : undefined),
    [files, completionFlash, doneFiles],
  );
  const outcomeActions = useMemo<RunOutcomeActions>(() => ({
    onResume: handleQueueRetry,
    onRemove: requestRemoveFile,
    onOpenSettings: handleOpenSettings,
    onOpenStorage: handleOpenStorageSettings ?? handleOpenSettings,
    onOpenSbobina: (htmlPath, title, sessionDir) => openPreview(htmlPath, title, undefined, undefined, sessionDir),
    onReviseSections: (sessionDir, fileId) => { void settleRevisionRetry(handleRetryFailedRevisionBlocks(sessionDir, fileId)); },
    onDismiss: () => handleDismissRunOutcome?.(),
  }), [handleQueueRetry, requestRemoveFile, handleOpenSettings, handleOpenStorageSettings, openPreview, handleRetryFailedRevisionBlocks, handleDismissRunOutcome]);
  const showRunOutcome = Boolean(runOutcome) && !showProcessingBanner;
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

  const consoleHint = useConsoleHint(appState === 'processing', appState === 'idle' && batchTotal > 0, showConsole);
  // Opened from under the progress (the hint or the toggle), the console at the bottom of the
  // column is kept in view while it unfolds: the page follows its slot's growing edge frame by
  // frame, so it opens on screen rather than below it, until the slot settles. Scrolled once at
  // the end instead, the console grew unseen and the page moved only afterwards.
  const revealConsoleRef = useRef(false);
  const followConsoleFrameRef = useRef(0);
  const setConsoleOpen = useCallback((open: boolean, reveal = false) => {
    revealConsoleRef.current = open && reveal;
    setShowConsole(open);
    localStorage.setItem(STORAGE_KEYS.SHOW_CONSOLE, String(open));
  }, [setShowConsole]);
  const openConsoleFromHint = useCallback(() => setConsoleOpen(true, true), [setConsoleOpen]);
  const closeConsole = useCallback(() => setConsoleOpen(false), [setConsoleOpen]);
  // Closing, the console folds to the height of the toggle that takes its place below the lists
  // (measured when last shown), or away entirely during a run, when nothing does. Open since the
  // page loaded (its state persists), the console carries a hidden copy of the toggle to measure
  // until the real one has been shown: else it folded to nothing and the slot grew again for it.
  const consoleToggleBelow = !showProcessingBanner && !isConsoleDisabled;
  const [consoleToggleHeight, setConsoleToggleHeight] = useState(0);
  const measureToggleInConsole = consoleToggleBelow && consoleToggleHeight === 0;
  const measureConsoleToggle = useCallback((el: HTMLDivElement | null) => {
    if (el) setConsoleToggleHeight(el.offsetHeight);
  }, []);
  const consoleFoldTo = consoleToggleBelow ? consoleToggleHeight : 0;
  const stopFollowingConsole = useCallback(() => {
    cancelAnimationFrame(followConsoleFrameRef.current);
    followConsoleFrameRef.current = 0;
  }, []);
  useEffect(() => {
    if (!showConsole || !revealConsoleRef.current) return;
    revealConsoleRef.current = false;
    const follow = () => {
      keepConsoleSlotInView();
      followConsoleFrameRef.current = requestAnimationFrame(follow);
    };
    followConsoleFrameRef.current = requestAnimationFrame(follow);
    // In case the slot never reports settling (nothing to grow), the page stops following anyway.
    const giveUp = window.setTimeout(stopFollowingConsole, 1500);
    return () => {
      window.clearTimeout(giveUp);
      stopFollowingConsole();
    };
  }, [showConsole, stopFollowingConsole]);
  const consoleSlotSettled = useCallback(() => {
    if (!followConsoleFrameRef.current) return;
    keepConsoleSlotInView();
    stopFollowingConsole();
  }, [stopFollowingConsole]);

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
                Il caricamento sta impiegando più tempo del previsto.
                Prova a ricaricare la pagina.
              </motion.div>
            )}
          </motion.div>
        ) : uiMode === 'setup' ? (
          <React.Suspense fallback={null}>
            <SetupPage
              onSaved={(key, model) => {
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
                    <ConsoleHint visible={consoleHint.visible} onOpen={openConsoleFromHint} onDismiss={consoleHint.dismiss} />
                    {!consoleHint.visible && !isConsoleDisabled && (
                      <ConsoleToggle open={showConsole} onToggle={() => setConsoleOpen(!showConsole, true)} />
                    )}
                  </motion.div>
                ) : (
                  <motion.div key="dropzone" className="flex flex-col gap-4" {...fade}>
                    <AnimatePresence initial={false}>
                      {showRunOutcome && runOutcome && (
                        <motion.div key={`${runOutcome.kind}:${runOutcome.fileId}`} {...fade}>
                          <RunOutcomeBanner outcome={runOutcome} actions={outcomeActions} canResume={hasApiKey && isApiKeyValid && isOnline} />
                        </motion.div>
                      )}
                    </AnimatePresence>
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
                onStart: handleQueueStart,
                onOpenSettings: handleOpenSettings,
                onAddFiles: handleBrowseClick,
              }}
            />

            <CompletedSection
              doneFiles={doneFiles}
              onRemove={handleRemoveDoneFile}
              onPreview={openPreview}
              onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
              sessionFolderMap={completedSessionFolderMap}
              keptAudioByDir={keptAudioByDir}
              onOpenArchive={onOpenArchive}
            />
          </>
        )}

        {/* The console and, after a run, the toggle that stands in for it share one slot. Opening,
            the toggle fades out, then the slot grows to the console as it fades in; closing, the
            console folds back up, then the toggle comes back. The slot follows the console as it
            folds or as its logs expand and collapse, so it eases only the swap. During a run the
            toggle sits under the progress instead, and the empty slot takes no room: its negative
            margin cancels the column gap that its children carry as padding. */}
        {uiMode !== 'setup' && uiMode !== 'loading' && (
          <AutoHeight className="console-slot -mt-8" testId="console-slot" onSettled={consoleSlotSettled} followInnerResizes>
            <AnimatePresence mode="wait" initial={false} custom={consoleFoldTo}>
              {showConsole ? (
                <FoldingConsole key="console-panel" foldTo={consoleFoldTo}>
                  {measureToggleInConsole && (
                    <div ref={measureConsoleToggle} className="pt-8 invisible pointer-events-none absolute inset-x-0 top-0" aria-hidden="true" inert data-testid="console-toggle-probe">
                      <ConsoleToggle open={false} onToggle={() => {}} />
                    </div>
                  )}
                  <div className="pt-8">
                    <ConsolePanel
                      consoleLogs={consoleLogs}
                      lastConsoleMessage={lastConsoleMessage}
                      appState={appState}
                      isConsoleExpanded={isConsoleExpanded}
                      setIsConsoleExpanded={setIsConsoleExpanded}
                      onClose={closeConsole}
                    />
                  </div>
                </FoldingConsole>
              ) : consoleToggleBelow ? (
                <motion.div key="console-toggle" ref={measureConsoleToggle} className="pt-8" {...quickFade}>
                  <ConsoleToggle open={false} onToggle={() => setConsoleOpen(true)} />
                </motion.div>
              ) : null}
            </AnimatePresence>
          </AutoHeight>
        )}
      </div>
      <AppFooterLinks />
    </motion.main>
  );
}

// The console leaving folds back up. It clips only while folding, and when re-opened mid-fold
// until it has grown back open: then what is folded away neither shows over the footer nor keeps
// the page long (a clip-path did, and the page jumped once the console was gone); at rest it clips
// nothing and the panel's shadow shows. It is the positioned box of the hidden toggle copy, which
// so takes the slot's width and adds nothing to the page's height.
function FoldingConsole({ foldTo, children }: { foldTo: number; children: React.ReactNode }) {
  const isPresent = useIsPresent();
  const [folded, setFolded] = useState(false);
  if (!isPresent && !folded) setFolded(true);
  const settled = useCallback((definition: unknown) => {
    if (definition === unfold.animate) setFolded(false);
  }, []);
  return (
    <motion.div
      className="relative"
      custom={foldTo}
      {...unfold}
      onAnimationComplete={settled}
      style={isPresent && !folded ? undefined : { overflow: 'hidden' }}
    >
      {children}
    </motion.div>
  );
}

// Scrolls the page just enough to show the console slot's bottom edge, never past the console's
// top.
function keepConsoleSlotInView() {
  const slot = document.querySelector<HTMLElement>('.console-slot');
  const page = slot?.closest('main');
  if (!slot || !page) return;
  const view = page.getBoundingClientRect();
  const box = slot.getBoundingClientRect();
  const top = slot.querySelector('.console-shell')?.getBoundingClientRect().top ?? box.top;
  const by = Math.min(box.bottom - view.bottom, top - view.top);
  if (by > 0) page.scrollTop += by;
}

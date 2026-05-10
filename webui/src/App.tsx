import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { AlertTriangle, Github, Trash2 } from 'lucide-react';
import { GITHUB_RELEASES_URL, GITHUB_URL, KOFI_URL } from './branding';
import { type ArchiveFolder, type ArchiveSession, type ElSbobinatorBridge, type LowDiskWarning, type PywebviewApi, type UpdateDownloadProgressPayload } from './bridge';
import { getDoneFiles, getPendingFiles, initialProcessingState, isSuccessfulProcessDone, processingReducer, type FileDescriptor, type FileDonePayload, type FileItem, type ProcessDonePayload } from './appState';
import { GEMINI_KEY_PATTERN } from './utils';
import { useConsole } from './hooks/useConsole';
import { useTheme } from './hooks/useTheme';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import { useQueuePersistence } from './hooks/useQueuePersistence';
import { useApiReady } from './hooks/useApiReady';
import { useBridgeCallbacks } from './hooks/useBridgeCallbacks';
import { useBodyScrollLock } from './hooks/useBodyScrollLock';
import { usePreview } from './hooks/usePreview';
import { ProcessingStatusBanner } from './components/ProcessingStatusBanner';
import { RegenerateModal } from './components/modals/RegenerateModal';
import { NewKeyModal } from './components/modals/NewKeyModal';
import { SettingsModal } from './components/modals/SettingsModal';
import { ConfirmActionModal } from './components/modals/ConfirmActionModal';
import { DuplicateFileModal, type AlreadyProcessedMatch, type DuplicatePrompt } from './components/modals/DuplicateFileModal';
import { buildArchiveLookup, filterArchiveSessionsByInputPath, getArchiveMatchesForFile } from './duplicateDetection';
import { NavSidebar, type ActivePage } from './components/NavSidebar';
import { Toaster, type ToastMessage } from './components/Toast';
import { SetupPage } from './components/SetupPage';
import { DropZone } from './components/DropZone';
import { WelcomeDashboard } from './components/WelcomeDashboard';
import { QueueSection } from './components/QueueSection';
import { CompletedSection } from './components/CompletedSection';
import { ArchivePage } from './components/ArchivePage';
import { ConsolePanel } from './components/ConsolePanel';
const EditorFullPage = React.lazy(() => import('./components/EditorFullPage').then(m => ({ default: m.EditorFullPage })));

declare global {
  interface Window {
    pywebview: { api?: PywebviewApi };
    elSbobinatorBridge: ElSbobinatorBridge;
  }
}

type WebViewHostWindow = Window & {
  chrome?: {
    webview?: {
      postMessageWithAdditionalObjects?: (message: string, additionalObjects: FileList) => void;
    };
  };
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  return `${Math.round(bytes / 1_048_576)} MB`;
}

type UiMode = 'setup' | 'ready-empty' | 'ready-with-files' | 'processing' | 'canceling';
type ConfirmActionState =
  | { type: 'stop-processing' }
  | { type: 'remove-file'; fileId: string; fileName: string; isDone: boolean }
  | { type: 'clear-completed'; count: number }
  | { type: 'clear-all' }
  | { type: 'low-disk-warning'; warning: LowDiskWarning }
  | { type: 'delete-archive-session'; sessionDir: string; name: string };

type PendingArchiveReplacement = {
  fileName: string;
  inputPath?: string;
  sessions: ArchiveSession[];
};

export default function App() {
  const [{ files, structuralVersion, appState, currentPhase, currentModel, activeProgress, workTotals, workDone, stepMetrics }, dispatch] = useReducer(processingReducer, initialProcessingState);

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
    fallbackKeys,
    setFallbackKeys,
    preferredModel,
    setPreferredModel,
    fallbackModels,
    setFallbackModels,
    availableModels,
    refreshSettings,
  } = useApiReady(appendConsole);

  const [archiveSessions, setArchiveSessions] = useState<ArchiveSession[]>([]);
  const [archiveTotal, setArchiveTotal] = useState(0);
  const archiveLimitRef = useRef(20);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const toastDedupeMapRef = useRef<Map<string, string>>(new Map());
  const warnedRevisionSessionsRef = useRef<Set<string>>(new Set());
  const prevSessionDirsRef = useRef<Map<string, string>>(new Map());

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);

    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts(prev => {
      const toast = prev.find(t => t.id === id);
      if (toast?.dedupeKey) toastDedupeMapRef.current.delete(toast.dedupeKey);
      return prev.filter(t => t.id !== id);
    });
  }, []);

  const showToast = useCallback((message: string, type: 'warning' | 'info' = 'info', opts?: {
    persistent?: boolean;
    dedupeKey?: string;
    durationMs?: number;
    action?: ToastMessage['action'];
    onDismiss?: () => void;
  }) => {
    if (opts?.dedupeKey) {
      const existingId = toastDedupeMapRef.current.get(opts.dedupeKey);
      if (existingId) return existingId;
    }
    const toastId = crypto.randomUUID();
    if (opts?.dedupeKey) toastDedupeMapRef.current.set(opts.dedupeKey, toastId);
    setToasts(prev => [...prev, { id: toastId, message, type, persistent: opts?.persistent, dedupeKey: opts?.dedupeKey, action: opts?.action, onDismiss: opts?.onDismiss }]);
    if (!opts?.persistent) {
      const timer = setTimeout(() => {
        toastTimersRef.current.delete(toastId);
        if (opts?.dedupeKey) toastDedupeMapRef.current.delete(opts.dedupeKey);
        setToasts(prev => prev.filter(t => t.id !== toastId));
      }, opts?.durationMs ?? 5000);
      toastTimersRef.current.set(toastId, timer);
    }
    return toastId;
  }, []);

  const normalizeSessionDir = useCallback((value?: string) =>
    String(value || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(), []);

  const refreshArchiveSessions = useCallback(async (limitOverride?: number) => {
    const lim = limitOverride !== undefined ? limitOverride : archiveLimitRef.current;
    try {
      const result = await window.pywebview?.api?.get_completed_sessions?.(lim <= 0 ? 0 : lim);
      if (result?.ok && result.sessions) {
        setArchiveSessions(result.sessions);
        setArchiveTotal(result.total ?? result.sessions.length);
        prevSessionDirsRef.current = new Map(result.sessions.map((s: ArchiveSession) => [s.session_dir, s.name]));
      }
    } catch (_) {}
  }, []);

  const handleLoadAll = useCallback(() => {
    archiveLimitRef.current = 0;
    void refreshArchiveSessions(0);
  }, [refreshArchiveSessions]);

  const handleOpenFailed = useCallback((_htmlPath: string, sessionDir: string) => {
    showToast('La sbobina non è più disponibile: il file è stato eliminato dal disco.', 'warning');
    if (sessionDir) {
      setArchiveSessions(prev => prev.filter(s => s.session_dir !== sessionDir));
      setArchiveTotal(prev => Math.max(0, prev - 1));
      prevSessionDirsRef.current.delete(sessionDir);
    }
  }, [showToast]);

  const handleRetryFailedRevisionBlocks = useCallback(async (sessionDir: string, _fileId?: string) => {
    if (!sessionDir) throw new Error('Sessione non disponibile.');
    const res = await window.pywebview?.api?.retry_failed_revision_blocks?.(sessionDir);
    if (!res?.ok) {
      if (res?.conflict) {
        showToast('La sbobina è stata modificata: retry annullato per evitare sovrascritture.', 'warning', { durationMs: 9000 });
      } else if (res?.cancelled) {
        showToast('Retry annullato.', 'info');
      } else if (res?.quota_exhausted) {
        showToast('Quota giornaliera esaurita: riprova domani.', 'warning', { durationMs: 9000 });
      }
      throw new Error(res?.error ?? 'Retry non riuscito.');
    }
    const normalizedSessionDir = res.session_dir ?? sessionDir;
    const remaining = Array.isArray(res.remaining_failed_blocks) ? res.remaining_failed_blocks : [];
    dispatch({
      type: 'queue/update_revision_failed_blocks',
      fileId: _fileId,
      sessionDir: normalizedSessionDir,
      blocks: remaining,
      htmlPath: res.html_path,
      effectiveModel: res.effective_model,
    });
    setArchiveSessions(prev => prev.map(session =>
      normalizeSessionDir(session.session_dir) === normalizeSessionDir(normalizedSessionDir)
        ? {
            ...session,
            html_path: res.html_path ?? session.html_path,
            effective_model: res.effective_model ?? session.effective_model,
            revision_failed_blocks: remaining,
          }
        : session,
    ));
    if (remaining.length > 0) {
      if (res.cancelled) {
        showToast(`Retry annullato: ${remaining.length} ${remaining.length === 1 ? 'blocco resta' : 'blocchi restano'} non revisionato.`, 'warning');
      } else if (res.quota_exhausted) {
        showToast(`Quota giornaliera esaurita: ${remaining.length} ${remaining.length === 1 ? 'blocco resta' : 'blocchi restano'} non revisionato. Riprova domani.`, 'warning', { durationMs: 9000 });
      } else {
        showToast(`${remaining.length} ${remaining.length === 1 ? 'blocco resta' : 'blocchi restano'} non revisionato. Puoi riprovare piu tardi.`, 'warning');
      }
    } else {
      showToast('Blocchi mancanti revisionati e HTML aggiornato.', 'info');
    }
    void refreshArchiveSessions();
  }, [normalizeSessionDir, refreshArchiveSessions, showToast]);

  const handleRevisionWarning = useCallback((data: FileDonePayload) => {
    const count = data.revision_failed_blocks?.length ?? 0;
    if (count <= 0) return;
    const key = normalizeSessionDir(data.output_dir || data.id);
    if (key && warnedRevisionSessionsRef.current.has(key)) return;
    if (key) warnedRevisionSessionsRef.current.add(key);
    showToast(
      `Sbobina pronta, ma ${count} ${count === 1 ? 'sezione e stata inclusa' : 'sezioni sono state incluse'} non revisionate.`,
      'warning',
      {
        dedupeKey: key || undefined,
        durationMs: 12000,
        action: {
          label: 'Riprova',
          loadingLabel: 'Riprovo...',
          errorSuffix: 'puoi usare il pulsante sulla scheda',
          onAction: () => handleRetryFailedRevisionBlocks(data.output_dir, data.id),
        },
      },
    );
  }, [handleRetryFailedRevisionBlocks, normalizeSessionDir, showToast]);

  const { preview, openPreview, closePreview, relinkPreviewAudio, handleAudioStateChange, handleScrollTopChange } = usePreview({ appendConsole, dispatch, setArchiveSessions, onOpenFailed: handleOpenFailed });


  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [regeneratePrompt, setRegeneratePrompt] = useState<{ filename: string; mode?: 'completed' | 'resume'; sessionDir?: string } | null>(null);
  const [askNewKeyPrompt, setAskNewKeyPrompt] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt>(null);
  const [regenDirtyConfirm, setRegenDirtyConfirm] = useState<{ filename: string } | null>(null);

  const [activePage, setActivePage] = useState<ActivePage>('queue');
  const [folders, setFolders] = useState<ArchiveFolder[]>([]);
  const [isPeakHour, setIsPeakHour] = useState(() => { const h = new Date().getHours(); return h >= 15 && h < 20; });
  const [isPeakDismissed, setIsPeakDismissed] = useState(() => {
    const ts = localStorage.getItem('peakBannerDismissedUntil');
    return ts ? Date.now() < Number(ts) : false;
  });

  const [isDragging, setIsDragging] = useState(false);
  const [showConsole, setShowConsole] = useState(() => localStorage.getItem('show_console') === 'true');
  const [autoContinue, setAutoContinue] = useState(() => localStorage.getItem('auto_continue') !== 'false');
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [completionFlash, setCompletionFlash] = useState(false);
  const [isRemovingInsecureKey, setIsRemovingInsecureKey] = useState(false);

  const filesRef = useRef(files);
  const appStateRef = useRef(appState);
  const autoContinueRef = useRef(autoContinue);
  const duplicatePromptRef = useRef<DuplicatePrompt>(duplicatePrompt);
  const startProcessingRef = useRef<(isContinuation?: boolean, overrideLowDisk?: boolean) => Promise<boolean>>(() => Promise.resolve(false));
  const archiveSessionsRef = useRef<ArchiveSession[]>(archiveSessions);
  const pendingArchiveReplacementsRef = useRef<Map<string, PendingArchiveReplacement>>(new Map());
  const archiveReplacementCleanupInFlightRef = useRef<Set<string>>(new Set());
  const downloadCompletionRef = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  filesRef.current = files;
  appStateRef.current = appState;
  autoContinueRef.current = autoContinue;
  duplicatePromptRef.current = duplicatePrompt;
  archiveSessionsRef.current = archiveSessions;

  useEffect(() => {
    try { localStorage.setItem('auto_continue', String(autoContinue)); } catch (_) {}
  }, [autoContinue]);

  useEffect(() => {
    const check = () => { const h = new Date().getHours(); setIsPeakHour(h >= 15 && h < 20); };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isPeakHour) {
      const ts = localStorage.getItem('peakBannerDismissedUntil');
      setIsPeakDismissed(ts ? Date.now() < Number(ts) : false);
    }
  }, [isPeakHour]);

  const peakToastIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPeakHour) {
      if (peakToastIdRef.current) {
        dismissToast(peakToastIdRef.current);
        peakToastIdRef.current = null;
      }
      return;
    }
    if (isPeakDismissed || peakToastIdRef.current) return;
    peakToastIdRef.current = showToast(
      'Fascia oraria di punta (15:00–20:00): i modelli Gemini Flash possono subire rallentamenti o errori 503.',
      'warning',
      {
        persistent: true,
        onDismiss: () => {
          peakToastIdRef.current = null;
          const next = new Date();
          next.setDate(next.getDate() + 1);
          next.setHours(15, 0, 0, 0);
          localStorage.setItem('peakBannerDismissedUntil', String(next.getTime()));
          setIsPeakDismissed(true);
        },
      }
    );
  }, [isPeakHour, isPeakDismissed, showToast, dismissToast]);

  const updateToastShownVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!updateAvailable) return;
    if (updateToastShownVersionRef.current === updateAvailable) return;
    updateToastShownVersionRef.current = updateAvailable;
    showToast(
      `Nuova versione disponibile: ${updateAvailable}`,
      'info',
      {
        persistent: true,
        action: {
          label: 'Aggiorna',
          loadingLabel: 'Download in corso…',
          errorSuffix: 'si è aperta la pagina GitHub per scaricare manualmente.',
          onAction: async () => {
            const result = await window.pywebview?.api?.download_and_install_update?.(updateAvailable);
            if (!result?.ok) {
              window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL);
              throw new Error(result?.error ?? 'Download fallito');
            }
            await new Promise<void>((resolve, reject) => {
              downloadCompletionRef.current = { resolve, reject };
            }).catch((e: Error) => {
              if (e.message === 'dismissed') return;
              if (e.message === 'uac_denied') return;
              window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL);
              throw new Error(
                e.message === 'permission_denied'
                  ? 'Permesso negato per /Applications — scarica il DMG da GitHub e trascinalo in /Applications con Finder.'
                  : e.message,
              );
            });
          },
        },
        onDismiss: () => {
          downloadCompletionRef.current?.reject(new Error('dismissed'));
          downloadCompletionRef.current = null;
          dismissUpdate(updateAvailable);
        },
      }
    );
  }, [updateAvailable, showToast, dismissUpdate]);

  const handleFoldersChange = useCallback(async (next: ArchiveFolder[]) => {
    setFolders(next);
    try {
      await window.pywebview?.api?.save_archive_folders?.(next);
    } catch (_) {}
  }, []);

  const pendingFiles = useMemo(() => getPendingFiles(files), [files]);
  const doneFiles = useMemo(() => getDoneFiles(files), [files]);
  const { queuedCount } = useMemo(() => {
    let queuedCount = 0;
    for (const f of files) { if (f.status === 'queued') queuedCount++; }
    return { queuedCount };
  }, [files]);
  const hasApiKey = Boolean(apiKey.trim());
  const isApiKeyValid = GEMINI_KEY_PATTERN.test(apiKey.trim());
  const canStart = queuedCount > 0 && hasApiKey && isApiKeyValid;
  const uiMode: UiMode =
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

  useEffect(() => {
    if (!apiReady) return;
    void refreshArchiveSessions();
    window.pywebview?.api?.get_archive_folders?.().then(res => {
      if (res?.ok && res.folders) setFolders(res.folders);
    }).catch(() => {});
  }, [apiReady, refreshArchiveSessions]);

  useEffect(() => {
    if (activePage !== 'archive') return;
    prevSessionDirsRef.current = new Map(archiveSessionsRef.current.map(s => [s.session_dir, s.name]));
    const intervalId = setInterval(async () => {
      try {
        const lim = archiveLimitRef.current;
        const result = await window.pywebview?.api?.get_completed_sessions?.(lim <= 0 ? 0 : lim);
        if (!result?.ok || !result.sessions) return;
        const newSessions: ArchiveSession[] = result.sessions;
        const newDirs = new Set<string>(newSessions.map(s => s.session_dir));
        for (const [dir, name] of prevSessionDirsRef.current.entries()) {
          if (!newDirs.has(dir)) {
            showToast(`La sessione "${name}" è stata cancellata e la sbobina non è più disponibile.`, 'warning');
          }
        }
        setArchiveSessions(newSessions);
        setArchiveTotal(result.total ?? newSessions.length);
        prevSessionDirsRef.current = new Map(newSessions.map(s => [s.session_dir, s.name]));
      } catch (_) {}
    }, 30_000);
    return () => {
      clearInterval(intervalId);
      archiveLimitRef.current = 20;
    };
  }, [activePage, showToast]);

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

  const finalizeArchiveReplacement = useCallback(async (fileId: string) => {
    const pendingReplacement = pendingArchiveReplacementsRef.current.get(fileId);
    if (!pendingReplacement || archiveReplacementCleanupInFlightRef.current.has(fileId)) return;
    archiveReplacementCleanupInFlightRef.current.add(fileId);
    const deletedSessionDirs: string[] = [];
    const currentFile = filesRef.current.find(file => file.id === fileId);
    const deletableSessions = filterArchiveSessionsByInputPath(
      pendingReplacement.inputPath || currentFile?.path,
      pendingReplacement.sessions,
    );
    const rawNewDir = currentFile?.outputDir
      || (currentFile?.outputHtml ? String(currentFile.outputHtml).replace(/[^/\\]+$/, '').replace(/[/\\]+$/, '') : undefined);
    const newOutputDirNorm = rawNewDir ? String(rawNewDir).replace(/[/\\]+$/, '').toLowerCase() : null;
    try {
      for (const session of deletableSessions) {
        const sessionDirNorm = String(session.session_dir).replace(/[/\\]+$/, '').toLowerCase();
        if (newOutputDirNorm && sessionDirNorm === newOutputDirNorm) continue;
        try {
          const res = await window.pywebview?.api?.delete_session?.(session.session_dir);
          if (res?.ok) {
            deletedSessionDirs.push(session.session_dir);
          } else {
            appendConsole(`❌ Errore eliminazione sessione archiviata per ${pendingReplacement.fileName}: ${res?.error ?? 'errore sconosciuto'}`);
          }
        } catch (error) {
          appendConsole(`❌ Errore eliminazione sessione archiviata per ${pendingReplacement.fileName}: ${getErrorMessage(error)}`);
        }
      }
      if (deletedSessionDirs.length > 0) {
        const deletedSet = new Set(deletedSessionDirs);
        setArchiveSessions(prev => prev.filter(s => !deletedSet.has(s.session_dir)));
      }
      if (deletedSessionDirs.length !== deletableSessions.length) {
        await refreshArchiveSessions();
      }
    } finally {
      pendingArchiveReplacementsRef.current.delete(fileId);
      archiveReplacementCleanupInFlightRef.current.delete(fileId);
    }
  }, [appendConsole, refreshArchiveSessions]);

  useEffect(() => {
    const currentFileIds = new Set(files.map(f => f.id));
    for (const fileId of pendingArchiveReplacementsRef.current.keys()) {
      if (!currentFileIds.has(fileId)) {
        pendingArchiveReplacementsRef.current.delete(fileId);
        archiveReplacementCleanupInFlightRef.current.delete(fileId);
      }
    }
    for (const file of files) {
      if (file.status === 'done' && pendingArchiveReplacementsRef.current.has(file.id)) {
        void finalizeArchiveReplacement(file.id);
      }
    }
  }, [files, finalizeArchiveReplacement]);

  useEffect(() => {
    document.title = appState === 'processing' ? '⏳ El Sbobinator' : 'El Sbobinator';
  }, [appState]);

  useEffect(() => {
    if (appState !== 'processing' && confirmAction?.type === 'stop-processing') {
      setConfirmAction(null);
    }
  }, [appState, confirmAction]);

  const getFileFingerprint = useCallback((file: Pick<FileItem, 'path' | 'name' | 'size' | 'duration'>) => {
    const normalizedPath = String(file.path || '').trim().toLowerCase();
    if (normalizedPath) return `path:${normalizedPath}`;
    return `meta:${String(file.name || '').trim().toLowerCase()}::${Number(file.size || 0)}::${Math.round(Number(file.duration || 0))}`;
  }, []);

  const enqueueUniqueFiles = useCallback((incomingFiles: FileItem[]) => {
    if (incomingFiles.length === 0) return;
    if (duplicatePromptRef.current !== null) return;
    const currentFiles = filesRef.current;
    const currentArchive = archiveSessionsRef.current;
    const pendingFingerprints = new Set(
      currentFiles.filter(f => f.status !== 'done').map(f => getFileFingerprint(f)),
    );
    const doneFiles = currentFiles.filter(f => f.status === 'done');
    const doneByFingerprint = new Map(doneFiles.map(f => [getFileFingerprint(f), f]));
    const doneByMeta = new Map(
      doneFiles
        .filter(f => Number(f.duration) > 0)
        .map(f => [
          `${String(f.name || '').trim().toLowerCase()}::${Number(f.size || 0)}::${Math.round(Number(f.duration || 0))}`,
          f,
        ]),
    );
    const archiveLookup = buildArchiveLookup(currentArchive);
    const uniqueFiles: FileItem[] = [];
    const inQueueNames: string[] = [];
    const alreadyProcessedMatches: AlreadyProcessedMatch[] = [];
    const seenInBatch = new Set<string>();
    for (const file of incomingFiles) {
      const fp = getFileFingerprint(file);
      if (pendingFingerprints.has(fp) || seenInBatch.has(fp)) {
        inQueueNames.push(file.name);
      } else if (doneByFingerprint.has(fp)) {
        alreadyProcessedMatches.push({ source: 'done', existingFile: doneByFingerprint.get(fp)!, incoming: file });
        seenInBatch.add(fp);
      } else if (Number(file.duration) > 0) {
        const metaKey = `${String(file.name || '').trim().toLowerCase()}::${Number(file.size || 0)}::${Math.round(Number(file.duration || 0))}`;
        if (doneByMeta.has(metaKey)) {
          alreadyProcessedMatches.push({ source: 'done', existingFile: doneByMeta.get(metaKey)!, incoming: file });
          seenInBatch.add(fp);
        } else {
          const archiveMatches = getArchiveMatchesForFile(file, archiveLookup);
          if (archiveMatches.length > 0) {
            alreadyProcessedMatches.push({ source: 'archive', sessions: archiveMatches, incoming: file });
            seenInBatch.add(fp);
          } else {
            seenInBatch.add(fp);
            uniqueFiles.push(file);
          }
        }
      } else {
        const archiveMatches = getArchiveMatchesForFile(file, archiveLookup);
        if (archiveMatches.length > 0) {
          alreadyProcessedMatches.push({ source: 'archive', sessions: archiveMatches, incoming: file });
          seenInBatch.add(fp);
        } else {
          seenInBatch.add(fp);
          uniqueFiles.push(file);
        }
      }
    }
    if (uniqueFiles.length > 0) dispatch({ type: 'queue/add', files: uniqueFiles });
    if (alreadyProcessedMatches.length > 0) {
      setDuplicatePrompt({ kind: 'already-processed', matches: alreadyProcessedMatches, alsoInQueue: inQueueNames.length > 0 ? inQueueNames : undefined });
    } else if (inQueueNames.length > 0) {
      setDuplicatePrompt({ kind: 'in-queue', filenames: inQueueNames });
    }
  }, [dispatch, getFileFingerprint]);

  const handleDuplicateAddAgain = useCallback(async (matches: AlreadyProcessedMatch[]) => {
    setDuplicatePrompt(null);
    const sessionDirsToHide = new Set<string>();
    for (const match of matches) {
      const replacementId = crypto.randomUUID();
      if (match.source === 'done') {
        const archiveMatches = filterArchiveSessionsByInputPath(
          match.existingFile.path ?? match.incoming.path,
          archiveSessionsRef.current,
        );
        if (archiveMatches.length > 0) {
          pendingArchiveReplacementsRef.current.set(replacementId, {
            fileName: match.incoming.name,
            inputPath: match.incoming.path,
            sessions: archiveMatches,
          });
          for (const s of archiveMatches) sessionDirsToHide.add(s.session_dir);
        }
        dispatch({ type: 'queue/remove', id: match.existingFile.id });
        dispatch({ type: 'queue/add', files: [{ ...match.incoming, id: replacementId, resumeSession: false }] });
      } else {
        pendingArchiveReplacementsRef.current.set(replacementId, {
          fileName: match.incoming.name,
          inputPath: match.incoming.path,
          sessions: match.sessions,
        });
        for (const s of match.sessions) sessionDirsToHide.add(s.session_dir);
        dispatch({ type: 'queue/add', files: [{ ...match.incoming, id: replacementId, resumeSession: false }] });
      }
    }
    if (sessionDirsToHide.size > 0) {
      setArchiveSessions(prev => prev.filter(s => !sessionDirsToHide.has(s.session_dir)));
    }
  }, [dispatch]);

  const requestRemoveFile = useCallback((id: string) => {
    const targetFile = filesRef.current.find(file => file.id === id);
    if (!targetFile) return;
    if (appState !== 'idle' && targetFile.status !== 'done') return;
    setConfirmAction({ type: 'remove-file', fileId: id, fileName: targetFile.name, isDone: targetFile.status === 'done' });
  }, [appState]);

  const dndSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || appState !== 'idle') return;
    const fromIndex = files.findIndex(f => f.id === active.id);
    const toIndex = files.findIndex(f => f.id === over.id);
    if (fromIndex < 0 || toIndex < 0) return;
    dispatch({ type: 'queue/reorder', fromIndex, toIndex });
  }, [appState, files]);

  const resolveQueuedFilesForProcessing = useCallback(async () => {
    const api = window.pywebview?.api;
    const queuedFiles = filesRef.current.filter(file => file.status === 'queued');
    if (queuedFiles.length === 0) return [] as FileDescriptor[];
    const file = queuedFiles[0];
    const p = String(file.path || '').trim();
    const exists = p && api?.check_path_exists ? Boolean((await api.check_path_exists(p))?.exists) : Boolean(p);
    let nextPath = p;
    let nextName = file.name;
    let nextSize = file.size;
    let nextDuration = file.duration;
    if (!exists) {
      if (!api?.ask_media_file) { appendConsole(`Impossibile ricollegare l'audio per ${file.name}.`); return []; }
      appendConsole(`Audio non trovato per ${file.name}. Selezionalo di nuovo per continuare.`);
      const selectedFile = await api.ask_media_file();
      if (!selectedFile?.path) { appendConsole(`Avvio annullato: audio non ricollegato per ${file.name}.`); return []; }
      nextPath = selectedFile.path; nextName = selectedFile.name; nextSize = selectedFile.size; nextDuration = selectedFile.duration || 0;
      dispatch({ type: 'queue/update_source', id: file.id, path: nextPath, name: nextName, size: nextSize, duration: nextDuration });
      appendConsole(`Audio ricollegato: ${nextName}`);
    }
    return [{ id: file.id, path: nextPath, name: nextName, size: nextSize, duration: nextDuration, resume_session: file.resumeSession }] as FileDescriptor[];
  }, [appendConsole, dispatch]);

  const startProcessing = async (isContinuation: boolean = false, overrideLowDisk: boolean = false) => {
    const currentQueued = filesRef.current.filter(f => f.status === 'queued');
    if (currentQueued.length === 0 || !apiKey.trim()) return false;
    if (isContinuation && appStateRef.current === 'canceling') return false;
    if (!window.pywebview?.api) return false;
    if (!isContinuation) {
      setBatchTotal(currentQueued.length);
      setBatchCompleted(0);
    }
    try {
      const fileDescriptors = await resolveQueuedFilesForProcessing();
      if (!fileDescriptors || fileDescriptors.length === 0) return false;
      const result = await window.pywebview.api.start_processing?.(fileDescriptors, apiKey.trim(), true, preferredModel, fallbackModels, overrideLowDisk);
      if (!result?.ok) {
        if (result?.low_disk_warning) {
          setConfirmAction({ type: 'low-disk-warning', warning: result.low_disk_warning });
          return false;
        }
        appendConsole(`❌ ${result?.error || "Impossibile avviare l'elaborazione."}`);
        return false;
      }
      dispatch({ type: 'app/set_status', status: 'processing' });
      return true;
    } catch (e: unknown) {
      appendConsole(`❌ Errore avvio: ${getErrorMessage(e)}`);
      return false;
    }
  };

  startProcessingRef.current = startProcessing;

  const confirmStopProcessing = useCallback(async () => {
    setConfirmAction(null);
    dispatch({ type: 'app/set_status', status: 'canceling' });
    appendConsole('[!] Annullamento in corso, attendere prego...');
    if (window.pywebview?.api) await window.pywebview.api.stop_processing?.();
  }, [appendConsole]);

  const handleClearAll = useCallback(() => {
    setConfirmAction({ type: 'clear-all' });
  }, []);

  const confirmClearCompleted = useCallback(() => {
    setConfirmAction(null);
    dispatch({ type: 'queue/clear_completed' });
    void refreshArchiveSessions();
  }, [refreshArchiveSessions]);

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.type === 'stop-processing') { void confirmStopProcessing(); return; }
    if (confirmAction.type === 'remove-file') {
      const removedFile = filesRef.current.find(f => f.id === confirmAction.fileId);
      dispatch({ type: 'queue/remove', id: confirmAction.fileId });
      setConfirmAction(null);
      if (removedFile?.status === 'done') void refreshArchiveSessions();
      return;
    }
    if (confirmAction.type === 'clear-all') {
      setConfirmAction(null);
      dispatch({ type: 'queue/clear_all' });
      return;
    }
    if (confirmAction.type === 'low-disk-warning') {
      setConfirmAction(null);
      void startProcessingRef.current(false, true);
      return;
    }
    if (confirmAction.type === 'delete-archive-session') {
      const { sessionDir } = confirmAction;
      setConfirmAction(null);
      window.pywebview?.api?.delete_session?.(sessionDir).then(res => {
        if (res?.ok) {
          setArchiveSessions(prev => prev.filter(s => s.session_dir !== sessionDir));
        } else {
          appendConsole(`❌ Errore eliminazione sessione: ${res?.error ?? 'errore sconosciuto'}`);
        }
      }).catch((e: unknown) => {
        appendConsole(`❌ Errore eliminazione sessione: ${getErrorMessage(e)}`);
      });
      return;
    }
    confirmClearCompleted();
  }, [confirmAction, confirmClearCompleted, confirmStopProcessing, appendConsole, refreshArchiveSessions]);

  const handleRegenerateAnswer = async (ans: boolean | null) => {
    const currentPrompt = regeneratePrompt;
    setRegeneratePrompt(null);
    try {
      if (ans === true && preview.content !== null) {
        const regenDir = (currentPrompt?.sessionDir ?? '').replace(/\\/g, '/').toLowerCase();
        const previewDir = preview.sessionDir.replace(/\\/g, '/').toLowerCase();
        if (regenDir && previewDir && regenDir === previewDir) {
          const dirtyContent = (window as unknown as Record<string, () => unknown>).__elSbobinatorGetDirtyEditorContent?.();
          if (dirtyContent) {
            const flushFn = (window as unknown as Record<string, () => Promise<boolean>>).__elSbobinatorFlushPendingAutosave;
            if (flushFn) {
              const flushed = await flushFn();
              if (!flushed) {
                try {
                  if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(false);
                } catch (e) { console.error('Failed to send regen cancel after flush error:', e); }
                return;
              }
            }
            setRegenDirtyConfirm({ filename: currentPrompt?.filename ?? '' });
            return;
          }
          const cancelFn = (window as unknown as Record<string, () => void>).__elSbobinatorCancelPendingAutosave;
          cancelFn?.();
          closePreview();
        }
      }
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(ans);
    } catch (e) { console.error('Failed to send answer to Python:', e); }
  };

  const handleRegenDirtyConfirm = useCallback(async () => {
    setRegenDirtyConfirm(null);
    const cancelFn = (window as unknown as Record<string, () => void>).__elSbobinatorCancelPendingAutosave;
    cancelFn?.();
    closePreview();
    try {
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(true);
    } catch (e) { console.error('Failed to send regen answer:', e); }
  }, [closePreview]);

  const handleRegenDirtyCancel = useCallback(async () => {
    setRegenDirtyConfirm(null);
    try {
      if (window.pywebview?.api?.answer_regenerate) await window.pywebview.api.answer_regenerate(false);
    } catch (e) { console.error('Failed to send regen cancel:', e); }
  }, []);

  const openFile = useCallback(async (path: string) => {
    if (!window.pywebview?.api) return;
    const res = await window.pywebview.api.open_file(path);
    if (res && !res.ok) appendConsole(`❌ Impossibile aprire il file: ${res.error ?? path}`);
  }, [appendConsole]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (appState === 'idle') setIsDragging(true);
  }, [appState]);
  const handleDragLeave = useCallback(() => setIsDragging(false), []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (appStateRef.current !== 'idle') return;
    try {
      const w = window as WebViewHostWindow;
      if (w.chrome?.webview?.postMessageWithAdditionalObjects) {
        const names = Array.from(e.dataTransfer.files).map((f: File) => f.name);
        w.chrome.webview.postMessageWithAdditionalObjects('FilesDropped', e.dataTransfer.files);
        window.pywebview?.api?.collect_dropped_files?.(names);
      }
    } catch (_) {}
  }, []);

  const handleBrowseClick = async () => {
    if (appState !== 'idle') return;
    if (!apiReady || !window.pywebview || !window.pywebview.api) {
      appendConsole('⚠ In attesa della connessione con Python... riprova tra un momento.');
      return;
    }
    try {
      const selectedFiles = await window.pywebview.api.ask_files?.();
      if (selectedFiles?.length > 0) {
        const filesToAdd: FileItem[] = selectedFiles.map((f: FileDescriptor) => ({
          id: crypto.randomUUID(), name: f.name, size: f.size, duration: f.duration || 0,
          path: f.path, status: 'queued' as const, progress: 0, phase: 0,
        }));
        enqueueUniqueFiles(filesToAdd);
      }
    } catch (e) { appendConsole(`❌ Errore selezione file: ${e}`); }
  };

  const onFileContinued = useCallback(() => { setBatchCompleted(prev => prev + 1); }, []);
  const onBatchReset = useCallback(() => { setBatchTotal(0); setBatchCompleted(0); }, []);
  const onBatchFullyDone = useCallback((data: ProcessDonePayload) => {
    onBatchReset();
    if (isSuccessfulProcessDone(data)) {
      setCompletionFlash(true);
      setTimeout(() => setCompletionFlash(false), 5000);
      const completedCount = Number(data.completed ?? 0);
      if (completedCount > 1 && !document.hasFocus()) {
        void window.pywebview?.api?.show_notification?.(
          '✅ Batch completato — El Sbobinator',
          `${completedCount} sbobine elaborate con successo.`,
        );
      }
    }
    void refreshArchiveSessions();
  }, [onBatchReset, refreshArchiveSessions]);

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
    onDownloadProgress: useCallback((data: UpdateDownloadProgressPayload) => {
      if (data.status === 'done') {
        downloadCompletionRef.current?.resolve();
        downloadCompletionRef.current = null;
      } else if (data.status === 'error') {
        downloadCompletionRef.current?.reject(new Error(data.error ?? 'Errore sconosciuto'));
        downloadCompletionRef.current = null;
      }
    }, []),
  });
  useBodyScrollLock(isSettingsOpen || regeneratePrompt !== null || preview.content !== null || askNewKeyPrompt || confirmAction !== null || duplicatePrompt !== null || regenDirtyConfirm !== null);

  const confirmModalCopy = useMemo(() => {
    if (!confirmAction) return null;
    if (confirmAction.type === 'stop-processing') {
      return { title: 'Interrompere la sbobinatura?', description: "Stai per fermare l'elaborazione in corso. Il processo verrà interrotto e il file attuale tornerà in coda. Vuoi continuare?", confirmLabel: 'Conferma stop', cancelLabel: 'Continua elaborazione' };
    }
    if (confirmAction.type === 'remove-file') {
      return { title: 'Rimuovere questo elemento?', description: confirmAction.isDone ? `"${confirmAction.fileName}" verrà spostata nell'archivio e rimossa dalla lista. Vuoi continuare?` : `"${confirmAction.fileName}" verrà rimossa dalla lista. Vuoi continuare?`, confirmLabel: 'Conferma rimozione', cancelLabel: 'Tieni elemento' };
    }
    if (confirmAction.type === 'clear-all') {
      return { title: 'Svuotare tutta la coda?', description: "Tutti i file in coda verranno rimossi. L'operazione non può essere annullata.", confirmLabel: 'Svuota coda', cancelLabel: 'Annulla' };
    }
    if (confirmAction.type === 'low-disk-warning') {
      const { warning } = confirmAction;
      const fileLabel = warning.file_name ? ` per "${warning.file_name}"` : '';
      return {
        title: 'Spazio libero insufficiente',
        description: `Lo spazio libero sembra insufficiente${fileLabel}. Stimato richiesto: ${formatBytes(warning.needed_bytes)} · disponibile: ${formatBytes(warning.free_bytes)} in ${warning.location}. Libera spazio prima di continuare, oppure procedi assumendoti il rischio di errore durante l'elaborazione.`,
        confirmLabel: 'Continua comunque',
        cancelLabel: 'Torna alla coda',
      };
    }
    if (confirmAction.type === 'delete-archive-session') {
      return { title: 'Eliminare questa sbobina?', description: `"${confirmAction.name}" e tutti i suoi dati di sessione verranno eliminati definitivamente dal disco. L'operazione è irreversibile.`, confirmLabel: 'Elimina definitivamente', cancelLabel: 'Annulla' };
    }
    return { title: 'Pulire le sbobine completate?', description: confirmAction.count === 1 ? "La sbobina completata verrà spostata nell'archivio e rimossa dalla lista. Vuoi continuare?" : `Le ${confirmAction.count} sbobine completate verranno spostate nell'archivio e rimosse dalla lista. Vuoi continuare?`, confirmLabel: 'Conferma pulizia', cancelLabel: 'Mantieni nella lista' };
  }, [confirmAction]);

  const archiveFiltered = useMemo(() => {
    const activeHtmlPaths = new Set(files.map(f => f.outputHtml).filter(Boolean));
    return archiveSessions.filter(s => !activeHtmlPaths.has(s.html_path));
  }, [archiveSessions, files]);

  return (
    <div className="app-shell min-h-screen font-sans flex flex-row" style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
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
      />

      <div className="flex flex-col flex-1 min-w-0 min-h-screen">
        <AnimatePresence mode="wait">
          {activePage === 'queue' ? (
            <motion.main
              key="queue"
              className="flex-1 max-w-3xl w-full mx-auto flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <div className="my-auto px-5 sm:px-6 py-8 flex flex-col gap-5">
                {apiKeyInsecure && (
                  <motion.div
                    key="api-key-insecure-banner"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                    className="w-full rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    style={{ background: 'var(--warning-subtle)', border: '1px solid var(--warning-ring)' }}
                  >
                    <div className="flex items-start gap-3 text-sm leading-relaxed" style={{ color: 'var(--warning-text)' }}>
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        La tua chiave API è salvata in chiaro su disco perché la protezione Windows (DPAPI) non è disponibile. Motivo: {apiKeyInsecureReasonLabel} Cancella e reinserisci la chiave, oppure conservala in un password manager.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleRemoveInsecureApiKey()}
                      disabled={isRemovingInsecureKey}
                      className="shrink-0 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-opacity"
                      style={{
                        color: 'var(--warning-text)',
                        border: '1px solid var(--warning-ring)',
                        background: 'transparent',
                        cursor: isRemovingInsecureKey ? 'default' : 'pointer',
                        opacity: isRemovingInsecureKey ? 0.6 : 1,
                      }}
                    >
                      <Trash2 className="w-4 h-4" />
                      {isRemovingInsecureKey ? 'Rimozione...' : 'Rimuovi chiave'}
                    </button>
                  </motion.div>
                )}
                {uiMode === 'setup' ? (
                  <SetupPage
                    hasProtectedKey={hasProtectedKey}
                    setIsSettingsOpen={setIsSettingsOpen}
                    onSaved={(key) => setApiKey(key)}
                    preferredModel={preferredModel}
                    fallbackKeys={fallbackKeys}
                    fallbackModels={fallbackModels}
                  />
                ) : (
                  <>
                    {!(pendingFiles.length > 0 || doneFiles.length > 0 || showProcessingBanner) && (
                      <WelcomeDashboard archiveSessions={archiveSessions} />
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
                            stepMetrics={stepMetrics}
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
                        >
                          <DropZone
                            compact={pendingFiles.length > 0 || doneFiles.length > 0}
                            isDragging={isDragging}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={handleBrowseClick}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </>
                )}

                <QueueSection
                  pendingFiles={pendingFiles}
                  appState={appState}
                  autoContinue={autoContinue}
                  setAutoContinue={setAutoContinue}
                  preferredModel={preferredModel}
                  queuedCount={queuedCount}
                  canStart={canStart}
                  hasApiKey={hasApiKey}
                  isApiKeyValid={isApiKeyValid}
                  currentPhase={currentPhase}
                  dndSensors={dndSensors}
                  onDragEnd={handleDragEnd}
                  onRemove={requestRemoveFile}
                  onClearAll={handleClearAll}
                  onRetry={(id) => dispatch({ type: 'queue/retry_one', id })}
                  onPreview={openPreview}
                  onOpenFile={openFile}
                  onStart={() => void startProcessing()}
                  onStop={() => setConfirmAction({ type: 'stop-processing' })}
                  onOpenSettings={() => setIsSettingsOpen(true)}
                />

                <CompletedSection
                  doneFiles={doneFiles}
                  appState={appState}
                  onRemove={(id) => {
                    const f = filesRef.current.find(f => f.id === id);
                    if (!f) return;
                    if (appState !== 'idle' && f.status !== 'done') return;
                    setConfirmAction({ type: 'remove-file', fileId: id, fileName: f.name, isDone: true });
                  }}
                  onPreview={openPreview}
                  onOpenFile={openFile}
                  onClearAll={() => setConfirmAction({ type: 'clear-completed', count: doneFiles.length })}
                  onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
                />

                {showConsole && (
                  <ConsolePanel
                    consoleLogs={consoleLogs}
                    lastConsoleMessage={lastConsoleMessage}
                    appState={appState}
                  />
                )}
              </div>
            </motion.main>
          ) : (
            <motion.main
              key="archive"
              className="flex-1 max-w-4xl w-full mx-auto flex flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
            >
              <div className="my-auto px-5 sm:px-6 py-8 flex flex-col">
                <ArchivePage
                  sessions={archiveFiltered}
                  total={archiveTotal - (archiveSessions.length - archiveFiltered.length)}
                  folders={folders}
                  onFoldersChange={handleFoldersChange}
                  onPreview={openPreview}
                  onOpenFile={openFile}
                  onDeleteSession={(sessionDir, name) => setConfirmAction({ type: 'delete-archive-session', sessionDir, name })}
                  onRefresh={refreshArchiveSessions}
                  onLoadAll={handleLoadAll}
                  onRetryFailedRevisionBlocks={handleRetryFailedRevisionBlocks}
                />
              </div>
            </motion.main>
          )}
        </AnimatePresence>
        <footer className="py-4 text-center flex items-center justify-center gap-2" style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(GITHUB_URL); }} className="footer-link" style={{ color: 'inherit' }}>
            <Github className="w-3.5 h-3.5" /> Progetto Open-Source — GitHub
          </a>
          <span>·</span>
          <a href="#" onClick={e => { e.preventDefault(); window.pywebview?.api?.open_url?.(KOFI_URL); }} className="footer-link" style={{ color: 'inherit' }}>
            ☕ Offrimi un caffè su Ko-fi!
          </a>
        </footer>
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
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        apiKey={apiKey}
        setApiKey={setApiKey}
        hasProtectedKey={hasProtectedKey}
        fallbackKeys={fallbackKeys}
        setFallbackKeys={setFallbackKeys}
        preferredModel={preferredModel}
        setPreferredModel={setPreferredModel}
        fallbackModels={fallbackModels}
        setFallbackModels={setFallbackModels}
        availableModels={availableModels}
        appendConsole={appendConsole}
        latestVersion={latestVersion}
        checkForUpdates={checkForUpdates}
        isCheckingUpdate={isCheckingUpdate}
        hasChecked={hasChecked}
        checkFailed={checkFailed}
        onSettingsSaved={refreshSettings}
      />
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
          onAudioStateChange={handleAudioStateChange}
          onScrollTopChange={handleScrollTopChange}
        />
      </React.Suspense>
      <Toaster toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

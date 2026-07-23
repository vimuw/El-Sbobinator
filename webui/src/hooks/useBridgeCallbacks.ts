import { type Dispatch, useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { createBridge, type ElSbobinatorBridge, type UpdateDownloadProgressPayload } from '../bridge';
import type { AppStatus, FileDescriptor, FileDonePayload, FileItem, ProcessDonePayload, ProcessingAction } from '../appState';
import { shortModelName } from '../utils';

export function useBridgeCallbacks(options: {
  dispatch: Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  filesRef: React.RefObject<FileItem[]>;
  appStateRef: React.RefObject<AppStatus>;
  enqueueUniqueFiles: (files: FileItem[]) => void;
  setRegeneratePrompt: (data: { filename: string; mode?: 'completed' | 'resume'; sessionDir?: string } | null) => void;
  setAskNewKeyPrompt: (open: boolean) => void;
  autoContinueRef: React.RefObject<boolean>;
  startProcessingRef: React.RefObject<(isContinuation?: boolean, overrideLowDisk?: boolean) => Promise<boolean>>;
  onFileContinued: () => void;
  onBatchReset: () => void;
  onBatchFullyDone: (data: ProcessDonePayload) => void;
  clearCompletionFlash: () => void;
  onRevisionWarning?: (data: FileDonePayload) => void;
  onDownloadProgress?: (data: UpdateDownloadProgressPayload) => void;
  batchTotal?: number;
  addNotification?: (
    title: string,
    message: string,
    type: 'info' | 'warning' | 'error' | 'success',
    category: 'processing' | 'update' | 'system',
    opts?: {
      persistent?: boolean;
      dedupeKey?: string;
      actionType?: 'retry_failed_revision_blocks' | 'install_update' | 'open_github';
      actionData?: unknown;
    }
  ) => void;
}) {
  const {
    dispatch,
    appendConsole,
    filesRef,
    appStateRef,
    enqueueUniqueFiles,
    setRegeneratePrompt,
    setAskNewKeyPrompt,
    autoContinueRef,
    startProcessingRef,
    addNotification,
    batchTotal = 0,
  } = options;

  const dispatchRef = useRef(dispatch);
  const appendConsoleRef = useRef(appendConsole);
  const enqueueUniqueFilesRef = useRef(enqueueUniqueFiles);
  const setRegeneratePromptRef = useRef(setRegeneratePrompt);
  const setAskNewKeyPromptRef = useRef(setAskNewKeyPrompt);
  const onFileContinuedRef = useRef(options.onFileContinued);
  const onBatchResetRef = useRef(options.onBatchReset);
  const onBatchFullyDoneRef = useRef(options.onBatchFullyDone);
  const clearCompletionFlashRef = useRef(options.clearCompletionFlash);
  const onRevisionWarningRef = useRef(options.onRevisionWarning);
  const onDownloadProgressRef = useRef(options.onDownloadProgress);
  const addNotificationRef = useRef(addNotification);
  const batchTotalRef = useRef(batchTotal);

  useLayoutEffect(() => {
    dispatchRef.current = dispatch;
    appendConsoleRef.current = appendConsole;
    enqueueUniqueFilesRef.current = enqueueUniqueFiles;
    setRegeneratePromptRef.current = setRegeneratePrompt;
    setAskNewKeyPromptRef.current = setAskNewKeyPrompt;
    onFileContinuedRef.current = options.onFileContinued;
    onBatchResetRef.current = options.onBatchReset;
    onBatchFullyDoneRef.current = options.onBatchFullyDone;
    clearCompletionFlashRef.current = options.clearCompletionFlash;
    onRevisionWarningRef.current = options.onRevisionWarning;
    onDownloadProgressRef.current = options.onDownloadProgress;
    addNotificationRef.current = options.addNotification;
    batchTotalRef.current = options.batchTotal ?? 0;
  });

  useEffect(() => {
    window.elSbobinatorBridge = createBridge({
      dispatch: (...args) => dispatchRef.current(...args),
      appendConsole: msg => appendConsoleRef.current(msg),
      onRegenerate: data => setRegeneratePromptRef.current(data),
      onFilesDropped: (droppedFiles: FileDescriptor[]) => {
        if (appStateRef.current !== 'idle') return;
        const filesToAdd = droppedFiles.map(f => ({
          id: crypto.randomUUID(),
          name: f.name,
          size: f.size,
          duration: f.duration || 0,
          path: f.path,
          status: 'queued' as const,
          progress: 0,
          phase: 0,
        }));
        enqueueUniqueFilesRef.current(filesToAdd);
      },
      onBatchStart: () => { clearCompletionFlashRef.current(); },
      onDownloadProgress: data => { onDownloadProgressRef.current?.(data); },
      onAskNewKey: () => {
        setAskNewKeyPromptRef.current(true);
        if (addNotificationRef.current) {
          addNotificationRef.current(
            'Chiavi esaurite',
            'Limite API raggiunto. Le tue chiavi Gemini hanno esaurito i crediti gratuiti o la capacità temporanea. Aggiungi una chiave nelle impostazioni per continuare.',
            'warning',
            'system'
          );
        }
        if (localStorage.getItem('notifications_enabled') !== 'false' && !document.hasFocus() && window.pywebview?.api?.show_notification) {
          void window.pywebview.api.show_notification(
            '⚠️ Chiavi esaurite — El Sbobinator',
            'Limite API raggiunto. Le tue chiavi Gemini hanno esaurito i crediti gratuiti o la capacità temporanea. Aggiungi una chiave nelle impostazioni per continuare.',
          );
        }
      },
      onDismissNewKey: () => {
        setAskNewKeyPromptRef.current(false);
      },
      onBatchDone: data => {
        setRegeneratePromptRef.current(null);
        if (!data.cancelled && !data.quota_exhausted && autoContinueRef.current) {
          const hasQueued = filesRef.current?.some(f => f.status === 'queued');
          if (hasQueued) {
            setTimeout(() => {
              void startProcessingRef.current(true).then(started => {
                if (started) {
                  onFileContinuedRef.current();
                  return;
                }
                onBatchResetRef.current();
              });
            }, 50);
            return;
          }
        }
        onBatchFullyDoneRef.current(data);
      },
      onFileDone: data => {
        onRevisionWarningRef.current?.(data);
        const currentFile = filesRef.current?.find(file => file.id === data.id);
        const isWarning = data.completion_status === 'completed_with_warnings' || (Array.isArray(data.revision_failed_blocks) && data.revision_failed_blocks.length > 0);

        if (addNotificationRef.current && currentFile) {
          if (!isWarning) {
            const model = data.effective_model || currentFile.effectiveModel;
            const modelPart = model ? ` con ${shortModelName(model)}` : '';
            const elapsed = currentFile.startedAt ? Math.round((Date.now() - currentFile.startedAt) / 60000) : null;
            const elapsedPart = elapsed !== null && elapsed > 0 ? ` · ${elapsed} min` : '';
            addNotificationRef.current(
              'Sbobina pronta',
              `"${currentFile.name}" completata con successo${modelPart}${elapsedPart}.`,
              'success',
              'processing'
            );
          }
          // Note: revision warnings are already added via onRevisionWarning -> handleRevisionWarning inside App.tsx
        }

        if (localStorage.getItem('notifications_enabled') === 'false') return;
        if (batchTotalRef.current > 1) return; // Suppress individual success/warning OS notifications in batch mode
        if (currentFile && window.pywebview?.api?.show_notification && !document.hasFocus()) {
          if (isWarning) {
            void window.pywebview.api.show_notification(
              `⚠️ Sbobina pronta con avvisi — ${currentFile.name}`,
              'Completata con alcune parti non revisionate. Apri l\'app per rivederle.',
            );
          } else {
            const model = data.effective_model || currentFile.effectiveModel;
            const modelPart = model ? ` con ${shortModelName(model)}` : '';
            const elapsed = currentFile.startedAt ? Math.round((Date.now() - currentFile.startedAt) / 60000) : null;
            const elapsedPart = elapsed !== null && elapsed > 0 ? ` · ${elapsed} min` : '';
            void window.pywebview.api.show_notification(
              `✅ Sbobina pronta — ${currentFile.name}`,
              `Elaborata con successo${modelPart}${elapsedPart}. Disponibile nell'applicazione.`,
            );
          }
        }
      },
      onFileFailed: data => {
        const currentFile = filesRef.current?.find(file => file.id === data.id);
        const isGoogleServerOverload = data.error?.includes('indisponibile') || data.error?.includes('unavailable');

        if (addNotificationRef.current && currentFile) {
          if (isGoogleServerOverload) {
            addNotificationRef.current(
              'Server occupati',
              `I server di Google sono sovraccarichi. L'elaborazione per "${currentFile.name}" è stata interrotta.`,
              'warning',
              'processing'
            );
          } else {
            addNotificationRef.current(
              'Errore elaborazione',
              `Errore per "${currentFile.name}": ${data.error || 'Si è verificato un errore imprevisto.'}`,
              'error',
              'processing'
            );
          }
        }

        if (localStorage.getItem('notifications_enabled') === 'false') return;
        if (currentFile && window.pywebview?.api?.show_notification && !document.hasFocus()) {
          if (isGoogleServerOverload) {
            void window.pywebview.api.show_notification(
              `⚠️ Server occupati — ${currentFile.name}`,
              "I server di Google Gemini sono temporaneamente sovraccarichi. L'app proverà a riprendere o puoi cliccare su 'Riprova' tra qualche minuto.",
            );
          } else {
            void window.pywebview.api.show_notification(
              `❌ Errore elaborazione — ${currentFile.name}`,
              data.error || 'Si è verificato un errore imprevisto.',
            );
          }
        }
      },
    });
    return () => {
      window.elSbobinatorBridge = null as ElSbobinatorBridge;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

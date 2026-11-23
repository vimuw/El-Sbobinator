import { type Dispatch, useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { createBridge, type ElSbobinatorBridge } from '../bridge';
import type { AppStatus, FileDescriptor, FileDonePayload, FileItem, ProcessDonePayload, ProcessingAction } from '../appState';
import { errorLabel, isPausedError, shortModelName } from '../utils';

// The dialog itself takes the new key, for this run only.
function newKeyNotice(): string {
  return 'Limite API raggiunto: le tue chiavi Gemini hanno esaurito la quota gratuita. Incolla un’altra chiave nella finestra che si è aperta per continuare: vale solo per questa elaborazione.';
}

// Web: the audio copy goes when the sbobina is done, and the page's File goes at the next reload.
// The player's switch can still keep it while this page holds the file.
export const WEB_AUDIO_NOT_KEPT_NOTE = 'L’audio non viene conservato: se vuoi riascoltarlo, apri la sbobina e attiva «Tieni l’audio nel browser» nel player prima di chiudere la pagina.';

export function useBridgeCallbacks(options: {
  dispatch: Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  filesRef: React.RefObject<FileItem[]>;
  appStateRef: React.RefObject<AppStatus>;
  enqueueUniqueFiles: (files: FileItem[]) => void;
  setRegeneratePrompt: (data: { filename: string; mode?: 'completed' | 'resume'; sessionDir?: string } | null) => void;
  setAskNewKeyPrompt: (open: boolean) => void;
  autoContinueRef: React.RefObject<boolean>;
  startProcessingRef: React.RefObject<(isContinuation?: boolean) => Promise<boolean>>;
  onFileContinued: () => void;
  onBatchReset: () => void;
  onBatchFullyDone: (data: ProcessDonePayload) => void;
  clearCompletionFlash: () => void;
  onRevisionWarning?: (data: FileDonePayload) => void;
  addNotification?: (
    title: string,
    message: string,
    type: 'info' | 'warning' | 'error' | 'success',
    category: 'processing' | 'update' | 'system',
    opts?: {
      persistent?: boolean;
      dedupeKey?: string;
      actionType?: 'retry_failed_revision_blocks';
      actionData?: unknown;
    }
  ) => void;
  // Web previews with Drive sync.
  onArchiveChangedRemotely?: () => void;
  onDocumentChangedElsewhere?: (data: { session_dir: string }) => void;
  onDriveNeedsReconnect?: () => void;
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
  const addNotificationRef = useRef(addNotification);
  const onArchiveChangedRemotelyRef = useRef(options.onArchiveChangedRemotely);
  const onDocumentChangedElsewhereRef = useRef(options.onDocumentChangedElsewhere);
  const onDriveNeedsReconnectRef = useRef(options.onDriveNeedsReconnect);

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
    addNotificationRef.current = options.addNotification;
    onArchiveChangedRemotelyRef.current = options.onArchiveChangedRemotely;
    onDocumentChangedElsewhereRef.current = options.onDocumentChangedElsewhere;
    onDriveNeedsReconnectRef.current = options.onDriveNeedsReconnect;
  });

  useEffect(() => {
    window.elSbobinatorBridge = createBridge({
      dispatch: (...args) => dispatchRef.current(...args),
      appendConsole: msg => appendConsoleRef.current(msg),
      onArchiveChangedRemotely: () => { onArchiveChangedRemotelyRef.current?.(); },
      onDocumentChangedElsewhere: data => { onDocumentChangedElsewhereRef.current?.(data); },
      onDriveNeedsReconnect: () => { onDriveNeedsReconnectRef.current?.(); },
      onRegenerate: data => { setRegeneratePromptRef.current(data); },
      onFilesDropped: (droppedFiles: FileDescriptor[]) => {
        if (appStateRef.current === 'canceling') return;
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
      onAskNewKey: () => {
        setAskNewKeyPromptRef.current(true);
        if (addNotificationRef.current) {
          addNotificationRef.current(
            'Chiavi esaurite',
            newKeyNotice(),
            'warning',
            'system'
          );
        }
      },
      onDismissNewKey: () => {
        setAskNewKeyPromptRef.current(false);
      },
      onBatchDone: data => {
        setRegeneratePromptRef.current(null);
        if (!data.cancelled && !data.quota_exhausted && !data.paused && autoContinueRef.current) {
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
            // Only a sbobina made by this run surely has no audio kept: an existing one may keep it.
            const audioNote = data.reused_existing ? '' : ` ${WEB_AUDIO_NOT_KEPT_NOTE}`;
            addNotificationRef.current(
              'Sbobina pronta',
              `"${currentFile.name}" completata con successo${modelPart}${elapsedPart}.${audioNote}`,
              'success',
              'processing'
            );
          }
          // Note: revision warnings are already added via onRevisionWarning -> handleRevisionWarning inside App.tsx
        }
      },
      onFileFailed: data => {
        const currentFile = filesRef.current?.find(file => file.id === data.id);
        const isPaused = data.retry_reason === 'circuit_breaker_paused' || Boolean(data.retryable) || isPausedError(data.error, data.error_detail);
        const isGoogleServerOverload = !isPaused && (data.error?.includes('indisponibile') || data.error?.includes('unavailable'));
        const friendlyError = data.retry_reason === 'circuit_breaker_paused'
          ? "Capacità Google Gemini temporaneamente esaurita. L'elaborazione è stata messa in pausa per proteggere il batch. Puoi cliccare 'Riprendi' per forzare un nuovo tentativo."
          : errorLabel(data.error, data.error_detail);

        if (addNotificationRef.current && currentFile) {
          if (isGoogleServerOverload) {
            addNotificationRef.current(
              'Server occupati',
              `I server di Google sono sovraccarichi. L'elaborazione per "${currentFile.name}" è stata interrotta.`,
              'warning',
              'processing'
            );
          } else if (isPaused) {
            addNotificationRef.current(
              'Elaborazione in pausa',
              `Per "${currentFile.name}": ${friendlyError}`,
              'warning',
              'processing'
            );
          } else {
            addNotificationRef.current(
              'Errore elaborazione',
              `Errore per "${currentFile.name}": ${friendlyError}`,
              'error',
              'processing'
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

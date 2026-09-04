import React, { useCallback, useState } from 'react';
import { type FileDescriptor, type FileItem, type ProcessDonePayload, type ProcessingAction, type ProcessingState, isSuccessfulProcessDone } from '../appState';
import { type ConfirmActionState } from './useConfirmModal';
import { STORAGE_KEYS } from '../storageKeys';

const SUPPORTED_MEDIA_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.ogg', '.flac', '.aac', '.mp4', '.mkv', '.webm']);
const UNSUPPORTED_MEDIA_ERROR = 'Formato non supportato. Seleziona un file audio/video: MP3, M4A, WAV, OGG, FLAC, AAC, MP4, MKV o WEBM.';

export function isSupportedMediaPath(path: string): boolean {
  const match = String(path || '').trim().toLowerCase().match(/\.[^.\\/]+$/);
  return Boolean(match && SUPPORTED_MEDIA_EXTENSIONS.has(match[0]));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface UseQueueProcessingOptions {
  filesRef: React.MutableRefObject<FileItem[]>;
  appStateRef: React.MutableRefObject<ProcessingState['appState']>;
  apiKey: string;
  preferredModel: string;
  fallbackModels: string[];
  dispatch: React.Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  setConfirmAction: (action: ConfirmActionState | null) => void;
  refreshArchiveSessions: () => Promise<void>;
}

export function useQueueProcessing({
  filesRef,
  appStateRef,
  apiKey,
  preferredModel,
  fallbackModels,
  dispatch,
  appendConsole,
  setConfirmAction,
  refreshArchiveSessions,
}: UseQueueProcessingOptions) {
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [completionFlash, setCompletionFlash] = useState(false);

  const resolveQueuedFilesForProcessing = useCallback(async () => {
    const api = window.pywebview?.api;
    const queuedFiles = filesRef.current.filter(file => file.status === 'queued');
    if (queuedFiles.length === 0) return [] as FileDescriptor[];
    const file = queuedFiles[0];
    const p = String(file.path || '').trim();
    if (p && !isSupportedMediaPath(p)) {
      appendConsole(`❌ ${UNSUPPORTED_MEDIA_ERROR}`);
      return [];
    }
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
      if (!isSupportedMediaPath(selectedFile.path)) { appendConsole(`❌ ${UNSUPPORTED_MEDIA_ERROR}`); return []; }
      nextPath = selectedFile.path; nextName = selectedFile.name; nextSize = selectedFile.size; nextDuration = selectedFile.duration || 0;
      dispatch({ type: 'queue/update_source', id: file.id, path: nextPath, name: nextName, size: nextSize, duration: nextDuration });
      appendConsole(`Audio ricollegato: ${nextName}`);
    }
    return [{
      id: file.id,
      path: nextPath,
      name: nextName,
      size: nextSize,
      duration: nextDuration,
      ...(file.resumeSession !== undefined ? { resume_session: file.resumeSession } : {}),
      allow_completed_destroy: file.allowCompletedDestroy,
    }] as FileDescriptor[];
  }, [appendConsole, dispatch, filesRef]);

  const startProcessing = useCallback(async (isContinuation: boolean = false, overrideLowDisk: boolean = false) => {
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
          if (!document.hasFocus()) {
            void window.pywebview?.api?.flash_window?.();
          }
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
  }, [apiKey, appendConsole, appStateRef, dispatch, fallbackModels, filesRef, preferredModel, resolveQueuedFilesForProcessing, setConfirmAction]);

  const onFileContinued = useCallback(() => { setBatchCompleted(prev => prev + 1); }, []);
  const onBatchReset = useCallback(() => { setBatchTotal(0); setBatchCompleted(0); }, []);
  const onBatchFullyDone = useCallback((data: ProcessDonePayload) => {
    onBatchReset();

    if (isSuccessfulProcessDone(data)) {
      setCompletionFlash(true);
      setTimeout(() => setCompletionFlash(false), 5000);
    }

    if (!document.hasFocus()) {
      const total = Number(data.total ?? 0);
      const completed = Number(data.completed ?? 0);
      const completed_with_warnings = Number(data.completed_with_warnings ?? 0);
      const failed = Number(data.failed ?? 0);

      if (total > 1 && !data.cancelled) {
        void window.pywebview?.api?.flash_window?.();
        if (localStorage.getItem(STORAGE_KEYS.NOTIFICATIONS_ENABLED) !== 'false') {
          if (failed > 0) {
            void window.pywebview?.api?.show_notification?.(
              '⚠️ Batch completato con errori — El Sbobinator',
              `Elaborazione terminata. Riuscite: ${completed + completed_with_warnings}/${total}. Fallite: ${failed}. Apri l'app per i dettagli.`,
            );
          } else if (completed_with_warnings > 0) {
            void window.pywebview?.api?.show_notification?.(
              '⚠️ Batch completato con avvisi — El Sbobinator',
              `Elaborazione terminata con avvisi. Sbobine con avvisi: ${completed_with_warnings}/${total}.`,
            );
          } else {
            void window.pywebview?.api?.show_notification?.(
              '✅ Batch completato — El Sbobinator',
              `${completed} sbobine elaborate con successo.`,
            );
          }
        }
      }
    }

    void refreshArchiveSessions();
  }, [onBatchReset, refreshArchiveSessions]);

  return {
    batchTotal,
    setBatchTotal,
    batchCompleted,
    setBatchCompleted,
    completionFlash,
    setCompletionFlash,
    startProcessing,
    onFileContinued,
    onBatchReset,
    onBatchFullyDone,
    resolveQueuedFilesForProcessing,
  };
}

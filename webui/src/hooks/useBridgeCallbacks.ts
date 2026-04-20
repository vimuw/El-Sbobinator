import { type Dispatch, useEffect, useLayoutEffect, useRef } from 'react';
import type React from 'react';
import { createBridge, type ElSbobinatorBridge } from '../bridge';
import type { AppStatus, FileDescriptor, FileItem, ProcessDonePayload, ProcessingAction } from '../appState';
import { shortModelName } from '../utils';

export function useBridgeCallbacks(options: {
  dispatch: Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  filesRef: React.RefObject<FileItem[]>;
  appStateRef: React.RefObject<AppStatus>;
  enqueueUniqueFiles: (files: FileItem[]) => void;
  setRegeneratePrompt: (data: { filename: string; mode?: 'completed' | 'resume' } | null) => void;
  setAskNewKeyPrompt: (open: boolean) => void;
  autoContinueRef: React.RefObject<boolean>;
  startProcessingRef: React.RefObject<(isContinuation?: boolean) => Promise<boolean>>;
  onFileContinued: () => void;
  onBatchReset: () => void;
  onBatchFullyDone: (data: ProcessDonePayload) => void;
  clearCompletionFlash: () => void;
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
      onAskNewKey: () => {
        setAskNewKeyPromptRef.current(true);
      },
      onBatchDone: data => {
        if (!data.cancelled && autoContinueRef.current) {
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
        if (localStorage.getItem('notifications_enabled') === 'false') return;
        const currentFile = filesRef.current?.find(file => file.id === data.id);
        if (currentFile && window.pywebview?.api?.show_notification && !document.hasFocus()) {
          const model = data.effective_model || currentFile.effectiveModel;
          const modelPart = model ? ` con ${shortModelName(model)}` : '';
          const elapsed = currentFile.startedAt ? Math.round((Date.now() - currentFile.startedAt) / 60000) : null;
          const elapsedPart = elapsed !== null && elapsed > 0 ? ` · ${elapsed} min` : '';
          window.pywebview.api.show_notification(
            `✅ Sbobina pronta — ${currentFile.name}`,
            `Completata${modelPart}${elapsedPart}. Clicca per aprire.`,
          );
        }
      },
    });
    return () => {
      window.elSbobinatorBridge = null as ElSbobinatorBridge;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}

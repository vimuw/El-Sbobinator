import { type Dispatch, useEffect } from 'react';
import type React from 'react';
import { createBridge } from '../bridge';
import type { AppStatus, FileDescriptor, FileItem, ProcessingAction } from '../appState';

export function useBridgeCallbacks(options: {
  dispatch: Dispatch<ProcessingAction>;
  appendConsole: (msg: string) => void;
  filesRef: React.RefObject<FileItem[]>;
  appStateRef: React.RefObject<AppStatus>;
  enqueueUniqueFiles: (files: FileItem[]) => void;
  setRegeneratePrompt: (data: { filename: string; mode?: 'completed' | 'resume' } | null) => void;
  setAskNewKeyPrompt: (open: boolean) => void;
}) {
  const {
    dispatch,
    appendConsole,
    filesRef,
    appStateRef,
    enqueueUniqueFiles,
    setRegeneratePrompt,
    setAskNewKeyPrompt,
  } = options;

  useEffect(() => {
    window.elSbobinatorBridge = createBridge({
      dispatch,
      appendConsole,
      onRegenerate: data => setRegeneratePrompt(data),
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
        enqueueUniqueFiles(filesToAdd);
      },
      onAskNewKey: () => {
        setAskNewKeyPrompt(true);
      },
      onBatchDone: data => {
        if (!data?.cancelled && data?.total && data.completed === data.total && window.pywebview?.api?.show_notification && !document.hasFocus()) {
          window.pywebview.api.show_notification('Elaborazione completata', 'Tutti i file in coda sono stati sbobinati con successo.');
        }
      },
      onFileDone: data => {
        const currentFile = filesRef.current?.find(file => file.id === data.id);
        if (currentFile && window.pywebview?.api?.show_notification && !document.hasFocus()) {
          window.pywebview.api.show_notification('File Completato!', `✅ ${currentFile.name} pronto.`);
        }
      },
    });
  }, [appendConsole]); // eslint-disable-line react-hooks/exhaustive-deps
}

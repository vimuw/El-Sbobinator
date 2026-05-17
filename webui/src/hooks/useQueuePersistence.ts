import { type Dispatch, useEffect, useRef } from 'react';
import type { FileItem, ProcessingAction } from '../appState';

const QUEUE_STORAGE_KEY = 'el-sbobinator.queue.v1';

export function serializeQueueFile(file: FileItem): Record<string, unknown> {
  return {
    id: file.id,
    name: file.name,
    size: file.size,
    duration: file.duration,
    path: file.path,
    status: file.status,
    outputHtml: file.outputHtml,
    outputDir: file.outputDir,
    errorText: file.errorText,
    errorDetail: file.errorDetail,
    completedAt: file.completedAt,
    primaryModel: file.primaryModel,
    effectiveModel: file.effectiveModel,
    completionStatus: file.completionStatus,
    revisionFailedBlocks: file.revisionFailedBlocks,
  };
}

export function deserializeQueueFile(file: Partial<FileItem>, index: number): FileItem {
  return {
    id: String(file.id || `restored-${index}`),
    name: String(file.name || `file-${index}`),
    size: Number(file.size || 0),
    duration: Number(file.duration || 0),
    path: file.path ? String(file.path) : undefined,
    status: file.status === 'done' ? 'done' : file.status === 'error' ? 'error' : 'queued',
    progress: file.status === 'done' ? 100 : 0,
    phase: file.status === 'done' ? 3 : 0,
    outputHtml: file.outputHtml ? String(file.outputHtml) : undefined,
    outputDir: file.outputDir ? String(file.outputDir) : undefined,
    errorText: file.errorText ? String(file.errorText) : undefined,
    errorDetail: file.errorDetail ? String(file.errorDetail) : undefined,
    completedAt: file.completedAt ? Number(file.completedAt) : undefined,
    primaryModel: file.primaryModel ? String(file.primaryModel) : undefined,
    effectiveModel: file.effectiveModel ? String(file.effectiveModel) : undefined,
    completionStatus: file.completionStatus === 'completed_with_warnings' ? 'completed_with_warnings' : 'completed',
    revisionFailedBlocks: Array.isArray(file.revisionFailedBlocks)
      ? file.revisionFailedBlocks.map(Number).filter(n => Number.isFinite(n) && n > 0)
      : [],
  };
}

export function useQueuePersistence(
  files: FileItem[],
  structuralVersion: number,
  dispatch: Dispatch<ProcessingAction>,
  appendConsole: (msg: string) => void,
) {
  const hasRestoredQueueRef = useRef(false);
  const filesRef = useRef(files);
  filesRef.current = files;

  useEffect(() => {
    if (hasRestoredQueueRef.current) return;
    hasRestoredQueueRef.current = true;
    try {
      const raw = window.localStorage.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;

      const restoredFiles: FileItem[] = parsed.map(deserializeQueueFile);

      dispatch({ type: 'queue/add', files: restoredFiles });
      appendConsole(`Coda ripristinata: ${restoredFiles.length} file.`);
    } catch (error) {
      appendConsole(`[ERRORE] Ripristino coda fallito: ${error}`);
    }
  }, [appendConsole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (structuralVersion === 0) return; // skip initial mount – restore hasn’t run yet
    try {
      const currentFiles = filesRef.current;
      if (currentFiles.length === 0) {
        window.localStorage.removeItem(QUEUE_STORAGE_KEY);
        return;
      }
      const persisted = currentFiles.map(serializeQueueFile);
      window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(persisted));
    } catch (error) {
      appendConsole(`[ERRORE] Persistenza coda fallita: ${error}`);
    }
  }, [structuralVersion]);
}

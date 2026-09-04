import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ArchiveSession } from '../bridge';
import type { FileDescriptor, FileItem, ProcessingAction } from '../appState';
import {
  buildArchiveLookup,
  filterArchiveSessionsByInputPath,
  getArchiveMatchesForFile,
} from '../duplicateDetection';
import type { AlreadyProcessedMatch, DuplicatePrompt } from '../components/modals/DuplicateFileModal';
import type { PendingArchiveReplacement } from './useArchiveSync';

type WebViewHostWindow = Window & {
  chrome?: {
    webview?: {
      postMessageWithAdditionalObjects?: (message: string, additionalObjects: FileList) => void;
    };
  };
};

interface UseQueueIngestOptions {
  filesRef: React.MutableRefObject<FileItem[]>;
  archiveSessionsRef: React.MutableRefObject<ArchiveSession[]>;
  pendingArchiveReplacementsRef: React.MutableRefObject<Map<string, PendingArchiveReplacement>>;
  setArchiveSessions: React.Dispatch<React.SetStateAction<ArchiveSession[]>>;
  setArchiveTotal: React.Dispatch<React.SetStateAction<number>>;
  dispatch: React.Dispatch<ProcessingAction>;
  appState: string;
  appStateRef: React.MutableRefObject<string>;
  apiReady: boolean;
  appendConsole: (msg: string) => void;
}

export function useQueueIngest({
  filesRef,
  archiveSessionsRef,
  pendingArchiveReplacementsRef,
  setArchiveSessions,
  setArchiveTotal,
  dispatch,
  appState,
  appStateRef,
  apiReady,
  appendConsole,
}: UseQueueIngestOptions) {
  const [duplicatePrompt, setDuplicatePrompt] = useState<DuplicatePrompt>(null);
  const [isDragging, setIsDragging] = useState(false);
  const duplicatePromptRef = useRef<DuplicatePrompt>(duplicatePrompt);
  useLayoutEffect(() => {
    duplicatePromptRef.current = duplicatePrompt;
  }, [duplicatePrompt]);

  const getFileFingerprint = useCallback((file: Pick<FileItem, 'path' | 'name' | 'size' | 'duration'>) => {
    const normalizedPath = String(file.path || '').trim().toLowerCase();
    if (normalizedPath) return `path:${normalizedPath}`;
    return `meta:${String(file.name || '').trim().toLowerCase()}::${Number(file.size || 0)}::${Math.round(Number(file.duration || 0))}`;
  }, []);

  const enqueueUniqueFiles = useCallback(
    (incomingFiles: FileItem[]) => {
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
    },
    [dispatch, filesRef, archiveSessionsRef, getFileFingerprint],
  );

  const handleDuplicateAddAgain = useCallback(
    async (matches: AlreadyProcessedMatch[]) => {
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
          dispatch({ type: 'queue/add', files: [{ ...match.incoming, id: replacementId, resumeSession: false, allowCompletedDestroy: true }] });
        } else {
          pendingArchiveReplacementsRef.current.set(replacementId, {
            fileName: match.incoming.name,
            inputPath: match.incoming.path,
            sessions: match.sessions,
          });
          for (const s of match.sessions) sessionDirsToHide.add(s.session_dir);
          dispatch({ type: 'queue/add', files: [{ ...match.incoming, id: replacementId, resumeSession: false, allowCompletedDestroy: true }] });
        }
      }
      if (sessionDirsToHide.size > 0) {
        setArchiveSessions(prev => prev.filter(s => !sessionDirsToHide.has(s.session_dir)));
        setArchiveTotal(prev => Math.max(0, prev - sessionDirsToHide.size));
      }
    },
    [archiveSessionsRef, dispatch, pendingArchiveReplacementsRef, setArchiveSessions, setArchiveTotal],
  );

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
      }
    } catch (e) {
      appendConsole(`❌ Errore selezione file: ${e}`);
    }
  };

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (appState === 'idle') setIsDragging(true);
    },
    [appState],
  );

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
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
    },
    [appStateRef],
  );

  return {
    duplicatePrompt,
    duplicatePromptRef,
    setDuplicatePrompt,
    isDragging,
    getFileFingerprint,
    enqueueUniqueFiles,
    handleDuplicateAddAgain,
    handleBrowseClick,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
}

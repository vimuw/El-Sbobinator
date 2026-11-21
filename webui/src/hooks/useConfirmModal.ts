import { useCallback, useMemo, useState } from 'react';
import type { ArchiveFolder, ArchiveSession } from '../bridge';
import type { FileItem, ProcessingAction } from '../appState';
import { getHostCapabilities } from '../hostCapabilities';
import { releaseQueueFiles } from '../queueFileRelease';

export type ConfirmActionState =
  | { type: 'stop-processing' }
  | { type: 'remove-file'; fileId: string; fileName: string; isDone: boolean }
  | { type: 'clear-all' }
  | { type: 'delete-archive-session'; sessionDir: string; name: string }
  | { type: 'delete-multiple-archive-sessions'; sessions: { sessionDir: string; name: string }[] }
  | { type: 'retry-archive-session'; session: ArchiveSession };

export type ConfirmAction = ConfirmActionState;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface UseConfirmModalOptions {
  dispatch: React.Dispatch<ProcessingAction>;
  filesRef: React.MutableRefObject<FileItem[]>;
  foldersRef: React.MutableRefObject<ArchiveFolder[]>;
  onFoldersChange: (next: ArchiveFolder[]) => Promise<void>;
  setArchiveSessions: React.Dispatch<React.SetStateAction<ArchiveSession[]>>;
  setArchiveTotal: React.Dispatch<React.SetStateAction<number>>;
  refreshArchiveSessions: () => Promise<void>;
  executeRetryFromArchive: (session: ArchiveSession) => Promise<void>;
  normalizeSessionDir: (value?: string) => string;
  appendConsole: (msg: string) => void;
  onFileRemovedFromBatch?: () => void;
}

export function useConfirmModal({
  dispatch,
  filesRef,
  foldersRef,
  onFoldersChange,
  setArchiveSessions,
  setArchiveTotal,
  refreshArchiveSessions,
  executeRetryFromArchive,
  normalizeSessionDir,
  appendConsole,
  onFileRemovedFromBatch,
}: UseConfirmModalOptions) {
  const [confirmAction, setConfirmAction] = useState<ConfirmActionState | null>(null);

  const confirmStopProcessing = useCallback(async () => {
    setConfirmAction(null);
    dispatch({ type: 'app/set_status', status: 'canceling' });
    appendConsole('Annullamento in corso...');
    if (window.pywebview?.api) await window.pywebview.api.stop_processing?.();
  }, [appendConsole, dispatch]);

  const confirmModalCopy = useMemo(() => {
    if (!confirmAction) return null;
    if (confirmAction.type === 'stop-processing') {
      return {
        title: 'Interrompere la sbobinatura?',
        description: "Stai per fermare l'elaborazione in corso. Il processo verrà interrotto e il file attuale tornerà in coda. Vuoi continuare?",
        confirmLabel: 'Conferma stop',
        cancelLabel: 'Continua elaborazione',
      };
    }
    if (confirmAction.type === 'remove-file') {
      return {
        title: 'Rimuovere questo elemento?',
        description: confirmAction.isDone
          ? `"${confirmAction.fileName}" verrà rimossa dai Recenti e resterà disponibile nell'Archivio. Vuoi continuare?`
          : `"${confirmAction.fileName}" verrà rimossa dalla lista. Vuoi continuare?`,
        confirmLabel: 'Conferma rimozione',
        cancelLabel: 'Tieni elemento',
      };
    }
    if (confirmAction.type === 'clear-all') {
      return {
        title: 'Svuotare tutta la coda?',
        description: "Tutti i file in coda verranno rimossi. L'operazione non può essere annullata.",
        confirmLabel: 'Svuota coda',
        cancelLabel: 'Annulla',
      };
    }
    if (confirmAction.type === 'delete-archive-session') {
      return {
        title: 'Eliminare questa sbobina?',
        description: !getHostCapabilities().permanentDelete
          ? `"${confirmAction.name}" va nel cestino: puoi ripristinarla per 30 giorni da Impostazioni → Archiviazione.`
          : `"${confirmAction.name}" e tutti i suoi dati di sessione verranno eliminati definitivamente da questo browser. L'operazione è irreversibile.`,
        confirmLabel: !getHostCapabilities().permanentDelete ? 'Sposta nel cestino' : 'Elimina definitivamente',
        cancelLabel: 'Annulla',
      };
    }
    if (confirmAction.type === 'delete-multiple-archive-sessions') {
      const count = confirmAction.sessions.length;
      return {
        title: count === 1 ? 'Eliminare questa sbobina?' : `Eliminare ${count} sbobine?`,
        description: !getHostCapabilities().permanentDelete
          ? count === 1
            ? 'La sbobina selezionata va nel cestino: puoi ripristinarla per 30 giorni da Impostazioni → Archiviazione.'
            : `Le ${count} sbobine selezionate vanno nel cestino: puoi ripristinarle per 30 giorni da Impostazioni → Archiviazione.`
          : `Tutti i file e i dati di sessione relativi alle ${count} sbobine selezionate verranno eliminati definitivamente da questo browser. L'operazione è irreversibile.`,
        confirmLabel: !getHostCapabilities().permanentDelete ? 'Sposta nel cestino' : count === 1 ? 'Elimina definitivamente' : `Elimina ${count} sbobine`,
        cancelLabel: 'Annulla',
      };
    }
    return {
      title: 'Ripristinare e riprovare la revisione?',
      description: `La sbobina "${confirmAction.session.name}" verrà spostata nella coda di elaborazione per revisionare i blocchi mancanti. Vuoi procedere?`,
      confirmLabel: 'Riprova revisione',
      cancelLabel: 'Annulla',
    };
  }, [confirmAction]);

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    if (confirmAction.type === 'stop-processing') {
      void confirmStopProcessing();
      return;
    }
    if (confirmAction.type === 'remove-file') {
      const removedFile = filesRef.current.find(f => f.id === confirmAction.fileId);
      dispatch({ type: 'queue/remove', id: confirmAction.fileId });
      setConfirmAction(null);
      if (removedFile?.status === 'queued') onFileRemovedFromBatch?.();
      if (removedFile?.status === 'done') void refreshArchiveSessions();
      else if (removedFile) releaseQueueFiles([removedFile]);
      return;
    }
    if (confirmAction.type === 'clear-all') {
      const removedFiles = filesRef.current.filter(file => file.status !== 'done');
      setConfirmAction(null);
      dispatch({ type: 'queue/clear_all' });
      releaseQueueFiles(removedFiles);
      return;
    }
    if (confirmAction.type === 'delete-archive-session') {
      const { sessionDir } = confirmAction;
      setConfirmAction(null);
      window.pywebview?.api?.delete_session?.(sessionDir).then(res => {
        if (res?.ok) {
          const normTarget = normalizeSessionDir(sessionDir);
          setArchiveSessions(prev => prev.filter(s => normalizeSessionDir(s.session_dir) !== normTarget));
          setArchiveTotal(prev => Math.max(0, prev - 1));
          dispatch({ type: 'queue/remove_sessions', sessionDirs: [sessionDir] });
          const updated = foldersRef.current.map(folder => ({
            ...folder,
            session_dirs: folder.session_dirs.filter(d => normalizeSessionDir(d) !== normTarget),
          }));
          void onFoldersChange(updated);
        } else {
          appendConsole(`❌ Errore eliminazione sessione: ${res?.error ?? 'errore sconosciuto'}`);
        }
      }).catch((e: unknown) => {
        appendConsole(`❌ Errore eliminazione sessione: ${getErrorMessage(e)}`);
      });
      return;
    }
    if (confirmAction.type === 'delete-multiple-archive-sessions') {
      const { sessions: targetSessions } = confirmAction;
      setConfirmAction(null);
      const dirs = targetSessions.map(s => s.sessionDir);
      const normDirSet = new Set(dirs.map(d => normalizeSessionDir(d)));
      Promise.all(dirs.map(d => window.pywebview?.api?.delete_session?.(d))).then(() => {
        setArchiveSessions(prev => prev.filter(s => !normDirSet.has(normalizeSessionDir(s.session_dir))));
        setArchiveTotal(prev => Math.max(0, prev - dirs.length));
        dispatch({ type: 'queue/remove_sessions', sessionDirs: dirs });
        const updated = foldersRef.current.map(folder => ({
          ...folder,
          session_dirs: folder.session_dirs.filter(d => !normDirSet.has(normalizeSessionDir(d))),
        }));
        void onFoldersChange(updated);
      }).catch((e: unknown) => {
        appendConsole(`❌ Errore eliminazione sessioni: ${getErrorMessage(e)}`);
      });
      return;
    }
    if (confirmAction.type === 'retry-archive-session') {
      const { session } = confirmAction;
      setConfirmAction(null);
      void executeRetryFromArchive(session);
    }
  }, [
    confirmAction,
    confirmStopProcessing,
    appendConsole,
    refreshArchiveSessions,
    executeRetryFromArchive,
    normalizeSessionDir,
    filesRef,
    dispatch,
    setArchiveSessions,
    setArchiveTotal,
    foldersRef,
    onFoldersChange,
    onFileRemovedFromBatch,
  ]);

  return {
    confirmAction,
    setConfirmAction,
    confirmModalCopy,
    handleConfirmAction,
    confirmStopProcessing,
  };
}

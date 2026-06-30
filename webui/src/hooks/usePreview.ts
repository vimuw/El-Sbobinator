import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProcessingAction } from '../appState';
import type { ArchiveSession } from '../bridge';
import { loadEditorSession, saveEditorSession, type EditorSession } from '../editorSessions';
import { normalizePreviewHtmlContent } from '../previewHtml';

export type PreviewState = {
  content: string | null;
  title: string;
  path: string;
  audioSrc: string | null;
  fileId: string | null;
  sourcePath: string;
  sessionDir: string;
  audioRelinkNeeded: boolean;
  initAudio: { time?: number; playbackRate?: number; volume?: number };
  initScrollTop?: number;
  initialSearchTerm?: string;
};

export const initialPreviewState: PreviewState = {
  content: null,
  title: '',
  path: '',
  audioSrc: null,
  fileId: null,
  sourcePath: '',
  sessionDir: '',
  audioRelinkNeeded: false,
  initAudio: {},
  initScrollTop: undefined,
};

type UsePreviewOptions = {
  appendConsole: (msg: string) => void;
  dispatch: Dispatch<ProcessingAction>;
  setArchiveSessions: Dispatch<SetStateAction<ArchiveSession[]>>;
  onOpenFailed?: (htmlPath: string, sessionDir: string) => void;
  onArchiveRefresh?: () => void | Promise<void>;
};

export function usePreview({ appendConsole, dispatch, setArchiveSessions, onOpenFailed, onArchiveRefresh }: UsePreviewOptions) {
  const [preview, setPreview] = useState<PreviewState>(initialPreviewState);
  const currentEditorSessionRef = useRef<EditorSession>({});
  const currentPreviewSessionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const sessionKey = currentPreviewSessionKeyRef.current;
      if (!sessionKey) return;
      const session = currentEditorSessionRef.current;
      const hasData =
        session.audioTime !== undefined
        || session.playbackRate !== undefined
        || session.volume !== undefined
        || session.scrollTop !== undefined;
      if (hasData) saveEditorSession(sessionKey, session);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const loadPreviewAudio = useCallback(async (sourcePath?: string, sessionDir?: string) => {
    const normalizedSource = String(sourcePath || '').trim();
    const normalizedSessionDir = String(sessionDir || '').trim();
    if ((!normalizedSource && !normalizedSessionDir) || !window.pywebview?.api?.stream_media_file) {
      setPreview(prev => ({ ...prev, audioSrc: null, audioRelinkNeeded: Boolean(normalizedSource) }));
      return false;
    }
    const streamRes = await window.pywebview.api.stream_media_file(normalizedSource, normalizedSessionDir || undefined);
    if (streamRes.ok && streamRes.url) {
      setPreview(prev => ({ ...prev, audioSrc: streamRes.url, audioRelinkNeeded: false }));
      return true;
    }
    setPreview(prev => ({ ...prev, audioSrc: null, audioRelinkNeeded: true }));
    return false;
  }, []);

  const openPreview = useCallback(async (
    htmlPath: string,
    filename: string,
    sourcePath?: string,
    fileId?: string,
    sessionDir?: string,
    searchTerm?: string,
  ) => {
    if (!window.pywebview?.api?.read_html_content) {
      appendConsole('❌ Funzione anteprima non disponibile in questa versione.');
      return;
    }
    appendConsole('Caricamento anteprima in corso...');
    try {
      const res = await window.pywebview.api.read_html_content(htmlPath);
      if (res.ok) {
        const bodyMatch = res.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const extractedContent = bodyMatch ? bodyMatch[1] : res.content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        const safeContent = normalizePreviewHtmlContent(extractedContent);
        const sessionKey = fileId ?? htmlPath;
        currentPreviewSessionKeyRef.current = sessionKey;
        const savedSession = loadEditorSession(sessionKey);
        currentEditorSessionRef.current = { ...savedSession };
        setPreview({
          content: safeContent,
          title: filename,
          path: htmlPath,
          fileId: fileId ?? null,
          sourcePath: sourcePath || '',
          sessionDir: sessionDir ?? '',
          audioSrc: null,
          audioRelinkNeeded: false,
          initAudio: { time: savedSession.audioTime, playbackRate: savedSession.playbackRate, volume: savedSession.volume },
          initScrollTop: savedSession.scrollTop,
          initialSearchTerm: searchTerm || undefined,
        });
        await loadPreviewAudio(sourcePath, sessionDir);
      } else {
        appendConsole(`❌ Errore anteprima: ${res.error}`);
        onOpenFailed?.(htmlPath, sessionDir ?? '');
      }
    } catch (e: unknown) {
      appendConsole(`❌ Errore JS anteprima: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [appendConsole, loadPreviewAudio, onOpenFailed]);

  const closePreview = useCallback(() => {
    const sessionKey = currentPreviewSessionKeyRef.current;
    if (sessionKey) {
      const session = currentEditorSessionRef.current;
      const hasData =
        session.audioTime !== undefined
        || session.playbackRate !== undefined
        || session.volume !== undefined
        || session.scrollTop !== undefined;
      if (hasData) saveEditorSession(sessionKey, session);
    }
    currentEditorSessionRef.current = {};
    currentPreviewSessionKeyRef.current = null;
    setPreview(initialPreviewState);
  }, []);

  const relinkPreviewAudio = useCallback(async () => {
    if (!window.pywebview?.api?.ask_media_file) return;
    try {
      const selectedFile = await window.pywebview.api.ask_media_file();
      if (!selectedFile?.path) return;
      let persistOk = true;
      if (preview.sessionDir) {
        if (!window.pywebview?.api?.update_session_input_path) {
          // The bridge is present but the persist endpoint is missing — treat as
          // a failure so we never update in-memory state without a disk write.
          persistOk = false;
        } else {
          const saveRes = await window.pywebview.api.update_session_input_path(preview.sessionDir, selectedFile.path);
          if (saveRes?.ok) {
            setArchiveSessions(prev => prev.map(s =>
              s.session_dir === preview.sessionDir ? { ...s, input_path: selectedFile.path } : s,
            ));
            await onArchiveRefresh?.();
          } else {
            persistOk = false;
          }
        }
      }
      if (!persistOk) {
        appendConsole('❌ Impossibile salvare il nuovo link audio nella sessione.');
        return false;
      }
      if (preview.fileId || preview.sessionDir) {
        dispatch({ type: 'queue/update_source', id: preview.fileId ?? undefined, sessionDir: preview.sessionDir || undefined, path: selectedFile.path, name: selectedFile.name, size: selectedFile.size, duration: selectedFile.duration });
      }
      setPreview(prev => ({ ...prev, sourcePath: selectedFile.path, audioRelinkNeeded: false }));
      const didLoad = await loadPreviewAudio(selectedFile.path, preview.sessionDir);
      // NOTE: this log fires regardless of whether loadPreviewAudio returned true
      // (i.e. the blob URL was actually created). Pre-existing behavior — left
      // untouched intentionally; fix separately if audio-relink UX is revisited.
      appendConsole(`Audio ricollegato: ${selectedFile.name}`);
      return didLoad;
    } catch (error: unknown) {
      appendConsole(`❌ Impossibile ricollegare l'audio: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }, [appendConsole, dispatch, loadPreviewAudio, onArchiveRefresh, preview.fileId, preview.sessionDir, setArchiveSessions]);

  const handleAudioStateChange = useCallback(({ currentTime, playbackRate, volume }: { currentTime: number; playbackRate: number; volume: number }) => {
    currentEditorSessionRef.current = { ...currentEditorSessionRef.current, audioTime: currentTime, playbackRate, volume };
  }, []);

  const handleScrollTopChange = useCallback((scrollTop: number) => {
    currentEditorSessionRef.current = { ...currentEditorSessionRef.current, scrollTop };
  }, []);

  return {
    preview,
    openPreview,
    closePreview,
    relinkPreviewAudio,
    handleAudioStateChange,
    handleScrollTopChange,
  };
}

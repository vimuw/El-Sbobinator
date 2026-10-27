import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ProcessingAction } from '../appState';
import type { ArchiveSession } from '../bridge';
import { loadEditorSession, saveEditorSession, touchEditorSession, type EditorSession } from '../editorSessions';
import { normalizePreviewHtmlContent } from '../previewHtml';
import { normalizeSessionPath } from '../utils';

export type PreviewState = {
  content: string | null;
  title: string;
  path: string;
  audioSrc: string | null;
  fileId: string | null;
  sourcePath: string;
  sessionDir: string;
  audioRelinkNeeded: boolean;
  audioLoading: boolean;
  audioWarning: string;
  /** Web: the audio playing is a copy kept in this browser; its size in bytes. */
  audioKept: boolean;
  audioSize: number;
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
  audioLoading: false,
  audioWarning: '',
  audioKept: false,
  audioSize: 0,
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
  const audioRequestRef = useRef(0);
  const previewRequestRef = useRef(0);

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
    const request = ++audioRequestRef.current;
    const normalizedSource = String(sourcePath || '').trim();
    const normalizedSessionDir = String(sessionDir || '').trim();
    if ((!normalizedSource && !normalizedSessionDir) || !window.pywebview?.api?.stream_media_file) {
      setPreview(prev => ({ ...prev, audioSrc: null, audioRelinkNeeded: Boolean(normalizedSource), audioLoading: false, audioWarning: '' }));
      return false;
    }
    setPreview(prev => ({ ...prev, audioLoading: true, audioWarning: '' }));
    try {
      const streamRes = await window.pywebview.api.stream_media_file(normalizedSource, normalizedSessionDir || undefined);
      if (request !== audioRequestRef.current) return false;
      if (streamRes.ok && streamRes.url) {
        setPreview(prev => ({
          ...prev,
          audioSrc: streamRes.url,
          audioRelinkNeeded: false,
          audioLoading: false,
          audioWarning: streamRes.warning || '',
          audioKept: Boolean(streamRes.audio_kept),
          audioSize: streamRes.audio_size ?? 0,
        }));
        if (streamRes.warning) appendConsole(`⚠️ ${streamRes.warning}`);
        return true;
      }
      const relinkNeeded = streamRes.has_audio !== false;
      setPreview(prev => ({ ...prev, audioSrc: null, audioRelinkNeeded: relinkNeeded, audioLoading: false }));
      return false;
    } catch (error) {
      if (request === audioRequestRef.current) {
        setPreview(prev => ({ ...prev, audioSrc: null, audioRelinkNeeded: true, audioLoading: false }));
      }
      throw error;
    }
  }, [appendConsole]);

  const openPreview = useCallback(async (
    htmlPath: string,
    filename: string,
    sourcePath?: string,
    fileId?: string,
    sessionDir?: string,
    searchTerm?: string,
  ): Promise<boolean> => {
    if (!window.pywebview?.api?.read_html_content) {
      appendConsole('❌ Funzione anteprima non disponibile in questa versione.');
      return false;
    }
    appendConsole('Caricamento anteprima in corso...');
    const request = ++previewRequestRef.current;
    ++audioRequestRef.current;
    let opened = false;
    try {
      const res = await window.pywebview.api.read_html_content(htmlPath);
      if (request !== previewRequestRef.current) return false;
      if (res.ok) {
        const bodyMatch = res.content.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const extractedContent = bodyMatch ? bodyMatch[1] : res.content.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
        const safeContent = normalizePreviewHtmlContent(extractedContent);
        const sessionKey = fileId ?? htmlPath;
        currentPreviewSessionKeyRef.current = sessionKey;
        ++audioRequestRef.current;
        touchEditorSession(sessionKey);
        if (sessionDir && window.pywebview?.api?.touch_session_opened) {
          void window.pywebview.api.touch_session_opened(sessionDir).catch(() => {});
        }
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
          audioLoading: Boolean(sourcePath || sessionDir),
          audioWarning: '',
          audioKept: false,
          audioSize: 0,
          initAudio: { time: savedSession.audioTime, playbackRate: savedSession.playbackRate, volume: savedSession.volume },
          initScrollTop: savedSession.scrollTop,
          initialSearchTerm: searchTerm || undefined,
        });
        opened = true;
        await loadPreviewAudio(sourcePath, sessionDir);
        return true;
      }
      appendConsole(`❌ Errore anteprima: ${res.error}`);
      onOpenFailed?.(htmlPath, sessionDir ?? '');
    } catch (e: unknown) {
      appendConsole(`❌ Errore JS anteprima: ${e instanceof Error ? e.message : String(e)}`);
    }
    return opened;
  }, [appendConsole, loadPreviewAudio, onOpenFailed]);

  const closePreview = useCallback(() => {
    ++previewRequestRef.current;
    ++audioRequestRef.current;
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
    const api = window.pywebview?.api;
    // The web build picks the file for this page only, without copying it into the browser.
    const askFile = api?.ask_editor_media_file ?? api?.ask_media_file;
    if (!askFile) return;
    const sessionKey = currentPreviewSessionKeyRef.current;
    try {
      const selectedFile = await askFile();
      if (!selectedFile?.path) return;
      if (sessionKey !== currentPreviewSessionKeyRef.current) return false;
      let persistOk = true;
      let relinkWarning = '';
      if (preview.sessionDir) {
        if (!window.pywebview?.api?.update_session_input_path) {
          // The bridge is present but the persist endpoint is missing — treat as
          // a failure so we never update in-memory state without a disk write.
          persistOk = false;
        } else {
          setPreview(prev => ({ ...prev, audioLoading: true, audioWarning: '' }));
          const saveRes = await window.pywebview.api.update_session_input_path(preview.sessionDir, selectedFile.path);
          if (sessionKey !== currentPreviewSessionKeyRef.current) return false;
          if (saveRes?.ok) {
            relinkWarning = saveRes.warning || '';
            setArchiveSessions(prev => prev.map(s =>
              normalizeSessionPath(s.session_dir) === normalizeSessionPath(preview.sessionDir) ? { ...s, input_path: selectedFile.path } : s,
            ));
            await onArchiveRefresh?.();
          } else {
            persistOk = false;
          }
        }
      }
      if (!persistOk) {
        setPreview(prev => ({ ...prev, audioLoading: false }));
        appendConsole('❌ Impossibile salvare il nuovo link audio nella sessione.');
        return false;
      }
      if (preview.fileId || preview.sessionDir) {
        dispatch({ type: 'queue/update_source', id: preview.fileId ?? undefined, sessionDir: preview.sessionDir || undefined, path: selectedFile.path, name: selectedFile.name, size: selectedFile.size, duration: selectedFile.duration });
      }
      setPreview(prev => ({ ...prev, sourcePath: selectedFile.path, audioRelinkNeeded: false }));
      const didLoad = await loadPreviewAudio(selectedFile.path, preview.sessionDir);
      if (didLoad) appendConsole(`Audio ricollegato: ${selectedFile.name}`);
      // A file that may not be the lecture is still used: the dock says why the times may not match.
      if (relinkWarning && sessionKey === currentPreviewSessionKeyRef.current) {
        appendConsole(`⚠️ ${relinkWarning}`);
        setPreview(prev => ({ ...prev, audioWarning: relinkWarning }));
      }
      return didLoad;
    } catch (error: unknown) {
      setPreview(prev => ({ ...prev, audioLoading: false }));
      appendConsole(`❌ Impossibile ricollegare l'audio: ${error instanceof Error ? error.message : String(error)}`);
    }
    return false;
  }, [appendConsole, dispatch, loadPreviewAudio, onArchiveRefresh, preview.fileId, preview.sessionDir, setArchiveSessions]);

  const removePreviewAudio = useCallback(async () => {
    try {
      let persistOk = true;
      let persistedTitle: string | undefined;
      if (preview.sessionDir) {
        if (!window.pywebview?.api?.remove_session_audio) {
          persistOk = false;
        } else {
          const res = await window.pywebview.api.remove_session_audio(preview.sessionDir);
          if (res?.ok) {
            persistedTitle = res.name || undefined;
            setArchiveSessions(prev => prev.map(s =>
              normalizeSessionPath(s.session_dir) === normalizeSessionPath(preview.sessionDir) ? { ...s, input_path: '', ...(persistedTitle ? { name: persistedTitle } : {}) } : s,
            ));
            await onArchiveRefresh?.();
          } else {
            persistOk = false;
          }
        }
      }
      if (!persistOk) {
        appendConsole('❌ Impossibile rimuovere il link audio dalla sessione.');
        return false;
      }
      let nextTitle = persistedTitle ?? preview.title;
      if (!persistedTitle && preview.path && /\.(mp3|m4a|wav|ogg|flac|aac|opus|mp4|mkv|webm)$/i.test(nextTitle)) {
        const base = preview.path.split(/[/\\]/).pop() || '';
        if (base.endsWith('_Sbobina.html')) {
          nextTitle = base.slice(0, -'_Sbobina.html'.length);
        } else if (base.endsWith('.html')) {
          nextTitle = base.slice(0, -'.html'.length);
        }
      }

      // The queue card keeps showing the sbobina by its title: an empty name came back as
      // "file-N" after a reload.
      if (preview.fileId || preview.sessionDir) {
        dispatch({
          type: 'queue/update_source',
          id: preview.fileId ?? undefined,
          sessionDir: preview.sessionDir || undefined,
          path: '',
          name: nextTitle || undefined,
          size: 0,
        });
      }

      if (currentEditorSessionRef.current) {
        delete currentEditorSessionRef.current.audioTime;
        if (preview.fileId) {
          saveEditorSession(preview.fileId, currentEditorSessionRef.current);
        }
      }

      setPreview(prev => ({
        ...prev,
        title: nextTitle,
        sourcePath: '',
        audioSrc: null,
        audioRelinkNeeded: false,
        audioLoading: false,
        audioWarning: '',
        initAudio: {},
      }));
      appendConsole('Audio rimosso dalla sbobina.');
      return true;
    } catch (error: unknown) {
      appendConsole(`❌ Impossibile rimuovere l'audio: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }, [appendConsole, dispatch, onArchiveRefresh, preview.fileId, preview.path, preview.sessionDir, preview.title, setArchiveSessions]);

  // Web: "Tieni l'audio in questo browser". The player keeps playing either way; without a copy the
  // file is asked for again after a reload.
  const setPreviewAudioKept = useCallback(async (keep: boolean) => {
    const api = window.pywebview?.api;
    const sessionKey = currentPreviewSessionKeyRef.current;
    if (!preview.sessionDir || !api?.set_session_audio_kept) return false;
    try {
      const res = await api.set_session_audio_kept(preview.sessionDir, keep);
      if (sessionKey !== currentPreviewSessionKeyRef.current) return false;
      if (!res?.ok) {
        appendConsole(`❌ ${res?.error || 'Impossibile cambiare la copia dell’audio in questo browser.'}`);
        return false;
      }
      const kept = res.audio_kept ?? keep;
      setPreview(prev => ({ ...prev, audioKept: kept }));
      await onArchiveRefresh?.();
      appendConsole(kept ? 'Audio tenuto in questo browser.' : 'Copia dell’audio tolta da questo browser: dopo aver ricaricato la pagina scegli di nuovo il file.');
      return true;
    } catch (error: unknown) {
      appendConsole(`❌ Impossibile cambiare la copia dell’audio: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }, [appendConsole, onArchiveRefresh, preview.sessionDir]);

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
    removePreviewAudio,
    setPreviewAudioKept,
    handleAudioStateChange,
    handleScrollTopChange,
  };
}

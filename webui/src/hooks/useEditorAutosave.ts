import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveHtmlResult } from '../bridge';
import { nextHtmlAutosaveGeneration, seedHtmlAutosaveGeneration } from '../autosaveGeneration';

const isSaveCommitted = (res: SaveHtmlResult) => res.ok && res.saved !== false;

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface EditorSaveController {
  getDirtyContent: () => { path: string; content: string } | null;
  flushPendingAutosave: () => Promise<boolean>;
  cancelPendingAutosave: () => void;
}

export interface UseEditorAutosaveOptions {
  htmlPath: string;
  previewContent: string | null;
  collabRoom?: string;
  getHtmlRef: React.MutableRefObject<(() => string) | null>;
  onClose: () => void;
  setCollabRoom?: (room: string | undefined) => void;
  setCollabUser?: (user: { name: string; color: string } | undefined) => void;
  onCollaborationStateChange?: (room?: string, user?: { name: string; color: string }) => void;
  saveControllerRef?: React.RefObject<EditorSaveController | null>;
}

export function useEditorAutosave({
  htmlPath,
  previewContent,
  collabRoom,
  getHtmlRef,
  onClose,
  setCollabRoom,
  setCollabUser,
  onCollaborationStateChange,
  saveControllerRef,
}: UseEditorAutosaveOptions) {
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [isAutosaveSuspended, setIsAutosaveSuspended] = useState(false);
  const isDirtyRef = useRef(false);
  const lastPersistedRef = useRef(previewContent ?? '');
  const autosaveTimerRef = useRef<number | null>(null);
  const [autosaveGenSeed] = useState(() => seedHtmlAutosaveGeneration(htmlPath));
  const autosaveGenRef = useRef(autosaveGenSeed);
  const saveErrorOnCloseRef = useRef(false);
  const htmlPathRef = useRef(htmlPath);

  useEffect(() => {
    htmlPathRef.current = htmlPath;
    autosaveGenRef.current = seedHtmlAutosaveGeneration(htmlPath);
  }, [htmlPath]);

  useEffect(() => {
    lastPersistedRef.current = previewContent ?? '';
    isDirtyRef.current = false;
    saveErrorOnCloseRef.current = false;
    setAutosaveStatus('idle');
  }, [previewContent]);

  useEffect(() => {
    const autosaveGenRefAtCleanup = autosaveGenRef;
    const getHtmlAtCleanup = getHtmlRef;
    return () => {
      if (!isDirtyRef.current || saveErrorOnCloseRef.current) return;
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      const path = htmlPathRef.current;
      const snap = getHtmlAtCleanup.current?.() ?? '';
      if (path && snap && snap !== lastPersistedRef.current) {
        const gen = nextHtmlAutosaveGeneration(path);
        autosaveGenRefAtCleanup.current = gen;
        void window.pywebview?.api?.save_html_content(path, snap, gen);
      }
    };
  }, [getHtmlRef]);

  const getDirtyContent = useCallback((): { path: string; content: string } | null => {
    if (!isDirtyRef.current) return null;
    const path = htmlPathRef.current;
    if (!path) return null;
    const snap = getHtmlRef.current?.() ?? '';
    if (snap === lastPersistedRef.current) return null;
    return { path, content: snap };
  }, [getHtmlRef]);

  const cancelPendingAutosave = useCallback(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    isDirtyRef.current = false;
  }, []);

  const flushPendingAutosave = useCallback(async (): Promise<boolean> => {
    if (!isDirtyRef.current) return true;
    if (saveErrorOnCloseRef.current) return false;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const path = htmlPathRef.current;
    const snap = getHtmlRef.current?.() ?? '';
    if (path && snap && snap !== lastPersistedRef.current && window.pywebview?.api?.save_html_content) {
      const gen = nextHtmlAutosaveGeneration(path);
      autosaveGenRef.current = gen;
      try {
        const res = await window.pywebview.api.save_html_content(path, snap, gen);
        if (isSaveCommitted(res)) {
          lastPersistedRef.current = snap;
          if (gen === autosaveGenRef.current) isDirtyRef.current = false;
          return true;
        }
        saveErrorOnCloseRef.current = true;
        setAutosaveStatus('error');
        return false;
      } catch (_) {
        saveErrorOnCloseRef.current = true;
        setAutosaveStatus('error');
        return false;
      }
    }
    return true;
  }, [getHtmlRef]);

  useEffect(() => {
    if (saveControllerRef) {
      saveControllerRef.current = {
        getDirtyContent,
        flushPendingAutosave,
        cancelPendingAutosave,
      };
    }
    const win = window as unknown as Record<string, unknown>;
    win.__elSbobinatorGetDirtyEditorContent = getDirtyContent;
    win.__elSbobinatorFlushPendingAutosave = flushPendingAutosave;
    win.__elSbobinatorCancelPendingAutosave = cancelPendingAutosave;
    return () => {
      if (saveControllerRef) {
        saveControllerRef.current = null;
      }
      delete win.__elSbobinatorGetDirtyEditorContent;
      delete win.__elSbobinatorFlushPendingAutosave;
      delete win.__elSbobinatorCancelPendingAutosave;
    };
  }, [saveControllerRef, getDirtyContent, flushPendingAutosave, cancelPendingAutosave]);

  const flushAndClose = useCallback(async () => {
    const isCollabActive = Boolean(collabRoom);
    setCollabRoom?.(undefined);
    setCollabUser?.(undefined);
    onCollaborationStateChange?.(undefined, undefined);
    if (isDirtyRef.current && !saveErrorOnCloseRef.current) {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      const path = htmlPathRef.current;
      const snap = getHtmlRef.current?.() ?? '';
      if (path && snap && snap !== lastPersistedRef.current && window.pywebview?.api?.save_html_content) {
        if (isCollabActive && lastPersistedRef.current.length > 200 && snap.length < lastPersistedRef.current.length * 0.25) {
          console.warn('Salvataggio di chiusura ignorato: rilevata riduzione drastica in sessione collaborativa.');
          onClose();
          return;
        }
        setAutosaveStatus('saving');
        const gen = nextHtmlAutosaveGeneration(path);
        autosaveGenRef.current = gen;
        try {
          const res = await window.pywebview.api.save_html_content(path, snap, gen);
          if (isSaveCommitted(res)) {
            lastPersistedRef.current = snap;
            if (gen === autosaveGenRef.current) isDirtyRef.current = false;
          } else {
            saveErrorOnCloseRef.current = true;
            setAutosaveStatus('error');
            return;
          }
        } catch {
          saveErrorOnCloseRef.current = true;
          setAutosaveStatus('error');
          return;
        }
      }
    }
    onClose();
  }, [collabRoom, setCollabRoom, setCollabUser, onCollaborationStateChange, onClose, getHtmlRef]);

  const handleForceSave = useCallback(async () => {
    const path = htmlPathRef.current;
    const snap = getHtmlRef.current?.() ?? '';
    if (!path || !snap || !window.pywebview?.api?.save_html_content) return;
    setAutosaveStatus('saving');
    const gen = nextHtmlAutosaveGeneration(path);
    autosaveGenRef.current = gen;
    try {
      const res = await window.pywebview.api.save_html_content(path, snap, gen);
      if (isSaveCommitted(res)) {
        lastPersistedRef.current = snap;
        if (gen === autosaveGenRef.current) isDirtyRef.current = false;
        setIsAutosaveSuspended(false);
        setAutosaveStatus('saved');
      } else {
        setAutosaveStatus('error');
      }
    } catch {
      setAutosaveStatus('error');
    }
  }, [getHtmlRef]);

  const scheduleAutosave = useCallback(() => {
    if (!htmlPath || previewContent === null || htmlPath.startsWith('collaboration://')) return;
    isDirtyRef.current = true;
    saveErrorOnCloseRef.current = false;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    const savedForPath = htmlPath;
    const gen = nextHtmlAutosaveGeneration(savedForPath);
    autosaveGenRef.current = gen;
    autosaveTimerRef.current = window.setTimeout(async () => {
      if (!isDirtyRef.current || !window.pywebview?.api?.save_html_content) return;
      const snap = getHtmlRef.current?.() ?? '';
      if (snap === lastPersistedRef.current) {
        isDirtyRef.current = false;
        return;
      }

      // Safeguard: se siamo in modalità collaborativa e il documento subisce una riduzione >75%,
      // blocchiamo l'autosave per evitare la distruzione accidentale del file locale dell'host.
      if (collabRoom && lastPersistedRef.current.length > 200 && snap.length < lastPersistedRef.current.length * 0.25) {
        console.warn('Autosave sospeso in sessione collaborativa: rilevata riduzione drastica del testo.');
        setAutosaveStatus('error');
        setIsAutosaveSuspended(true);
        return;
      }
      setIsAutosaveSuspended(false);

      setAutosaveStatus('saving');
      try {
        const res = await window.pywebview.api.save_html_content(savedForPath, snap, gen);
        if (htmlPathRef.current !== savedForPath) return;
        if (gen !== autosaveGenRef.current) return;
        if (isSaveCommitted(res)) {
          lastPersistedRef.current = snap;
          isDirtyRef.current = false;
          setAutosaveStatus('saved');
        } else {
          setAutosaveStatus('error');
        }
      } catch {
        setAutosaveStatus('error');
      }
    }, 700);
  }, [htmlPath, previewContent, collabRoom, getHtmlRef]);

  useEffect(() => {
    if (autosaveStatus !== 'saved') return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      if (!cancelled) setAutosaveStatus('idle');
    }, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [autosaveStatus]);

  return {
    autosaveStatus,
    isAutosaveSuspended,
    isDirtyRef,
    lastPersistedRef,
    scheduleAutosave,
    handleForceSave,
    flushAndClose,
  };
}

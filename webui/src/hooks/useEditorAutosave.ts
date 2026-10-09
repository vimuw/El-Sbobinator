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
  getHtmlRef: React.MutableRefObject<(() => string) | null>;
  onClose: () => void;
  saveControllerRef?: React.RefObject<EditorSaveController | null>;
}

export function useEditorAutosave({
  htmlPath,
  previewContent,
  getHtmlRef,
  onClose,
  saveControllerRef,
}: UseEditorAutosaveOptions) {
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const isDirtyRef = useRef(false);
  const lastPersistedRef = useRef(previewContent ?? '');
  // A submitted write can change disk even if its acknowledgement becomes stale.
  const diskStateConfirmedRef = useRef(true);
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
    diskStateConfirmedRef.current = true;
    isDirtyRef.current = false;
    saveErrorOnCloseRef.current = false;
    setAutosaveStatus('idle');
  }, [htmlPath, previewContent]);

  useEffect(() => {
    const autosaveGenRefAtCleanup = autosaveGenRef;
    const getHtmlAtCleanup = getHtmlRef;
    return () => {
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (!isDirtyRef.current || saveErrorOnCloseRef.current) return;
      const path = htmlPathRef.current;
      const snap = getHtmlAtCleanup.current?.() ?? '';
      if (path && snap && (!diskStateConfirmedRef.current || snap !== lastPersistedRef.current)) {
        const gen = nextHtmlAutosaveGeneration(path);
        autosaveGenRefAtCleanup.current = gen;
        diskStateConfirmedRef.current = false;
        void window.pywebview?.api?.save_html_content(path, snap, gen);
      }
    };
  }, [getHtmlRef]);

  const getDirtyContent = useCallback((): { path: string; content: string } | null => {
    if (!isDirtyRef.current) return null;
    const path = htmlPathRef.current;
    if (!path) return null;
    const snap = getHtmlRef.current?.() ?? '';
    if (diskStateConfirmedRef.current && snap === lastPersistedRef.current) return null;
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
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    const path = htmlPathRef.current;
    const snap = getHtmlRef.current?.() ?? '';
    if (diskStateConfirmedRef.current && snap === lastPersistedRef.current) {
      isDirtyRef.current = false;
      return true;
    }
    if (snap && window.pywebview?.api?.save_html_content) {
      if (!path) return false;
      const gen = nextHtmlAutosaveGeneration(path);
      autosaveGenRef.current = gen;
      diskStateConfirmedRef.current = false;
      setAutosaveStatus('saving');
      try {
        const res = await window.pywebview.api.save_html_content(path, snap, gen);
        if (htmlPathRef.current !== path || gen !== autosaveGenRef.current) return false;
        if (isSaveCommitted(res)) {
          lastPersistedRef.current = snap;
          diskStateConfirmedRef.current = true;
          isDirtyRef.current = false;
          saveErrorOnCloseRef.current = false;
          setAutosaveStatus('saved');
          return true;
        }
        saveErrorOnCloseRef.current = true;
        setAutosaveStatus('error');
        return false;
      } catch (_) {
        if (htmlPathRef.current !== path || gen !== autosaveGenRef.current) return false;
        saveErrorOnCloseRef.current = true;
        setAutosaveStatus('error');
        return false;
      }
    }
    setAutosaveStatus('error');
    return false;
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
    if (saveErrorOnCloseRef.current) {
      cancelPendingAutosave();
    } else if (!await flushPendingAutosave()) return;
    onClose();
  }, [flushPendingAutosave, cancelPendingAutosave, onClose]);

  const scheduleAutosave = useCallback(() => {
    if (!htmlPath || previewContent === null) return;
    isDirtyRef.current = true;
    saveErrorOnCloseRef.current = false;
    if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
    const savedForPath = htmlPath;
    const gen = nextHtmlAutosaveGeneration(savedForPath);
    autosaveGenRef.current = gen;
    autosaveTimerRef.current = window.setTimeout(async () => {
      if (!isDirtyRef.current || !window.pywebview?.api?.save_html_content) return;
      const snap = getHtmlRef.current?.() ?? '';
      if (diskStateConfirmedRef.current && snap === lastPersistedRef.current) {
        isDirtyRef.current = false;
        return;
      }

      diskStateConfirmedRef.current = false;
      setAutosaveStatus('saving');
      try {
        const res = await window.pywebview.api.save_html_content(savedForPath, snap, gen);
        if (htmlPathRef.current !== savedForPath) return;
        if (gen !== autosaveGenRef.current) return;
        if (isSaveCommitted(res)) {
          lastPersistedRef.current = snap;
          diskStateConfirmedRef.current = true;
          isDirtyRef.current = false;
          setAutosaveStatus('saved');
        } else {
          setAutosaveStatus('error');
        }
      } catch {
        if (htmlPathRef.current !== savedForPath || gen !== autosaveGenRef.current) return;
        setAutosaveStatus('error');
      }
    }, 700);
  }, [htmlPath, previewContent, getHtmlRef]);

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
    isDirtyRef,
    lastPersistedRef,
    scheduleAutosave,
    flushAndClose,
  };
}

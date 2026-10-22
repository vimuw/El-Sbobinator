import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { ActivePage } from '../components/NavSidebar';

// The web build keeps the current screen in the URL hash and in the browser history, so Back/Forward
// (and the iPad edge swipe) move between screens and a reload reopens the same one. The desktop
// window has no address bar or Back button: there the hook does nothing.

export interface Screen {
  page: ActivePage;
  settings: boolean;
  /** session_dir of the sbobina open in the editor. */
  editor: string | null;
}

interface HistoryEntryState {
  /** Hash of the entry this one was pushed from: closing the screen goes back to it. */
  elSbobinatorBack?: string;
}

const WEB_SESSION_PREFIX = 'web-session://';

export function screenHash(screen: Screen): string {
  const parts: string[] = [];
  if (screen.page === 'archive') parts.push('archivio');
  if (screen.editor) {
    const id = screen.editor.startsWith(WEB_SESSION_PREFIX) ? screen.editor.slice(WEB_SESSION_PREFIX.length) : screen.editor;
    parts.push('sbobina', encodeURIComponent(id));
  } else if (screen.settings) {
    parts.push('impostazioni');
  }
  return parts.length ? `#/${parts.join('/')}` : '';
}

export function parseScreenHash(hash: string): Screen {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const screen: Screen = { page: 'queue', settings: false, editor: null };
  if (parts[0] === 'archivio') {
    screen.page = 'archive';
    parts.shift();
  }
  if (parts[0] === 'impostazioni') {
    screen.settings = true;
  } else if (parts[0] === 'sbobina' && parts[1]) {
    let id = parts[1];
    try { id = decodeURIComponent(id); } catch { /* keep it as written */ }
    screen.editor = id.includes('://') ? id : `${WEB_SESSION_PREFIX}${id}`;
  }
  return screen;
}

function currentHash(): string {
  return window.location.hash === '#' ? '' : window.location.hash;
}

function urlFor(hash: string): string {
  return `${window.location.pathname}${window.location.search}${hash}`;
}

export interface UseHistoryNavigationOptions {
  enabled: boolean;
  screen: Screen;
  /** The archive is loaded: a sbobina in the URL can be looked up. */
  ready: boolean;
  setPage: (page: ActivePage) => void;
  setSettingsOpen: (open: boolean) => void;
  /** Opens the sbobina; false when it is not in this browser any more. */
  openEditor: (sessionDir: string) => Promise<boolean>;
  /** Saves pending edits and closes the editor; false when the save failed and it stays open. */
  closeEditor: () => Promise<boolean>;
}

export function useHistoryNavigation({ enabled, screen, ready, setPage, setSettingsOpen, openEditor, closeEditor }: UseHistoryNavigationOptions): void {
  const screenRef = useRef(screen);
  const readyRef = useRef(ready);
  // Screen taken from the URL (reload, Back, Forward) while the app catches up with it.
  const pendingRef = useRef<Screen | null>(null);
  // Hash of a history.back() we asked for: its popstate only confirms what the app already shows.
  const awaitedPopRef = useRef<string | null>(null);
  const openingRef = useRef<string | null>(null);
  const restoredRef = useRef(false);
  const callbacksRef = useRef({ setPage, setSettingsOpen, openEditor, closeEditor });

  useLayoutEffect(() => {
    screenRef.current = screen;
    readyRef.current = ready;
    callbacksRef.current = { setPage, setSettingsOpen, openEditor, closeEditor };
  });

  const syncUrl = useCallback(() => {
    if (pendingRef.current || awaitedPopRef.current !== null) return;
    const hash = screenHash(screenRef.current);
    if (hash === currentHash()) return;
    const state = window.history.state as HistoryEntryState | null;
    if (state?.elSbobinatorBack === hash) {
      // Closing what the previous entry opened: go back instead of piling up entries.
      awaitedPopRef.current = hash;
      window.history.back();
      return;
    }
    window.history.pushState({ elSbobinatorBack: currentHash() } satisfies HistoryEntryState, '', urlFor(hash));
  }, []);

  const settle = useCallback((reached: Screen) => {
    pendingRef.current = null;
    const hash = screenHash(reached);
    if (hash !== currentHash()) window.history.replaceState(window.history.state, '', urlFor(hash));
  }, []);

  const applyTarget = useCallback(async (target: Screen) => {
    const current = screenRef.current;
    if (screenHash(target) === screenHash(current)) {
      settle(target);
      return;
    }
    pendingRef.current = target;
    const { setPage: goTo, setSettingsOpen: showSettings, openEditor: open, closeEditor: close } = callbacksRef.current;
    if (current.editor && current.editor !== target.editor) {
      if (!await close()) {
        // Unsaved edits: the editor stays, and so does its entry.
        pendingRef.current = null;
        syncUrl();
        return;
      }
    }
    goTo(target.page);
    showSettings(target.settings && !target.editor);
    if (!target.editor || target.editor === current.editor) return;
    // Before the archive is loaded the sbobina cannot be found: the ready effect comes back here.
    if (!readyRef.current || openingRef.current === target.editor) return;
    openingRef.current = target.editor;
    let opened: boolean;
    try {
      opened = await open(target.editor);
    } finally {
      openingRef.current = null;
    }
    if (!opened && pendingRef.current === target) settle({ ...target, editor: null });
  }, [settle, syncUrl]);

  // First the URL is read (reload), then it follows the app.
  useEffect(() => {
    if (!enabled) return;
    if (!restoredRef.current) {
      restoredRef.current = true;
      void applyTarget(parseScreenHash(currentHash()));
    }
    const handlePopState = () => {
      const hash = currentHash();
      const awaited = awaitedPopRef.current;
      awaitedPopRef.current = null;
      if (awaited !== null && awaited === hash) {
        syncUrl();
        return;
      }
      void applyTarget(parseScreenHash(hash));
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [enabled, applyTarget, syncUrl]);

  // The app reached the screen in the URL, or the user moved on: the URL follows the app.
  useEffect(() => {
    if (!enabled) return;
    const pending = pendingRef.current;
    if (pending && screenHash(pending) === screenHash(screen)) pendingRef.current = null;
    syncUrl();
  }, [enabled, screen, syncUrl]);

  useEffect(() => {
    if (!enabled || !ready) return;
    const pending = pendingRef.current;
    if (pending?.editor) void applyTarget(pending);
  }, [enabled, ready, applyTarget]);
}

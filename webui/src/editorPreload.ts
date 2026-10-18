import { lazy, type ComponentType } from 'react';

// The editor page and its rich text editor are lazy chunks. Warming them while the app is idle
// lets the first opened sbobina render at once instead of showing "Caricamento editor...".
type IdleWindow = Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const IDLE_TIMEOUT_MS = 4000;
const FALLBACK_DELAY_MS = 1500;

type LoadedModule<T> = { default: T };

// React.lazy suspends on its first render even when the chunk is already in memory, because
// import() only settles in a microtask, and the Suspense fallback is painted for a few frames.
// Once a warm-up has loaded the component, hand React a thenable that resolves synchronously.
export function preloadableLazy<T extends ComponentType<never>>(load: () => Promise<T>) {
  let loaded: LoadedModule<T> | null = null;
  const preload = () => load().then(component => { loaded = { default: component }; return component; });
  const Component = lazy(() => {
    if (!loaded) return preload().then(component => ({ default: component }));
    const settled = loaded;
    return { then: (resolve: (value: LoadedModule<T>) => void) => resolve(settled) } as Promise<LoadedModule<T>>;
  });
  return { Component, preload };
}

export const EditorFullPageChunk = preloadableLazy(() => import('./components/EditorFullPage').then(m => m.EditorFullPage));
export const RichTextEditorChunk = preloadableLazy(() => import('./components/RichTextEditor').then(m => m.RichTextEditor));

let preloadPromise: Promise<unknown> | null = null;

export function preloadEditorModules(): Promise<unknown> {
  preloadPromise ??= Promise.all([
    EditorFullPageChunk.preload(),
    RichTextEditorChunk.preload(),
  ]).catch(error => {
    // A failed warm-up must not block the regular lazy load on open.
    preloadPromise = null;
    throw error;
  });
  return preloadPromise;
}

export function scheduleEditorPreload(
  win: IdleWindow = window,
  preload: () => Promise<unknown> = preloadEditorModules,
): () => void {
  const run = () => { void preload().catch(() => {}); };
  // WKWebView on macOS has no requestIdleCallback.
  if (win.requestIdleCallback) {
    const handle = win.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = win.setTimeout(run, FALLBACK_DELAY_MS);
  return () => win.clearTimeout(handle);
}

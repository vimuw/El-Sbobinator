// The editor page and its rich text editor are lazy chunks. Warming them while the app is idle
// lets the first opened sbobina render at once instead of showing "Caricamento editor...".
type IdleWindow = Pick<Window, 'setTimeout' | 'clearTimeout'> & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const IDLE_TIMEOUT_MS = 4000;
const FALLBACK_DELAY_MS = 1500;

let preloadPromise: Promise<unknown> | null = null;

export function preloadEditorModules(): Promise<unknown> {
  preloadPromise ??= Promise.all([
    import('./components/EditorFullPage'),
    import('./components/RichTextEditor'),
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

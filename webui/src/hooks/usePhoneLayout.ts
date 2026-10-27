import { useCallback, useSyncExternalStore } from 'react';

// Same breakpoint as the phone rules in index.css (max-width: 640px): the editor drops the A4 page,
// the toolbar keeps one row and the player folds its secondary controls.
export const PHONE_LAYOUT_QUERY = '(max-width: 640px)';

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_LAYOUT_QUERY)
    : null;
}

/** True while the window is phone-sized; follows rotation and window resizes. */
export function usePhoneLayout(): boolean {
  const subscribe = useCallback((callback: () => void) => {
    const query = mediaQuery();
    if (!query) return () => {};
    query.addEventListener?.('change', callback);
    return () => query.removeEventListener?.('change', callback);
  }, []);
  return useSyncExternalStore(subscribe, () => mediaQuery()?.matches ?? false, () => false);
}

import { useEffect, useRef } from 'react';

// Focus usually stays in the editor while a menu is open, so the panel itself
// never sees Esc. Catch it first on window: Esc closes the open menu only, not
// the editor page that also listens for it.
export function useEscapeToClose(open: boolean, close: () => void) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      closeRef.current();
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open]);
}

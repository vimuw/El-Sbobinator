import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';

// Long enough for the .is-shaking card and .is-attention button animations in index.css.
export const BACKDROP_SHAKE_MS = 420;

interface BackdropDismissOptions {
  /** Unsaved edits: a click outside shakes the card instead of closing it. */
  dirty: boolean;
  onClose: () => void;
  /** While saving or exporting a click outside does nothing, as Esc does. */
  blocked?: boolean;
}

// A click on the dimmed page around a modal. With nothing to lose it closes the modal, like the X;
// with unsaved edits the card shakes, its primary action lights up and a line says why
// (`showHint`), so they are never dropped by a stray click. The line stays until the edits are
// saved, cancelled or undone: the shake alone is over before it can be read. The overlay is a
// sibling of the card, so a drag that starts in a field and ends outside it fires its click on
// their common parent, never on the overlay: selecting text in a field never closes the modal.
export function useBackdropDismiss({ dirty, onClose, blocked = false }: BackdropDismissOptions) {
  const [shaking, setShaking] = useState(false);
  const [hinted, setHinted] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // Back to nothing to lose (undone by hand), the line goes; a later edit starts over.
  useEffect(() => {
    if (!dirty) setHinted(false);
  }, [dirty]);

  const onBackdropClick = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget || blocked) return;
    if (!dirty) {
      onClose();
      return;
    }
    setHinted(true);
    // A second click during the shake would only restart it mid-way.
    if (timerRef.current) return;
    setShaking(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setShaking(false);
    }, BACKDROP_SHAKE_MS);
  }, [blocked, dirty, onClose]);

  return { onBackdropClick, shaking, showHint: hinted && dirty };
}

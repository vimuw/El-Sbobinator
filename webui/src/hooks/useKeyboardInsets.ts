import { useEffect, useState } from 'react';

export interface KeyboardInsets {
  /** How far Safari has scrolled the visible area down the page to show the caret. */
  top: number;
  /** Height of the page hidden under the on-screen keyboard. */
  bottom: number;
}

type VisualViewportLike = Pick<VisualViewport, 'height' | 'offsetTop' | 'scale'>;

const NONE: KeyboardInsets = { top: 0, bottom: 0 };
// Smaller differences come from browser bars showing and hiding, not from a keyboard.
const MIN_KEYBOARD_HEIGHT = 80;

/**
 * iPad Safari does not resize the page for the on-screen keyboard: a fixed full-screen layer keeps
 * its height and the keyboard covers its bottom (the editor's player and the last lines). The visual
 * viewport is what stays visible. While pinch-zoomed it is smaller for another reason: no insets.
 */
export function keyboardInsets(viewport: VisualViewportLike, layoutHeight: number): KeyboardInsets {
  if (Math.abs(viewport.scale - 1) > 0.01) return NONE;
  const top = Math.max(0, Math.round(viewport.offsetTop));
  const bottom = Math.max(0, Math.round(layoutHeight - viewport.height - viewport.offsetTop));
  return bottom < MIN_KEYBOARD_HEIGHT ? NONE : { top, bottom };
}

/** Insets of the on-screen keyboard, followed live; always zero when disabled or unsupported. */
export function useKeyboardInsets(enabled: boolean): KeyboardInsets {
  const [insets, setInsets] = useState<KeyboardInsets>(NONE);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!enabled || !viewport) return;
    const update = () => {
      const next = keyboardInsets(viewport, window.innerHeight);
      setInsets(prev => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      setInsets(NONE);
    };
  }, [enabled]);

  return insets;
}

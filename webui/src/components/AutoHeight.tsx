import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { animate } from 'motion/react';
import { DURATION, enterTransition } from '../motion';

type Animation = ReturnType<typeof animate>;

// Eases a slot's height toward its content's measured height, so content
// swapped inside it can crossfade in place while the page settles once below.
// At rest the slot is `auto`; while it eases it clips, and only then: tooltips and focus rings
// stay visible. Both start in the frame the content changes size, before the browser paints:
// a frame later, taller content would show whole over the page, then drop to the slot's old
// height and grow again.
//
// `followInnerResizes`: only a swap of the slot's own children (what an AnimatePresence inside
// it shows) is eased. Content that changes size by itself, often because it animates its own
// height, is followed as it goes: eased again, the slot would trail behind it.
// `onSettled` runs once the slot has reached its new height, when the page can scroll to it.
export function AutoHeight({ children, className, testId, onSettled, followInnerResizes = false }: {
  children: ReactNode;
  className?: string;
  testId?: string;
  onSettled?: () => void;
  followInnerResizes?: boolean;
}) {
  const slotRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onSettledRef = useRef(onSettled);
  useLayoutEffect(() => {
    onSettledRef.current = onSettled;
  });

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const content = contentRef.current;
    if (!slot || !content) return;
    let shown = content.offsetHeight;
    let running: Animation | null = null;
    // A swap lands as a child added or removed; the resize it causes is reported before the
    // next paint, so the mark is dropped two frames later.
    let swapped = false;
    const swaps = followInnerResizes
      ? new MutationObserver(() => {
        swapped = true;
        requestAnimationFrame(() => requestAnimationFrame(() => { swapped = false; }));
      })
      : null;
    swaps?.observe(content, { childList: true });

    const settle = () => {
      slot.style.height = '';
      slot.style.overflow = '';
      onSettledRef.current?.();
    };
    const resizes = new ResizeObserver(() => {
      const next = content.offsetHeight;
      // Mid-ease the slot starts from where it is; at rest it is `auto` and already at `next`.
      const from = running ? slot.offsetHeight : shown;
      shown = next;
      if (from === next) return;
      if (followInnerResizes && !swapped && !running) {
        onSettledRef.current?.();
        return;
      }
      running?.stop();
      slot.style.overflow = 'hidden';
      slot.style.height = `${from}px`;
      const animation = animate(slot, { height: [`${from}px`, `${next}px`] }, enterTransition(DURATION.slow));
      running = animation;
      void animation.finished.then(() => {
        if (running !== animation) return;
        running = null;
        settle();
      });
    });
    resizes.observe(content);
    return () => {
      resizes.disconnect();
      swaps?.disconnect();
      const last = running;
      running = null;
      last?.stop();
    };
  }, [followInnerResizes]);

  return (
    <div ref={slotRef} className={className} data-testid={testId}>
      <div ref={contentRef}>{children}</div>
    </div>
  );
}

import { useEffect, useState } from 'react';

function findScrollParent(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * True while a `position: sticky` element sits at its `top` offset inside its
 * scroll container, i.e. while content is scrolling behind it. Returns a
 * callback ref so a toolbar mounted after the first render is still tracked.
 */
export function useStickyStuck(): [(node: HTMLElement | null) => void, boolean] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!el) return;
    const scroller = findScrollParent(el);
    const target: HTMLElement | Window = scroller ?? window;
    let frame = 0;

    const measure = () => {
      frame = 0;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      const containerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const scrolled = scroller ? scroller.scrollTop > 0 : window.scrollY > 0;
      // Half a pixel of slack absorbs sub-pixel rounding at the pinned position.
      setStuck(scrolled && el.getBoundingClientRect().top - containerTop <= top + 0.5);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    target.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      target.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [el]);

  return [setEl, el !== null && stuck];
}

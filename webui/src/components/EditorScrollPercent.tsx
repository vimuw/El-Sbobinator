import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { scrollPillPath, type PillStop } from './editorScrollPillPath';

// How long the percentage stays beside the scrollbar once the scrolling stops; the audio dock,
// stepped aside meanwhile, comes back as it goes (index.css), so a short wait gives it back soon.
export const SCROLL_PERCENT_HIDE_MS = 600;

// Not in TypeScript's DOM library yet; Chromium (so WebView2) and Safari 26 have it.
declare const ScrollTimeline: {
  new (options: { source: Element; axis: 'block' }): AnimationTimeline;
} | undefined;

/** The pill's centre at one point of the scroll, read off its path. */
function pillCentreAt(path: PillStop[], fraction: number): number {
  const next = path.findIndex(stop => stop.offset >= fraction);
  if (next <= 0) return path[next === 0 ? 0 : path.length - 1].y;
  const a = path[next - 1];
  const b = path[next];
  return a.y + ((fraction - a.offset) / (b.offset - a.offset)) * (b.y - a.y);
}

const pillTransform = (y: number) => `translateY(${y}px) translateY(-50%)`;

/**
 * While the editor scrolls, a pill beside the scrollbar thumb says how far through the document
 * the view is, as Google Docs shows the page; it fades out once the scrolling stops.
 *
 * The thumb is drawn by the compositor in the same frame as the scroll; a pill moved from the
 * scroll event lands a frame later and trails it, then catches up, so it looked to shake. Where
 * the browser has scroll timelines the pill's path is an animation driven by the scroll itself,
 * moved in the thumb's own frame; the scroll event only writes the number and the geometry, and
 * rebuilds the path when the document or the room changes. Elsewhere it is placed per event.
 * Nothing here re-renders the editor, nor this component after the first scroll.
 */
export function EditorScrollPercent({ containerRef }: { containerRef: RefObject<HTMLDivElement | null> }) {
  // Mounted at the first scroll through a document longer than the view, then driven directly.
  const [active, setActive] = useState(false);
  const pillRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastScrollTop = container.scrollTop;
    let hideTimer: number | undefined;
    let animation: Animation | null = null;
    let animationKey = '';
    const timeline = typeof ScrollTimeline === 'function'
      ? new ScrollTimeline({ source: container, axis: 'block' })
      : null;

    const measure = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollbarWidth = container.offsetWidth - container.clientWidth;
      const path = scrollPillPath({ scrollHeight, clientHeight, scrollbarWidth });
      if (!path) return null;
      const fraction = Math.min(1, Math.max(0, scrollTop / (scrollHeight - clientHeight)));
      return { path, fraction, scrollbarWidth };
    };

    const place = (pill: HTMLDivElement): boolean => {
      const geometry = measure();
      if (!geometry) return false;
      const { path, fraction, scrollbarWidth } = geometry;
      pill.textContent = `${Math.round(fraction * 100)}%`;
      pill.style.top = `${container.offsetTop}px`;
      pill.style.right = `${scrollbarWidth + 6}px`;
      if (timeline) {
        const key = path.map(stop => `${stop.offset}:${stop.y}`).join(' ');
        if (key !== animationKey) {
          animation?.cancel();
          animation = pill.animate(
            path.map(stop => ({ offset: stop.offset, transform: pillTransform(stop.y) })),
            { timeline, fill: 'both', easing: 'linear' },
          );
          animationKey = key;
        }
      } else {
        // Whole pixels: a fractional top blurs the text and makes it shimmer while it moves.
        pill.style.transform = pillTransform(Math.round(pillCentreAt(path, fraction)));
      }
      return true;
    };

    const show = (pill: HTMLDivElement) => {
      if (!place(pill)) return;
      pill.dataset.visible = 'true';
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { pill.dataset.visible = 'false'; }, SCROLL_PERCENT_HIDE_MS);
    };

    // The scroll that mounted the pill shows it straight away.
    if (pillRef.current) show(pillRef.current);

    const handleScroll = () => {
      // A sideways scroll (zoomed page, open index) does not move through the document.
      if (container.scrollTop === lastScrollTop) return;
      lastScrollTop = container.scrollTop;
      const pill = pillRef.current;
      if (pill) show(pill);
      else if (measure()) setActive(true);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });

    // A window or dock resize moves the thumb's track while the pill may be fading out.
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { if (pillRef.current) place(pillRef.current); })
      : null;
    resizeObserver?.observe(container);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
      window.clearTimeout(hideTimer);
      animation?.cancel();
    };
  }, [containerRef, active]);

  if (!active) return null;
  return (
    <div
      ref={pillRef}
      className="editor-scroll-percent"
      data-testid="editor-scroll-percent"
      data-visible="false"
      aria-hidden="true"
    />
  );
}

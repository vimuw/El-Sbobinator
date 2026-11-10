import { useEffect, useRef, useState, type RefObject } from 'react';

// How long the percentage stays beside the scrollbar once the scrolling stops.
export const SCROLL_PERCENT_HIDE_MS = 1200;
// Chromium on Windows draws the thumb of a long document at this length (measured: 17px).
const MIN_THUMB = 17;
// About half the pill's height, which keeps it whole at the edges of the scroll area.
const HALF_HEIGHT = 10;

/**
 * Where the scrollbar thumb's centre is, from the top of the scroll area. Chromium on Windows
 * puts an arrow button as tall as the bar is wide at each end of the track; overlay scrollbars
 * (macOS, phones) take no width and have no arrows. Measured in Chromium against the drawn thumb.
 */
function scrollThumbCentre(
  { scrollTop, scrollHeight, clientHeight, scrollbarWidth }:
  { scrollTop: number; scrollHeight: number; clientHeight: number; scrollbarWidth: number },
): number | null {
  const range = scrollHeight - clientHeight;
  if (range <= 0) return null;
  const track = Math.max(0, clientHeight - 2 * scrollbarWidth);
  const thumb = Math.min(track, Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight));
  const fraction = Math.min(1, Math.max(0, scrollTop / range));
  return scrollbarWidth + fraction * (track - thumb) + thumb / 2;
}

/**
 * While the editor scrolls, a pill beside the scrollbar thumb says how far through the document
 * the view is; it fades out once the scrolling stops. It follows the thumb's exact position (not
 * the rounded percentage, which moved it in steps) and keeps one width, so only the number changes.
 * It listens to the scroll container itself, so scrolling never re-renders the editor.
 */
export function EditorScrollPercent({ containerRef, bottomInset = 0 }: {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The player floating over the bottom of the scroll area: the pill stays above it. */
  bottomInset?: number;
}) {
  const [position, setPosition] = useState<{ percent: number; top: number; right: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const bottomInsetRef = useRef(bottomInset);
  useEffect(() => { bottomInsetRef.current = bottomInset; }, [bottomInset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let lastScrollTop = container.scrollTop;
    let hideTimer: number | undefined;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // A sideways scroll (zoomed page, open index) does not move through the document.
      if (scrollTop === lastScrollTop) return;
      lastScrollTop = scrollTop;
      const scrollbarWidth = container.offsetWidth - container.clientWidth;
      const centre = scrollThumbCentre({ scrollTop, scrollHeight, clientHeight, scrollbarWidth });
      if (centre === null) return;
      const range = scrollHeight - clientHeight;
      const lowest = Math.max(HALF_HEIGHT, clientHeight - bottomInsetRef.current - HALF_HEIGHT);
      setPosition({
        percent: Math.round(Math.min(1, Math.max(0, scrollTop / range)) * 100),
        // Whole pixels: a fractional top blurs the text and makes it shimmer while it moves.
        top: Math.round(container.offsetTop + Math.min(Math.max(centre, HALF_HEIGHT), lowest)),
        right: scrollbarWidth,
      });
      setVisible(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setVisible(false), SCROLL_PERCENT_HIDE_MS);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.clearTimeout(hideTimer);
    };
  }, [containerRef]);

  if (!position) return null;
  return (
    <div
      className="editor-scroll-percent"
      data-testid="editor-scroll-percent"
      data-visible={visible}
      aria-hidden="true"
      style={{ top: position.top, right: position.right + 6 }}
    >
      {position.percent}%
    </div>
  );
}

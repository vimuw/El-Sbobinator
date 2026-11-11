// Geometry of the scroll pill (EditorScrollPercent), apart so it can be tested on its own.

// Chromium on Windows draws the thumb of a long document at this length (measured: 17px).
const MIN_THUMB = 17;
// About half the pill's height, which keeps it whole at the edges of the scroll area.
const HALF_HEIGHT = 10;
// Clear space from the scroll area's own edges. A phone's overlay thumb runs to the very bottom
// of the screen, and a pill there sat on the edge; 8px is the phone footer's own bottom padding,
// so the pill ends level with the folded dock it replaces while scrolling (the dock steps aside,
// index.css). Windows' arrows already keep it further in.
const EDGE = 8;

/** Where the pill's centre is, from the top of the scroll area, at each point of the scroll. */
export interface PillStop { offset: number; y: number }

/**
 * The pill's path down the scroll area: beside the scrollbar thumb's centre, held a little in
 * from both ends. The thumb moves linearly with the scroll, so the path
 * is a line cut flat where it would leave the room; the stops are its corners. Chromium on
 * Windows puts an arrow button as tall as the bar is wide at each end of the track; overlay
 * scrollbars (macOS, phones) take no width and have no arrows. Measured against the drawn thumb.
 */
export function scrollPillPath(
  { scrollHeight, clientHeight, scrollbarWidth }:
  { scrollHeight: number; clientHeight: number; scrollbarWidth: number },
): PillStop[] | null {
  if (scrollHeight - clientHeight <= 0) return null;
  const track = Math.max(0, clientHeight - 2 * scrollbarWidth);
  const thumb = Math.min(track, Math.max(MIN_THUMB, (track * clientHeight) / scrollHeight));
  const start = scrollbarWidth + thumb / 2;
  const end = scrollbarWidth + track - thumb / 2;
  const highest = EDGE + HALF_HEIGHT;
  const lowest = Math.max(highest, clientHeight - EDGE - HALF_HEIGHT);
  const at = (offset: number) => start + offset * (end - start);
  const offsets = new Set([0, 1]);
  if (end !== start) {
    for (const edge of [highest, lowest]) {
      const offset = (edge - start) / (end - start);
      if (offset > 0 && offset < 1) offsets.add(offset);
    }
  }
  return [...offsets].sort((a, b) => a - b).map(offset => ({
    offset,
    y: Math.min(Math.max(at(offset), highest), lowest),
  }));
}

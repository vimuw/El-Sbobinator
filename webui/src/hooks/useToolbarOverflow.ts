import { useCallback, useLayoutEffect, useState } from 'react';

/**
 * Watches a wrapping row of toolbar groups and marks, on each group, whether it fell below the
 * first line (`data-wrapped`) and whether it opens a line (`data-line-start`). Returns a callback
 * ref for the row and true while any group wraps, so the toolbar can fold those lines behind a
 * button like Google Docs.
 *
 * The marks are attributes, not state: a wrapped group keeps its place and size in the layout
 * (hidden with `visibility`), so measuring never changes what is measured.
 */
export function useToolbarOverflow(): [(row: HTMLElement | null) => void, boolean] {
  // The row is state, not a ref object: it mounts after the toolbar itself (no editor yet, or the
  // phone layout first) and is replaced when the layout changes, and the observer must follow it.
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [overflowing, setOverflowing] = useState(false);

  const measure = useCallback(() => {
    if (!row) return;
    const groups = Array.from(row.children) as HTMLElement[];
    const firstTop = groups[0]?.offsetTop ?? 0;
    let wraps = false;
    groups.forEach((group, index) => {
      const wrapped = group.offsetTop > firstTop + 1;
      group.toggleAttribute('data-wrapped', wrapped);
      group.toggleAttribute('data-line-start', index > 0 && group.offsetTop > groups[index - 1].offsetTop + 1);
      wraps ||= wrapped;
    });
    setOverflowing(wraps);
  }, [row]);

  // After every render: a new heading, font or size label can change a group's width.
  useLayoutEffect(measure);

  // Window resizes, rotation and the index opening change the room the row has.
  useLayoutEffect(() => {
    if (!row || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [row, measure]);

  return [setRow, overflowing];
}

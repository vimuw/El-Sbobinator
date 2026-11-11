import { useEffect, useState } from 'react';

// The .popover-closing animation in index.css: the CSS twin of popoverVariants.closed.
export const POPOVER_EXIT_MS = 120;

// Popovers that open with a CSS animation (dropdownPop, player-menu-in) instead of motion: once
// `value` turns falsy they stay mounted, with `closing` set, for the short exit animation, so
// they close as the motion menus do instead of vanishing. `shown` is the last truthy value, so a
// panel placed from it (the context menu's coordinates) keeps its place while it fades.
export function usePopoverPresence<T>(value: T | null | undefined | false) {
  const [last, setLast] = useState<T | null>(value || null);
  useEffect(() => {
    if (value) {
      setLast(value);
      return;
    }
    const timer = setTimeout(() => setLast(null), POPOVER_EXIT_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return { shown: value || last, closing: !value && last !== null };
}

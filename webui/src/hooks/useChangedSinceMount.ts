import { useState } from 'react';

/**
 * True once `value` has differed from its first value, and from then on. An icon that swaps on a
 * state (theme, play/pause) uses it to animate the swap in without animating its first render:
 * opening a page or any re-render with the same state leaves the icon as it is.
 */
export function useChangedSinceMount<T>(value: T): boolean {
  const [initial] = useState(value);
  const [changed, setChanged] = useState(false);
  const differs = !Object.is(value, initial);
  if (differs && !changed) setChanged(true);
  return changed || differs;
}

import type React from 'react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// The editor's audio dock folds into a round button that sits in a bottom corner, so it can leave
// the text alone. The player, the loading dock and the empty dock (no audio yet) share one fold,
// kept in one store, so the button stays in the same corner whichever of them the sbobina shows.
export type PillSide = 'left' | 'right';
export interface FoldState { collapsed: boolean; side: PillSide }
// The pill starts in the right corner, where a right thumb reaches it; while the editor scrolls
// it steps aside for the scroll pill that follows the scrollbar (index.css, editor-player-dock).
const FOLD_STORAGE_KEY = 'el-sbobinator.audio-player.v1';
const DEFAULT_FOLD: FoldState = { collapsed: false, side: 'right' };

function parseFoldState(raw: string | null): FoldState {
  try {
    const saved = JSON.parse(raw ?? '{}') as Partial<FoldState>;
    return { collapsed: saved.collapsed === true, side: saved.side === 'left' ? 'left' : 'right' };
  } catch {
    return DEFAULT_FOLD;
  }
}

const foldListeners = new Set<() => void>();
// Private windows may refuse storage: the fold then lives in memory until the page reloads.
let unsavedFold: FoldState | null = null;
let cachedRaw: string | null | undefined;
let cachedFold: FoldState = DEFAULT_FOLD;

function getFoldState(): FoldState {
  if (unsavedFold) return unsavedFold;
  let raw: string | null;
  try {
    raw = localStorage.getItem(FOLD_STORAGE_KEY);
  } catch {
    return DEFAULT_FOLD;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedFold = parseFoldState(raw);
  }
  return cachedFold;
}

function updateFoldState(change: Partial<FoldState>): void {
  const next = { ...getFoldState(), ...change };
  try {
    localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(next));
    unsavedFold = null;
  } catch {
    unsavedFold = next;
  }
  foldListeners.forEach(listener => listener());
}

function subscribeFold(listener: () => void): () => void {
  foldListeners.add(listener);
  return () => { foldListeners.delete(listener); };
}

/** Where the dock is folded, for the editor around it. */
export function useDockFoldState(): FoldState {
  return useSyncExternalStore(subscribeFold, getFoldState, getFoldState);
}

const SWIPE_MIN_PX = 40;
// Folding first wipes the bar into its corner (index.css, player-dock-close-*), then shows the pill.
// The wipe runs even with reduced motion: it is short, only follows the user's own fold, and
// skipping it on close alone made the two directions look different.
const FOLD_WIPE_MS = 280;
const DRAG_MIN_PX = 8;

/** `onFold` runs as the bar starts to fold, to close whatever menus it has open. */
export function useDockFold(onFold?: () => void) {
  const fold = useDockFoldState();
  const pillRef = useRef<HTMLButtonElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);
  const focusAfterFoldRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const pillDragRef = useRef<{ x: number; moved: boolean } | null>(null);
  const [pillOffset, setPillOffset] = useState(0);
  // Animate only a fold the user asked for, not the dock appearing with the editor.
  const [foldAnimated, setFoldAnimated] = useState(false);
  const [isFolding, setIsFolding] = useState(false);
  const foldTimerRef = useRef<number | null>(null);
  const onFoldRef = useRef(onFold);
  useEffect(() => { onFoldRef.current = onFold; }, [onFold]);
  useEffect(() => () => {
    if (foldTimerRef.current !== null) window.clearTimeout(foldTimerRef.current);
  }, []);

  const setCollapsed = useCallback((collapsed: boolean, moveFocus = true) => {
    if (foldTimerRef.current !== null) return;
    focusAfterFoldRef.current = moveFocus;
    setFoldAnimated(true);
    onFoldRef.current?.();
    const commit = () => updateFoldState({ collapsed });
    if (!collapsed) {
      commit();
      return;
    }
    setIsFolding(true);
    foldTimerRef.current = window.setTimeout(() => {
      foldTimerRef.current = null;
      setIsFolding(false);
      commit();
    }, FOLD_WIPE_MS);
  }, []);

  // Keyboard users land on the control that undoes the fold, not on the page body.
  useEffect(() => {
    if (!focusAfterFoldRef.current) return;
    focusAfterFoldRef.current = false;
    (fold.collapsed ? pillRef.current : collapseBtnRef.current)?.focus();
  }, [fold.collapsed]);

  const onTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // The scrubber and volume drag on their own; a swipe there is a seek, not a fold.
    if (e.touches.length !== 1 || target.closest('input')) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // Down, or sideways toward the pill's corner, folds the bar.
    const towardPill = fold.side === 'left' ? -dx : dx;
    const swipedDown = dy > SWIPE_MIN_PX && Math.abs(dx) < dy;
    const swipedToCorner = towardPill > SWIPE_MIN_PX && Math.abs(dy) < towardPill;
    if (swipedDown || swipedToCorner) setCollapsed(true, false);
  };

  // Dragging the pill sideways moves it to the other bottom corner; a plain tap opens the bar.
  const pillProps = {
    ref: pillRef,
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      pillDragRef.current = { x: e.clientX, moved: false };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = pillDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < DRAG_MIN_PX) return;
      drag.moved = true;
      setPillOffset(dx);
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = pillDragRef.current;
      if (!drag?.moved) return;
      const side: PillSide = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
      setPillOffset(0);
      updateFoldState({ side });
    },
    onPointerCancel: () => { pillDragRef.current = null; setPillOffset(0); },
    onClick: () => {
      const dragged = pillDragRef.current?.moved;
      pillDragRef.current = null;
      if (dragged) return;
      setCollapsed(false);
    },
    style: pillOffset ? { transform: `translateX(${pillOffset}px)` } : undefined,
  };

  // `.audio-player` carries the fold classes the dock's CSS keys on (index.css, editor-player-dock).
  const foldClassName = `audio-player${fold.collapsed ? ' is-collapsed' : ''}${foldAnimated ? ' did-fold' : ''}${isFolding ? ' is-folding' : ''}${fold.side === 'left' ? ' is-left' : ''}`;

  return { fold, setCollapsed, collapseBtnRef, pillProps, barTouchProps: { onTouchStart, onTouchEnd }, foldClassName };
}

import type { Transition } from 'motion/react';

// Shared motion vocabulary for the transcription workflow: few durations, one
// decelerating curve for entrances and one accelerating curve for exits. Things
// fade and settle in place; they never slide across the page or overshoot.
export const DURATION = { fast: 0.12, base: 0.2, slow: 0.32 } as const;

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const enterTransition = (duration: number = DURATION.base, delay = 0): Transition => ({ duration, ease: EASE_OUT, delay });
export const exitTransition: Transition = { duration: DURATION.fast, ease: EASE_IN };

export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enterTransition() },
  exit: { opacity: 0, transition: exitTransition },
};

export const fadeUp = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0, transition: enterTransition() },
  exit: { opacity: 0, transition: exitTransition },
};

// A panel that opens downward at the foot of the page (the console): it fades in while its slot
// grows, and on leaving it folds back up, its height closing from the bottom as it fades, instead
// of vanishing in place. It folds to the height of what takes its place, given as the presence's
// `custom` (0 when nothing does), so that comes back with a fade alone and closing lasts as long
// as opening. Fold and fade end together, on the opening's curve, as the logs expand and collapse
// on one: it moves from the first frame and settles. On an ease-in-out it stood still for about
// 100 ms after the click, then collapsed in a few frames. The element must clip its content for
// the fold to show.
// Brought back mid-fold, the same element re-enters: `open` names its height so it returns to
// `auto` and grows with its content, rather than to the px read as the fold began.
export const unfold = {
  initial: 'hidden',
  animate: 'open',
  exit: 'folded',
  variants: {
    hidden: { opacity: 0, y: 4 },
    open: { opacity: 1, y: 0, height: 'auto', transition: enterTransition() },
    folded: (foldTo: number = 0) => ({
      opacity: 0,
      height: foldTo,
      transition: enterTransition(DURATION.slow),
    }),
  },
};

// What a closing panel gives way to: it was the first to leave on opening, so it fades as briefly
// on the way back.
export const quickFade = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: enterTransition(DURATION.fast) },
  exit: { opacity: 0, transition: exitTransition },
};

// Children of a stagger container reveal one after another without moving.
export const STAGGER_STEP = 0.04;

export const staggerContainer = {
  initial: 'hidden',
  animate: 'visible',
  variants: { hidden: {}, visible: { transition: { staggerChildren: STAGGER_STEP } } },
};

export const staggerItem = {
  variants: {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: enterTransition() },
  },
};

// Panels that open from a trigger (menus, the notification popover) materialise in place: they
// grow from slightly further back out of a soft blur, with no overshoot, and close short and flat.
// The open scale and blur are keyframe pairs so the quick close need not travel as far, and the
// filter is dropped once settled so text renders crisp. `x`/`y` nudge from the trigger's side.
export interface PopoverMotion {
  x?: number;
  y?: number;
  scale?: number;
  blur?: number;
  duration?: number;
}

export const popoverVariants = ({ x = 0, y = 0, scale = 0.94, blur = 4, duration = DURATION.base }: PopoverMotion = {}) => ({
  closed: { opacity: 0, x, y, scale: 0.97, filter: 'blur(2px)', transition: exitTransition },
  open: {
    opacity: 1,
    x: 0,
    y: 0,
    scale: [scale, 1],
    filter: [`blur(${blur}px)`, 'blur(0px)'],
    transition: { duration, ease: EASE_OUT, opacity: { duration: duration * 0.6, ease: EASE_OUT } },
    transitionEnd: { filter: 'none' },
  },
});

// A popover's contents follow its frame one beat at a time; `custom` is the beat index. Long
// lists share the last beat so they don't trail in. Contents reset only once the frame has
// faded, so closing never shows them leaving.
export const popoverItemVariants = ({ x = 0, y = 0, blur = 0, step = STAGGER_STEP, maxBeat = 8 } = {}) => ({
  closed: {
    opacity: 0,
    x,
    y,
    filter: `blur(${blur}px)`,
    transition: { delay: DURATION.fast, duration: 0 },
  },
  open: (beat: number) => ({
    opacity: 1,
    x: 0,
    y: 0,
    filter: 'blur(0px)',
    transition: enterTransition(DURATION.base, 0.04 + Math.min(beat, maxBeat) * step),
    transitionEnd: { filter: 'none' },
  }),
});

// Modal cards use the popover entrance at its lightest: they are large surfaces centred on a
// dimmed page, so a short travel and a faint blur read as depth without drawing attention.
export const modalCard = {
  initial: { opacity: 0, scale: 0.96, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    scale: 1,
    filter: 'blur(0px)',
    transition: enterTransition(DURATION.base),
    transitionEnd: { filter: 'none' },
  },
  exit: { opacity: 0, scale: 0.98, filter: 'blur(2px)', transition: exitTransition },
};

// The same entrance without the blur, for a card that covers most of the window (Impostazioni):
// half-faded and blurred at that size, it read as a smudge over the sharp page behind it.
export const largeModalCard = {
  initial: { opacity: 0, scale: 0.98 },
  animate: { opacity: 1, scale: 1, transition: enterTransition(DURATION.base) },
  exit: { opacity: 0, scale: 0.99, transition: exitTransition },
};

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

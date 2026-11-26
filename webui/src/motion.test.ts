import { describe, expect, it } from 'vitest';
import { DURATION, EASE_OUT, enterTransition, largeModalCard, modalCard, unfold } from './motion';

describe('console fold', () => {
  it('closes on the curve the console opens on, moving from the first frame', () => {
    // On an ease-in-out the console stood still for about 100 ms after "Chiudi console", then
    // collapsed in a few frames: a jerk next to the opening, which eases out.
    const { transition } = unfold.variants.folded(0);
    expect(transition).toEqual(enterTransition(DURATION.slow));
    expect(transition.ease).toBe(EASE_OUT);
    expect(unfold.variants.open.transition.ease).toBe(EASE_OUT);
  });
});

describe('modal entrances', () => {
  it('opens a window-sized card (Impostazioni) without the blur of the small modals', () => {
    for (const state of [largeModalCard.initial, largeModalCard.animate, largeModalCard.exit]) {
      expect(state).not.toHaveProperty('filter');
    }
    expect(modalCard.initial).toHaveProperty('filter');
    expect(largeModalCard.initial.opacity).toBe(0);
    expect(largeModalCard.animate.opacity).toBe(1);
  });
});

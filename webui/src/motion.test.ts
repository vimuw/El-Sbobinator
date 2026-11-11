import { describe, expect, it } from 'vitest';
import { largeModalCard, modalCard } from './motion';

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

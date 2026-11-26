import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChangedSinceMount } from './useChangedSinceMount';

describe('useChangedSinceMount', () => {
  it('stays false while the value keeps its first value, across re-renders', () => {
    const { result, rerender } = renderHook(({ value }) => useChangedSinceMount(value), { initialProps: { value: false } });
    expect(result.current).toBe(false);
    rerender({ value: false });
    expect(result.current).toBe(false);
  });

  it('turns true on the first change and stays true when the value comes back', () => {
    const { result, rerender } = renderHook(({ value }) => useChangedSinceMount(value), { initialProps: { value: 'light' } });
    rerender({ value: 'dark' });
    expect(result.current).toBe(true);
    // Back to the first theme: that icon is swapped in too, so it animates as well.
    rerender({ value: 'light' });
    expect(result.current).toBe(true);
  });
});

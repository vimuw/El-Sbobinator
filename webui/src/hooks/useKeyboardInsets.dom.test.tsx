import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keyboardInsets, useKeyboardInsets } from './useKeyboardInsets';

/** A visual viewport that can be moved like iPad Safari's when the keyboard opens. */
function fakeVisualViewport(height: number) {
  const viewport = Object.assign(new EventTarget(), { height, offsetTop: 0, scale: 1, width: 820 });
  vi.stubGlobal('visualViewport', viewport);
  return {
    viewport,
    move(next: Partial<{ height: number; offsetTop: number; scale: number }>) {
      Object.assign(viewport, next);
      viewport.dispatchEvent(new Event('resize'));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('keyboardInsets', () => {
  it('measures the keyboard below the visible area and how far Safari scrolled', () => {
    expect(keyboardInsets({ height: 780, offsetTop: 0, scale: 1 }, 1180)).toEqual({ top: 0, bottom: 400 });
    expect(keyboardInsets({ height: 780, offsetTop: 120, scale: 1 }, 1180)).toEqual({ top: 120, bottom: 280 });
  });

  it('ignores browser bars and pinch zoom', () => {
    expect(keyboardInsets({ height: 1130, offsetTop: 0, scale: 1 }, 1180)).toEqual({ top: 0, bottom: 0 });
    expect(keyboardInsets({ height: 590, offsetTop: 200, scale: 2 }, 1180)).toEqual({ top: 0, bottom: 0 });
  });
});

describe('useKeyboardInsets', () => {
  it('follows the visual viewport while enabled', () => {
    vi.stubGlobal('innerHeight', 1180);
    const { move } = fakeVisualViewport(1180);
    const { result, rerender } = renderHook(({ enabled }) => useKeyboardInsets(enabled), { initialProps: { enabled: true } });
    expect(result.current).toEqual({ top: 0, bottom: 0 });

    act(() => move({ height: 780 }));
    expect(result.current).toEqual({ top: 0, bottom: 400 });

    rerender({ enabled: false });
    expect(result.current).toEqual({ top: 0, bottom: 0 });
    act(() => move({ height: 700 }));
    expect(result.current).toEqual({ top: 0, bottom: 0 });
  });

  it('stays at zero without a visual viewport', () => {
    vi.stubGlobal('visualViewport', undefined);
    const { result } = renderHook(() => useKeyboardInsets(true));
    expect(result.current).toEqual({ top: 0, bottom: 0 });
  });
});

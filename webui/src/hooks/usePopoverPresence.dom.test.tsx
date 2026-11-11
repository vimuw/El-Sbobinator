import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { POPOVER_EXIT_MS, usePopoverPresence } from './usePopoverPresence';

afterEach(() => {
  vi.useRealTimers();
});

describe('usePopoverPresence', () => {
  it('shows an open popover at once and nothing while closed', () => {
    const { result, rerender } = renderHook(({ open }) => usePopoverPresence(open), { initialProps: { open: false } });
    expect(result.current).toEqual({ shown: null, closing: false });
    rerender({ open: true });
    expect(result.current).toEqual({ shown: true, closing: false });
  });

  it('keeps a closed popover for its exit, then lets it go', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePopoverPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    expect(result.current).toEqual({ shown: true, closing: true });
    act(() => { vi.advanceTimersByTime(POPOVER_EXIT_MS - 1); });
    expect(result.current.closing).toBe(true);
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toEqual({ shown: null, closing: false });
  });

  it('opened again during the exit, stays open', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePopoverPresence(open), { initialProps: { open: true } });
    rerender({ open: false });
    act(() => { vi.advanceTimersByTime(POPOVER_EXIT_MS / 2); });
    rerender({ open: true });
    act(() => { vi.advanceTimersByTime(POPOVER_EXIT_MS); });
    expect(result.current).toEqual({ shown: true, closing: false });
  });

  it('keeps the last value while closing, so a placed panel fades where it stood', () => {
    vi.useFakeTimers();
    const at = { x: 40, y: 80 };
    const { result, rerender } = renderHook(({ menu }) => usePopoverPresence(menu), {
      initialProps: { menu: at as { x: number; y: number } | null },
    });
    rerender({ menu: null });
    expect(result.current).toEqual({ shown: at, closing: true });
  });
});

// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiReady } from './useApiReady';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setPywebview(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  setPywebview(undefined);
});

describe('useApiReady — bootstrap guard', () => {
  it('5-second timeout does not set apiReady when bridge is absent', async () => {
    const { result } = renderHook(() => useApiReady(vi.fn()));

    expect(result.current.apiReady).toBe(false);
    expect(result.current.bridgeDelayed).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });

    expect(result.current.apiReady).toBe(false);
    expect(result.current.bridgeDelayed).toBe(true);
  });

  it('pywebviewready after timeout still hydrates when bridge arrives late', async () => {
    const appendConsole = vi.fn();
    const mockLoad = vi.fn().mockResolvedValue({
      api_key: 'late-key',
      preferred_model: 'gemini-2.5-flash',
    });

    const { result } = renderHook(() => useApiReady(appendConsole));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });
    expect(result.current.apiReady).toBe(false);
    expect(result.current.bridgeDelayed).toBe(true);

    setPywebview({ load_settings: mockLoad });

    await act(async () => {
      window.dispatchEvent(new Event('pywebviewready'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.apiReady).toBe(true);
    expect(result.current.bridgeDelayed).toBe(false);
    expect(result.current.apiKey).toBe('late-key');
    expect(result.current.preferredModel).toBe('gemini-2.5-flash');
    expect(appendConsole).toHaveBeenCalledWith('Connesso a Python.');
  });

  it('load_settings failure does not latch and allows retry on next pywebviewready', async () => {
    let call = 0;
    const mockLoad = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve({ api_key: 'retry-key' });
    });
    setPywebview({ load_settings: mockLoad });

    const { result } = renderHook(() => useApiReady(vi.fn()));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.apiReady).toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event('pywebviewready'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.apiReady).toBe(true);
    expect(result.current.apiKey).toBe('retry-key');
  });

  it('success log is emitted exactly once, only after successful hydration', async () => {
    const appendConsole = vi.fn();
    const mockLoad = vi.fn().mockResolvedValue({ api_key: 'key' });
    setPywebview({ load_settings: mockLoad });

    const { result } = renderHook(() => useApiReady(appendConsole));

    expect(appendConsole).not.toHaveBeenCalled();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.apiReady).toBe(true);
    expect(appendConsole).toHaveBeenCalledTimes(1);
    expect(appendConsole).toHaveBeenCalledWith('Connesso a Python.');
  });
});

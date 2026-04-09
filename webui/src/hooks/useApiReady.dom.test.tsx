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

  it('catch-triggered 2s retry recovers without pywebviewready', async () => {
    let call = 0;
    const mockLoad = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.reject(new Error('transient'));
      return Promise.resolve({ api_key: 'recovered-key' });
    });
    setPywebview({ load_settings: mockLoad });

    const { result } = renderHook(() => useApiReady(vi.fn()));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.apiReady).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2001);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.apiReady).toBe(true);
    expect(result.current.apiKey).toBe('recovered-key');
  });

  it('catch-retries are bounded: no new timer scheduled after retriesRef reaches 3', async () => {
    const mockLoad = vi.fn().mockRejectedValue(new Error('always fails'));
    setPywebview({ load_settings: mockLoad });

    const { result } = renderHook(() => useApiReady(vi.fn()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });

    expect(result.current.apiReady).toBe(false);
    expect(result.current.bridgeDelayed).toBe(true);
    const callsAt7s = mockLoad.mock.calls.length;
    // initial (t=0) + retry_B (t=2s) + retry_C (t=4s) + delayedWarning (t=5s) = 4;
    // delayedWarning cancels retry_D (scheduled by retry_C's catch, would fire at t=6s)
    expect(callsAt7s).toBeLessThanOrEqual(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockLoad.mock.calls.length).toBe(callsAt7s);
  });

  it('bridgeDelayed is set at 5s even when a call is in-flight at that moment', async () => {
    let resolve!: (value: unknown) => void;
    const mockLoad = vi.fn().mockImplementation(
      () => new Promise(res => { resolve = res; }),
    );
    setPywebview({ load_settings: mockLoad });

    const { result } = renderHook(() => useApiReady(vi.fn()));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5001);
    });

    expect(result.current.apiReady).toBe(false);
    expect(result.current.bridgeDelayed).toBe(true);

    await act(async () => {
      resolve({ api_key: 'slow-key' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.apiReady).toBe(true);
    expect(result.current.bridgeDelayed).toBe(false);
    expect(result.current.apiKey).toBe('slow-key');
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

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStorage } from './useSettingsStorage';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

const info = { ok: true, total_bytes: 2048, total_sessions: 5, session_root: 'Memoria di questo browser', persisted: false };

describe('useSettingsStorage', () => {
  beforeEach(() => {
    setPywebview(undefined);
  });

  afterEach(() => {
    setPywebview(undefined);
  });

  it('initializes with default states', () => {
    const { result } = renderHook(() => useSettingsStorage({ isOpen: false, activeTab: 'general' }));

    expect(result.current.sessionInfo).toBeNull();
    expect(result.current.isLoadingSessionInfo).toBe(false);
  });

  it('reads the space when the settings open on Archiviazione', async () => {
    const getStorageInfo = vi.fn().mockResolvedValue(info);
    setPywebview({ get_session_storage_info: getStorageInfo });

    const { result } = renderHook(() => useSettingsStorage({ isOpen: true, activeTab: 'storage' }));
    await act(async () => {});

    expect(getStorageInfo).toHaveBeenCalledTimes(1);
    expect(result.current.sessionInfo).toEqual({
      total_bytes: 2048,
      total_sessions: 5,
      session_root: 'Memoria di questo browser',
      persisted: false,
    });
    expect(result.current.isLoadingSessionInfo).toBe(false);
  });

  it('keeps the figures in view during a quiet refresh and joins a reading in flight', async () => {
    let resolveSecond!: (value: typeof info) => void;
    const getStorageInfo = vi.fn()
      .mockResolvedValueOnce(info)
      .mockImplementationOnce(() => new Promise(resolve => { resolveSecond = resolve; }));
    setPywebview({ get_session_storage_info: getStorageInfo });

    const { result } = renderHook(() => useSettingsStorage({ isOpen: true, activeTab: 'general' }));
    await act(async () => { result.current.fetchSessionStorageInfo(); });
    expect(result.current.sessionInfo?.total_sessions).toBe(5);

    act(() => { result.current.fetchSessionStorageInfo({ quiet: true }); });
    expect(result.current.sessionInfo?.total_sessions).toBe(5);
    expect(result.current.isLoadingSessionInfo).toBe(false);
    // Opening the tab meanwhile waits for the same reading.
    act(() => { result.current.fetchSessionStorageInfo({ reuse: true }); });
    expect(getStorageInfo).toHaveBeenCalledTimes(2);

    await act(async () => { resolveSecond({ ...info, total_sessions: 6 }); });
    expect(result.current.sessionInfo?.total_sessions).toBe(6);
  });
});

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, setHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';
import { WEB_STORAGE_NOTICE_TITLE, useWebStorageNotice } from './useWebStorageNotice';

function installApi(persisted: boolean) {
  const check = vi.fn(async () => ({ ok: true, persisted }));
  window.pywebview = { api: { get_storage_protection: check } as never };
  return check;
}

beforeEach(() => {
  localStorage.clear();
  setHostCapabilities({ kind: 'web' });
});

afterEach(() => {
  setHostCapabilities(DESKTOP_CAPABILITIES);
  delete window.pywebview;
});

describe('useWebStorageNotice', () => {
  it('waits for the first sbobina, then warns once when the browser may clear the data', async () => {
    const check = installApi(false);
    const addNotification = vi.fn();
    const { rerender } = renderHook(props => useWebStorageNotice(props), { initialProps: { apiReady: true, sessionCount: 0, addNotification } });
    expect(check).not.toHaveBeenCalled();

    rerender({ apiReady: true, sessionCount: 1, addNotification });
    await waitFor(() => expect(addNotification).toHaveBeenCalledTimes(1));
    expect(addNotification).toHaveBeenCalledWith(WEB_STORAGE_NOTICE_TITLE, expect.stringContaining('Impostazioni → Archiviazione'), 'warning', 'system', {
      dedupeKey: 'web-storage-notice', actionType: 'open_settings',
    });
    expect(localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_NOTICE_V1)).not.toBeNull();

    // Another sbobina, or the next visit: no second notice.
    rerender({ apiReady: true, sessionCount: 2, addNotification });
    renderHook(() => useWebStorageNotice({ apiReady: true, sessionCount: 2, addNotification }));
    await Promise.resolve();
    expect(check).toHaveBeenCalledTimes(1);
    expect(addNotification).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the browser promised to keep the data', async () => {
    const check = installApi(true);
    const addNotification = vi.fn();
    renderHook(() => useWebStorageNotice({ apiReady: true, sessionCount: 1, addNotification }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_NOTICE_V1)).not.toBeNull());
    expect(addNotification).not.toHaveBeenCalled();
  });

  it('never runs on the desktop app', async () => {
    setHostCapabilities(DESKTOP_CAPABILITIES);
    const check = installApi(false);
    renderHook(() => useWebStorageNotice({ apiReady: true, sessionCount: 3, addNotification: vi.fn() }));
    await Promise.resolve();
    expect(check).not.toHaveBeenCalled();
  });
});

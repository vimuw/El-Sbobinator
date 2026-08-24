import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystemNotificationTriggers } from './useSystemNotificationTriggers';

describe('useSystemNotificationTriggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('triggers notification when config was recovered from backup', () => {
    const addNotification = vi.fn();
    const removeNotificationByDedupeKey = vi.fn();
    const setIsPeakDismissed = vi.fn();

    renderHook(() =>
      useSystemNotificationTriggers({
        configRecoveredFrom: 'C:/Users/User/.el_sbobinator/config.json.corrupt',
        updateAvailable: null,
        addNotification,
        removeNotificationByDedupeKey,
        isPeakDismissed: false,
        setIsPeakDismissed,
      }),
    );

    expect(addNotification).toHaveBeenCalledWith(
      'Configurazione ripristinata',
      expect.stringContaining('Il file di configurazione era corrotto'),
      'warning',
      'system',
      expect.objectContaining({
        persistent: true,
      }),
    );
  });

  it('triggers notification when update is available', () => {
    const addNotification = vi.fn();
    const removeNotificationByDedupeKey = vi.fn();
    const setIsPeakDismissed = vi.fn();

    renderHook(() =>
      useSystemNotificationTriggers({
        configRecoveredFrom: '',
        updateAvailable: 'v2.1.0',
        addNotification,
        removeNotificationByDedupeKey,
        isPeakDismissed: false,
        setIsPeakDismissed,
      }),
    );

    expect(addNotification).toHaveBeenCalledWith(
      'Aggiornamento disponibile',
      'Nuova versione disponibile: v2.1.0',
      'info',
      'update',
      expect.objectContaining({
        persistent: true,
        dedupeKey: 'update-available',
      }),
    );
  });
});

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

    renderHook(() =>
      useSystemNotificationTriggers({
        configRecoveredFrom: 'C:/Users/User/.el_sbobinator/config.json.corrupt',
        addNotification,
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

});

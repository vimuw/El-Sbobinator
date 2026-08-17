// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_RELEASES_URL } from '../branding';
import {
  NOTIFICATIONS_STORAGE_KEY,
  useNotifications,
  type PersistedNotification,
} from './useNotifications';

describe('useNotifications', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('Persistence & Initial Load', () => {
    it('initializes with an empty array when localStorage is empty', () => {
      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications).toEqual([]);
      expect(result.current.notifications).toEqual([]);
      expect(result.current.unreadNotificationsCount).toBe(0);
    });

    it('loads existing notifications from localStorage on init', () => {
      const existing: PersistedNotification[] = [
        {
          id: 'notif-1',
          title: 'Titolo 1',
          message: 'Messaggio 1',
          type: 'info',
          category: 'system',
          timestamp: 1000,
          read: false,
        },
        {
          id: 'notif-2',
          title: 'Titolo 2',
          message: 'Messaggio 2',
          type: 'warning',
          category: 'processing',
          timestamp: 2000,
          read: true,
        },
      ];
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(existing));

      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications).toHaveLength(2);
      expect(result.current.rawNotifications[0].id).toBe('notif-1');
      expect(result.current.unreadNotificationsCount).toBe(1);
    });

    it('gracefully handles corrupt JSON in localStorage', () => {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, '{invalid json');
      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications).toEqual([]);
      expect(result.current.notifications).toEqual([]);
    });

    it('persists notifications to localStorage when added and updated', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Test', 'Messaggio di prova', 'info', 'system');
      });

      const stored = JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) || '[]');
      expect(stored).toHaveLength(1);
      expect(stored[0].title).toBe('Test');
      expect(stored[0].message).toBe('Messaggio di prova');
      expect(stored[0].read).toBe(false);
    });
  });

  describe('addNotification & Deduplication', () => {
    it('adds a notification with default type and category', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Nuova notifica', 'Dettagli');
      });

      expect(result.current.rawNotifications).toHaveLength(1);
      const notif = result.current.rawNotifications[0];
      expect(notif.title).toBe('Nuova notifica');
      expect(notif.message).toBe('Dettagli');
      expect(notif.type).toBe('info');
      expect(notif.category).toBe('system');
      expect(notif.read).toBe(false);
      expect(typeof notif.id).toBe('string');
      expect(typeof notif.timestamp).toBe('number');
    });

    it('adds a notification with custom options and actionData', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Errore', 'Errore grave', 'error', 'processing', {
          persistent: true,
          dedupeKey: 'custom-error',
          actionType: 'retry_failed_revision_blocks',
          actionData: { sessionDir: '/sessions/1', fileId: 'file-1' },
        });
      });

      expect(result.current.rawNotifications).toHaveLength(1);
      const notif = result.current.rawNotifications[0];
      expect(notif.type).toBe('error');
      expect(notif.category).toBe('processing');
      expect(notif.persistent).toBe(true);
      expect(notif.dedupeKey).toBe('custom-error');
      expect(notif.actionType).toBe('retry_failed_revision_blocks');
      expect(notif.actionData).toEqual({ sessionDir: '/sessions/1', fileId: 'file-1' });
    });

    it('ignores duplicate notification if dedupeKey already exists', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Primo', 'Msg 1', 'warning', 'system', { dedupeKey: 'dup-1' });
      });
      act(() => {
        result.current.addNotification('Secondo', 'Msg 2', 'warning', 'system', { dedupeKey: 'dup-1' });
      });

      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].title).toBe('Primo');
    });

    it('caps notifications at 50 entries', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        for (let i = 0; i < 60; i++) {
          result.current.addNotification(`Notifica ${i}`, `Messaggio ${i}`);
        }
      });

      expect(result.current.rawNotifications).toHaveLength(50);
      expect(result.current.rawNotifications[0].title).toBe('Notifica 59');
    });
  });

  describe('upsertNotification', () => {
    it('creates a new notification if dedupeKey does not exist and returns new ID', () => {
      const { result } = renderHook(() => useNotifications());

      let createdId = '';
      act(() => {
        createdId = result.current.upsertNotification('Download', 'Inizio download', 'info', 'update', {
          dedupeKey: 'update-dl',
        });
      });

      expect(createdId).toBeTruthy();
      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].id).toBe(createdId);
      expect(result.current.rawNotifications[0].message).toBe('Inizio download');
    });

    it('updates an existing notification in-place when matching dedupeKey and returns the same ID', () => {
      const { result } = renderHook(() => useNotifications());

      let firstId = '';
      act(() => {
        firstId = result.current.upsertNotification('Download', '50%', 'info', 'update', {
          dedupeKey: 'update-dl',
        });
      });

      let secondId = '';
      act(() => {
        secondId = result.current.upsertNotification('Download', '100%', 'success', 'update', {
          dedupeKey: 'update-dl',
        });
      });

      expect(secondId).toBe(firstId);
      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].id).toBe(firstId);
      expect(result.current.rawNotifications[0].message).toBe('100%');
      expect(result.current.rawNotifications[0].type).toBe('success');
    });
  });

  describe('deleteNotification & Special Dismissal Triggers', () => {
    it('removes the notification by id', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Notifica 1', 'Msg 1');
        result.current.addNotification('Notifica 2', 'Msg 2');
      });

      const idToDelete = result.current.rawNotifications[0].id;
      act(() => {
        result.current.deleteNotification(idToDelete);
      });

      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].id).not.toBe(idToDelete);
    });

    it('sets config-recovery dismissal localStorage flag on delete', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Config', 'Ripristinata', 'warning', 'system', {
          dedupeKey: 'config-recovery:C:/test/path/config.json',
        });
      });

      const notifId = result.current.rawNotifications[0].id;
      act(() => {
        result.current.deleteNotification(notifId);
      });

      expect(localStorage.getItem('el-sbobinator.config-recovery-dismissed.v1:C:/test/path/config.json')).toBe('1');
    });

    it('sets peak-hour warning dismissal localStorage and calls setIsPeakDismissed on delete', () => {
      const setIsPeakDismissed = vi.fn();
      const { result } = renderHook(() => useNotifications({ setIsPeakDismissed }));

      act(() => {
        result.current.addNotification('Picco', 'Orario di punta', 'warning', 'system', {
          dedupeKey: 'peak-hour-warning',
        });
      });

      const notifId = result.current.rawNotifications[0].id;
      act(() => {
        result.current.deleteNotification(notifId);
      });

      expect(setIsPeakDismissed).toHaveBeenCalledWith(true);
      expect(localStorage.getItem('peakBannerDismissedUntil')).toBeTruthy();
    });

    it('calls onDismissUpdate when deleting update-available notification', () => {
      const onDismissUpdate = vi.fn();
      const { result } = renderHook(() => useNotifications({ onDismissUpdate }));

      act(() => {
        result.current.addNotification('Aggiornamento', 'Nuova versione', 'info', 'update', {
          dedupeKey: 'update-available',
          actionData: { version: 'v2.5.0' },
        });
      });

      const notifId = result.current.rawNotifications[0].id;
      act(() => {
        result.current.deleteNotification(notifId);
      });

      expect(onDismissUpdate).toHaveBeenCalledWith('v2.5.0');
    });
  });

  describe('clearAllNotifications', () => {
    it('clears all notifications and runs dismissal side effects for all items', () => {
      const setIsPeakDismissed = vi.fn();
      const onDismissUpdate = vi.fn();
      const { result } = renderHook(() => useNotifications({ setIsPeakDismissed, onDismissUpdate }));

      act(() => {
        result.current.addNotification('Normal', 'Msg');
        result.current.addNotification('Config', 'Msg', 'warning', 'system', {
          dedupeKey: 'config-recovery:C:/path/config.json',
        });
        result.current.addNotification('Peak', 'Msg', 'warning', 'system', {
          dedupeKey: 'peak-hour-warning',
        });
        result.current.addNotification('Update', 'Msg', 'info', 'update', {
          dedupeKey: 'update-available',
          actionData: { version: 'v3.0.0' },
        });
      });

      expect(result.current.rawNotifications).toHaveLength(4);

      act(() => {
        result.current.clearAllNotifications();
      });

      expect(result.current.rawNotifications).toHaveLength(0);
      expect(result.current.unreadNotificationsCount).toBe(0);
      expect(localStorage.getItem('el-sbobinator.config-recovery-dismissed.v1:C:/path/config.json')).toBe('1');
      expect(setIsPeakDismissed).toHaveBeenCalledWith(true);
      expect(onDismissUpdate).toHaveBeenCalledWith('v3.0.0');
    });
  });

  describe('removeNotificationByDedupeKey', () => {
    it('removes only notifications matching the specified dedupeKey', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('N1', 'M1', 'info', 'system', { dedupeKey: 'k1' });
        result.current.addNotification('N2', 'M2', 'info', 'system', { dedupeKey: 'k2' });
      });

      act(() => {
        result.current.removeNotificationByDedupeKey('k1');
      });

      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].dedupeKey).toBe('k2');
    });
  });

  describe('Read Status & Unread Count & shakeBell', () => {
    it('markNotificationAsRead marks an item as read', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('N1', 'M1');
      });

      expect(result.current.unreadNotificationsCount).toBe(1);
      const id = result.current.rawNotifications[0].id;

      act(() => {
        result.current.markNotificationAsRead(id);
      });

      expect(result.current.rawNotifications[0].read).toBe(true);
      expect(result.current.unreadNotificationsCount).toBe(0);
    });

    it('markAllNotificationsAsRead marks all items as read', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('N1', 'M1');
        result.current.addNotification('N2', 'M2');
      });

      expect(result.current.unreadNotificationsCount).toBe(2);

      act(() => {
        result.current.markAllNotificationsAsRead();
      });

      expect(result.current.rawNotifications.every(n => n.read)).toBe(true);
      expect(result.current.unreadNotificationsCount).toBe(0);
    });

    it('triggers shakeBell when unread notifications count increases', () => {
      const { result } = renderHook(() => useNotifications());

      expect(result.current.shakeBell).toBe(false);

      act(() => {
        result.current.addNotification('N1', 'M1');
      });

      expect(result.current.shakeBell).toBe(true);

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(result.current.shakeBell).toBe(false);
    });
  });

  describe('Action Binding', () => {
    it('binds retry_failed_revision_blocks action and executes callback', async () => {
      const onRetryFailedRevisionBlocks = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useNotifications({ onRetryFailedRevisionBlocks }));

      act(() => {
        result.current.addNotification('Retry', 'Blocchi falliti', 'warning', 'processing', {
          actionType: 'retry_failed_revision_blocks',
          actionData: { sessionDir: '/path/to/session', fileId: 'file-123' },
        });
      });

      const notification = result.current.notifications[0];
      expect(notification.action).toBeDefined();
      expect(notification.action?.label).toBe('Riprova');
      expect(notification.action?.loadingLabel).toBe('Riprovo...');
      expect(notification.action?.errorSuffix).toBe('puoi usare il pulsante sulla scheda');

      await act(async () => {
        await notification.action?.onAction();
      });

      expect(onRetryFailedRevisionBlocks).toHaveBeenCalledWith('/path/to/session', 'file-123');
    });

    it('binds install_update action and executes callback', async () => {
      const onInstallUpdate = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useNotifications({ onInstallUpdate }));

      act(() => {
        result.current.addNotification('Update', 'Nuova versione', 'info', 'update', {
          actionType: 'install_update',
          actionData: { version: 'v2.1.0' },
        });
      });

      const notification = result.current.notifications[0];
      expect(notification.action).toBeDefined();
      expect(notification.action?.label).toBe('Aggiorna');
      expect(notification.action?.loadingLabel).toBe('Download in corso…');
      expect(notification.action?.errorSuffix).toBe('usa il pulsante “Apri GitHub” per scaricare manualmente.');

      await act(async () => {
        await notification.action?.onAction();
      });

      expect(onInstallUpdate).toHaveBeenCalledWith('v2.1.0');
    });

    it('binds open_github action and executes custom onOpenUrl callback', async () => {
      const onOpenUrl = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useNotifications({ onOpenUrl }));

      act(() => {
        result.current.addNotification('GitHub', 'Vedi repository', 'info', 'system', {
          actionType: 'open_github',
        });
      });

      const notification = result.current.notifications[0];
      expect(notification.action).toBeDefined();
      expect(notification.action?.label).toBe('Apri GitHub');

      await act(async () => {
        await notification.action?.onAction();
      });

      expect(onOpenUrl).toHaveBeenCalledWith(GITHUB_RELEASES_URL);
    });

    it('binds open_github action and falls back to window.pywebview.api.open_url', async () => {
      const pywebviewOpenUrl = vi.fn().mockResolvedValue({ ok: true });
      Object.defineProperty(window, 'pywebview', {
        value: { api: { open_url: pywebviewOpenUrl } },
        writable: true,
        configurable: true,
      });

      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('GitHub', 'Vedi repository', 'info', 'system', {
          actionType: 'open_github',
        });
      });

      const notification = result.current.notifications[0];
      await act(async () => {
        await notification.action?.onAction();
      });

      expect(pywebviewOpenUrl).toHaveBeenCalledWith(GITHUB_RELEASES_URL);
    });
  });
});

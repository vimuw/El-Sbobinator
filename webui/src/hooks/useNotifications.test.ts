// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import {
  NOTIFICATIONS_STORAGE_KEY,
  sanitizePersistedNotifications,
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

    it('sanitizes legacy notifications containing regenerate_prompt_timeout on load', () => {
      const legacy: PersistedNotification[] = [
        {
          id: 'old-1',
          title: 'Errore elaborazione',
          message: 'Errore per "Istologia lezione 9 parte 1.m4a": regenerate_prompt_timeout',
          type: 'error',
          category: 'processing',
          timestamp: 1000,
          read: false,
        },
      ];
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(legacy));

      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications).toHaveLength(1);
      expect(result.current.rawNotifications[0].title).toBe('Elaborazione in pausa');
      expect(result.current.rawNotifications[0].type).toBe('warning');
      expect(result.current.rawNotifications[0].message).toContain('Nessuna scelta ricevuta');
    });

    it('announces no update when the app version changed since the last visit', () => {
      localStorage.setItem(STORAGE_KEYS.LAST_SEEN_APP_VERSION_V1, 'v0.0.1');
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify([]));

      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications).toEqual([]);
      expect(result.current.unreadNotificationsCount).toBe(0);
      expect(localStorage.getItem(STORAGE_KEYS.LAST_SEEN_APP_VERSION_V1)).toBeNull();
      expect(JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) ?? 'null')).toEqual([]);
    });

    it('drops the update notifications older builds saved', () => {
      const saved: PersistedNotification[] = [
        {
          id: 'update-1',
          title: 'Aggiornamento completato',
          message: 'El Sbobinator è stato aggiornato alla versione v1.5.0.',
          type: 'success',
          category: 'update',
          timestamp: 1000,
          read: false,
          persistent: true,
          dedupeKey: 'update-success:v1.5.0',
        },
        {
          id: 'kept-1',
          title: 'Elaborazione completata',
          message: 'Sbobina pronta.',
          type: 'success',
          category: 'processing',
          timestamp: 2000,
          read: false,
        },
      ];
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(saved));

      const { result } = renderHook(() => useNotifications());
      expect(result.current.rawNotifications.map(n => n.id)).toEqual(['kept-1']);
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

  });

  describe('clearAllNotifications', () => {
    it('clears all notifications', () => {
      const { result } = renderHook(() => useNotifications());

      act(() => {
        result.current.addNotification('Normal', 'Msg');
        result.current.addNotification('Other', 'Msg', 'warning', 'system');
      });

      expect(result.current.rawNotifications).toHaveLength(2);

      act(() => {
        result.current.clearAllNotifications();
      });

      expect(result.current.rawNotifications).toHaveLength(0);
      expect(result.current.unreadNotificationsCount).toBe(0);
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

  });
});

describe('sanitizePersistedNotifications', () => {
  it('returns empty array when input is not an array', () => {
    expect(sanitizePersistedNotifications(null)).toEqual([]);
    expect(sanitizePersistedNotifications('string')).toEqual([]);
    expect(sanitizePersistedNotifications({})).toEqual([]);
  });

});

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { APP_VERSION } from '../branding';
import type { NotificationMessage } from '../components/NotificationDropdown';
import { STORAGE_KEYS } from '../storageKeys';
import { compareVersions } from '../utils';

export const NOTIFICATIONS_STORAGE_KEY = STORAGE_KEYS.NOTIFICATIONS_V1;

export type NotificationType = 'info' | 'warning' | 'error' | 'success';
export type NotificationCategory = 'processing' | 'update' | 'system';
export type NotificationActionType = 'retry_failed_revision_blocks' | 'open_settings';

export interface PersistedNotification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  category: NotificationCategory;
  timestamp: number;
  read: boolean;
  persistent?: boolean;
  dedupeKey?: string;
  actionType?: NotificationActionType;
  actionData?: unknown;
}

export interface AddNotificationOptions {
  persistent?: boolean;
  dedupeKey?: string;
  actionType?: NotificationActionType;
  actionData?: unknown;
}

export interface UseNotificationsOptions {
  onRetryFailedRevisionBlocks?: (sessionDir: string, fileId?: string) => Promise<void>;
  onOpenSettings?: () => void;
  currentAppVersion?: string;
}

interface NotificationsBootstrap {
  appVersion: string;
  didUpgrade: boolean;
  notifications: PersistedNotification[];
}

export function sanitizePersistedNotifications(list: unknown): PersistedNotification[] {
  if (!Array.isArray(list)) return [];
  const result: PersistedNotification[] = [];

  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const n = item as PersistedNotification;

    if (typeof n.message === 'string' && n.message.includes('regenerate_prompt_timeout')) {
      const cleanMessage = n.message
        .replace(
          'regenerate_prompt_timeout',
          'Nessuna scelta ricevuta sulla ripresa entro 120 secondi. Sessione salvata: clicca Riprendi per continuare.'
        )
        .replace(/^Errore per /, 'Per ');
      result.push({
        ...n,
        title: n.title === 'Errore elaborazione' ? 'Elaborazione in pausa' : n.title,
        type: n.type === 'error' ? 'warning' : n.type,
        message: cleanMessage,
      });
      continue;
    }

    result.push(n);
  }

  return result;
}

function loadNotificationsBootstrap(currentAppVersion?: string): NotificationsBootstrap {
  let storedList: unknown;
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    storedList = stored ? JSON.parse(stored) : [];
  } catch (_) {
    storedList = [];
  }

  const appVersion = currentAppVersion || APP_VERSION;
  const notifications = sanitizePersistedNotifications(storedList);
  let didUpgrade = false;

  try {
    const lastSeenVersion = localStorage.getItem(STORAGE_KEYS.LAST_SEEN_APP_VERSION_V1);
    if (lastSeenVersion) {
      didUpgrade = compareVersions(appVersion, lastSeenVersion) > 0;
    }
  } catch (_) {}

  return { appVersion, didUpgrade, notifications };
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });

  const [bootstrap] = useState(() => loadNotificationsBootstrap(options.currentAppVersion));
  const [rawNotifications, setRawNotifications] = useState<PersistedNotification[]>(bootstrap.notifications);

  useEffect(() => {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(rawNotifications));
    } catch (_) {}
  }, [rawNotifications]);

  useEffect(() => {
    let committedNotifications = bootstrap.notifications;

    if (bootstrap.didUpgrade) {
      const successDedupeKey = `update-success:${bootstrap.appVersion}`;
      const alreadyHasSuccess = committedNotifications.some(n => n.dedupeKey === successDedupeKey);
      if (!alreadyHasSuccess) {
        const successNotif: PersistedNotification = {
          id: crypto.randomUUID(),
          title: 'Aggiornamento completato',
          message: `El Sbobinator è stato aggiornato alla versione ${bootstrap.appVersion}.`,
          type: 'success',
          category: 'update',
          timestamp: Date.now(),
          read: false,
          persistent: true,
          dedupeKey: successDedupeKey,
        };
        committedNotifications = [successNotif, ...committedNotifications].slice(0, 50);
        setRawNotifications(committedNotifications);
      }
    }

    let notificationsPersisted = true;
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(committedNotifications));
    } catch (_) {
      notificationsPersisted = false;
    }

    if (!bootstrap.didUpgrade || notificationsPersisted) {
      try {
        localStorage.setItem(STORAGE_KEYS.LAST_SEEN_APP_VERSION_V1, bootstrap.appVersion);
      } catch (_) {}
    }
  }, [bootstrap]);

  const deleteNotification = useCallback((id: string) => {
    setRawNotifications(prev => {
      const notif = prev.find(n => n.id === id);
      if (notif?.dedupeKey?.startsWith('config-recovery:')) {
        const recoveredPath = notif.dedupeKey.split('config-recovery:')[1];
        const storageKey = `el-sbobinator.config-recovery-dismissed.v1:${recoveredPath}`;
        try { localStorage.setItem(storageKey, '1'); } catch (_) {}
      }
      return prev.filter(n => n.id !== id);
    });
  }, []);

  const markNotificationAsRead = useCallback((id: string) => {
    setRawNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  }, []);

  const markAllNotificationsAsRead = useCallback(() => {
    setRawNotifications(prev => prev.map(n => ({ ...n, read: true })));
  }, []);

  const clearAllNotifications = useCallback(() => {
    setRawNotifications(prev => {
      prev.forEach(notif => {
        if (notif.dedupeKey?.startsWith('config-recovery:')) {
          const recoveredPath = notif.dedupeKey.split('config-recovery:')[1];
          const storageKey = `el-sbobinator.config-recovery-dismissed.v1:${recoveredPath}`;
          try { localStorage.setItem(storageKey, '1'); } catch (_) {}
        }
      });
      return [];
    });
  }, []);

  const removeNotificationByDedupeKey = useCallback((dedupeKey: string) => {
    setRawNotifications(prev => prev.filter(n => n.dedupeKey !== dedupeKey));
  }, []);

  const addNotification = useCallback((
    title: string,
    message: string,
    type: NotificationType = 'info',
    category: NotificationCategory = 'system',
    opts?: AddNotificationOptions
  ) => {
    setRawNotifications(prev => {
      if (opts?.dedupeKey) {
        const exists = prev.some(n => n.dedupeKey === opts.dedupeKey);
        if (exists) return prev;
      }
      const newNotif: PersistedNotification = {
        id: crypto.randomUUID(),
        title,
        message,
        type,
        category,
        timestamp: Date.now(),
        read: false,
        persistent: opts?.persistent,
        dedupeKey: opts?.dedupeKey,
        actionType: opts?.actionType,
        actionData: opts?.actionData,
      };
      return [newNotif, ...prev].slice(0, 50);
    });
  }, []);

  const bindNotificationActions = useCallback((raw: PersistedNotification[]): NotificationMessage[] => {
    return raw.map(n => {
      if (!n.actionType) return { ...n } as NotificationMessage;

      let onAction: () => Promise<void>;
      let label: string;
      let loadingLabel = '';
      let errorSuffix = '';
      const actionData = n.actionData as Record<string, unknown> | undefined;

      if (n.actionType === 'retry_failed_revision_blocks') {
        label = 'Riprova';
        loadingLabel = 'Riprovo...';
        errorSuffix = 'puoi usare il pulsante sulla scheda';
        onAction = async () => {
          const sessionDir = typeof actionData?.sessionDir === 'string' ? actionData.sessionDir : '';
          const fileId = typeof actionData?.fileId === 'string' ? actionData.fileId : undefined;
          await optionsRef.current.onRetryFailedRevisionBlocks?.(sessionDir, fileId);
        };
      } else if (n.actionType === 'open_settings') {
        label = 'Apri Impostazioni';
        onAction = async () => {
          optionsRef.current.onOpenSettings?.();
        };
      } else {
        return { ...n } as NotificationMessage;
      }

      return {
        ...n,
        action: {
          label,
          type: n.actionType,
          data: n.actionData,
          loadingLabel,
          errorSuffix,
          onAction,
        },
      } as NotificationMessage;
    });
  }, []);

  const notifications = useMemo(() => {
    return bindNotificationActions(rawNotifications);
  }, [rawNotifications, bindNotificationActions]);

  const unreadNotificationsCount = useMemo(() => notifications.filter(n => !n.read).length, [notifications]);
  const [shakeBell, setShakeBell] = useState(false);
  const prevUnreadCountRef = useRef(unreadNotificationsCount);

  useEffect(() => {
    if (unreadNotificationsCount > prevUnreadCountRef.current) {
      setShakeBell(true);
      const timer = setTimeout(() => setShakeBell(false), 500);
      return () => clearTimeout(timer);
    }
    prevUnreadCountRef.current = unreadNotificationsCount;
  }, [unreadNotificationsCount]);

  return {
    rawNotifications,
    setRawNotifications,
    notifications,
    unreadNotificationsCount,
    shakeBell,
    addNotification,
    deleteNotification,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearAllNotifications,
    removeNotificationByDedupeKey,
  };
}

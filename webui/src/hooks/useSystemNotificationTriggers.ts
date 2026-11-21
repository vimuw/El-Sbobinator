import { useEffect, useRef } from 'react';
import { type AddNotificationOptions, type NotificationCategory, type NotificationType } from './useNotifications';

export interface UseSystemNotificationTriggersOptions {
  configRecoveredFrom: string;
  addNotification: (
    title: string,
    message: string,
    type?: NotificationType,
    category?: NotificationCategory,
    options?: AddNotificationOptions,
  ) => void;
}

export function useSystemNotificationTriggers({
  configRecoveredFrom,
  addNotification,
}: UseSystemNotificationTriggersOptions) {
  const configRecoveryToastPathRef = useRef<string | null>(null);
  useEffect(() => {
    const recoveredPath = configRecoveredFrom.trim();
    if (!recoveredPath) return;
    if (configRecoveryToastPathRef.current === recoveredPath) return;
    const storageKey = `el-sbobinator.config-recovery-dismissed.v1:${recoveredPath}`;
    try {
      if (localStorage.getItem(storageKey) === '1') return;
    } catch (_) {}
    configRecoveryToastPathRef.current = recoveredPath;
    addNotification(
      'Configurazione ripristinata',
      'Il file di configurazione era corrotto: ho ripristinato i valori predefiniti e salvato una copia di backup del file precedente.',
      'warning',
      'system',
      {
        persistent: true,
        dedupeKey: `config-recovery:${recoveredPath}`,
      },
    );
  }, [configRecoveredFrom, addNotification]);
}

import React, { useEffect, useRef, useState } from 'react';
import { STORAGE_KEYS } from '../storageKeys';
import { type AddNotificationOptions, type NotificationCategory, type NotificationType } from './useNotifications';

export interface UseSystemNotificationTriggersOptions {
  configRecoveredFrom: string;
  updateAvailable: string | null;
  addNotification: (
    title: string,
    message: string,
    type?: NotificationType,
    category?: NotificationCategory,
    options?: AddNotificationOptions,
  ) => void;
  removeNotificationByDedupeKey: (dedupeKey: string) => void;
  isPeakDismissed: boolean;
  setIsPeakDismissed: React.Dispatch<React.SetStateAction<boolean>>;
}

export function useSystemNotificationTriggers({
  configRecoveredFrom,
  updateAvailable,
  addNotification,
  removeNotificationByDedupeKey,
  isPeakDismissed,
  setIsPeakDismissed,
}: UseSystemNotificationTriggersOptions) {
  const [isPeakHour, setIsPeakHour] = useState(() => {
    const h = new Date().getHours();
    return h >= 15 && h < 20;
  });

  useEffect(() => {
    const check = () => {
      const h = new Date().getHours();
      setIsPeakHour(h >= 15 && h < 20);
    };
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (isPeakHour) {
      const ts = localStorage.getItem(STORAGE_KEYS.PEAK_BANNER_DISMISSED_UNTIL);
      setIsPeakDismissed(ts ? Date.now() < Number(ts) : false);
    }
  }, [isPeakHour, setIsPeakDismissed]);

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

  useEffect(() => {
    if (!isPeakHour) {
      removeNotificationByDedupeKey('peak-hour-warning');
      return;
    }
    if (isPeakDismissed) return;
    addNotification(
      'Fascia oraria di punta',
      'Fascia oraria di punta (15:00–20:00): i modelli Gemini Flash possono subire rallentamenti o errori 503.',
      'warning',
      'system',
      {
        persistent: true,
        dedupeKey: 'peak-hour-warning',
      },
    );
  }, [isPeakHour, isPeakDismissed, addNotification, removeNotificationByDedupeKey]);

  const updateToastShownVersionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!updateAvailable) return;
    if (updateToastShownVersionRef.current === updateAvailable) return;
    updateToastShownVersionRef.current = updateAvailable;
    const cleanVer = updateAvailable.trim().replace(/^v+/, '');
    addNotification(
      'Aggiornamento disponibile',
      `Nuova versione disponibile: v${cleanVer}`,
      'info',
      'update',
      {
        persistent: true,
        dedupeKey: 'update-available',
        actionData: { version: updateAvailable },
      },
    );
  }, [updateAvailable, addNotification]);

  return {
    isPeakHour,
  };
}

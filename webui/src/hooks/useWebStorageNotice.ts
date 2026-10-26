import { useEffect, useRef } from 'react';
import { getHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';
import type { AddNotificationOptions, NotificationCategory, NotificationType } from './useNotifications';

type AddNotification = (title: string, message: string, type?: NotificationType, category?: NotificationCategory, opts?: AddNotificationOptions) => void;

export const WEB_STORAGE_NOTICE_TITLE = 'Le sbobine restano solo in questo browser';
export const WEB_STORAGE_NOTICE_MESSAGE =
  'Il browser può cancellarle se non apri il sito per qualche giorno (Safari dopo circa 7) o se manca spazio. '
  + 'Scarica ogni tanto un backup da Impostazioni → Archiviazione.';

function alreadyShown(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_NOTICE_V1) !== null;
  } catch {
    return true;
  }
}

function markShown(): void {
  try {
    window.localStorage.setItem(STORAGE_KEYS.WEB_STORAGE_NOTICE_V1, new Date().toISOString());
  } catch {
    // Without storage the notice could repeat; alreadyShown() then says true anyway.
  }
}

/**
 * Web build: once there is a sbobina worth keeping, tells the user once (a notification, not a
 * dialog) that the browser may clear the site's data, unless it promised to keep it.
 */
export function useWebStorageNotice({ apiReady, sessionCount, addNotification }: {
  apiReady: boolean;
  sessionCount: number;
  addNotification: AddNotification;
}): void {
  const checkingRef = useRef(false);
  useEffect(() => {
    if (!apiReady || sessionCount === 0 || checkingRef.current) return;
    if (getHostCapabilities().kind !== 'web' || alreadyShown()) return;
    const check = window.pywebview?.api?.get_storage_protection;
    if (!check) return;
    checkingRef.current = true;
    void check().then(result => {
      if (alreadyShown()) return;
      markShown();
      if (result?.ok && !result.persisted) {
        addNotification(WEB_STORAGE_NOTICE_TITLE, WEB_STORAGE_NOTICE_MESSAGE, 'warning', 'system', {
          dedupeKey: 'web-storage-notice',
          actionType: 'open_settings',
        });
      }
    }).catch(() => {
      checkingRef.current = false;
    });
  }, [apiReady, sessionCount, addNotification]);
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DriveExportResult, DriveStatus } from '../bridge';
import { loadStorageChoice, saveStorageChoice, type WebStorageChoice } from '../components/modals/settings/webStorageChoice';

// Web builds with Drive sync: the host's Drive status (web/drive/driveService.ts), read while the
// caller is mounted, and its actions. The settings cards and the sidebar account button share it.
// Every action calls the host right inside the tap: connecting opens the Google window, which needs it.

export type DriveAction = 'connect' | 'sync' | 'disconnect' | 'erase' | 'export';

export interface DriveController {
  /** This build talks to Drive at all. */
  available: boolean;
  status: DriveStatus | null;
  busy: DriveAction | null;
  /** "Dove tengo le sbobine?": a linked account always counts as Drive. */
  choice: WebStorageChoice;
  choose: (choice: WebStorageChoice) => void;
  connect: () => void;
  syncNow: () => void;
  /** Stops syncing this browser (the choice goes back to it); with `erase`, also empties the app's hidden Drive folder. */
  leave: (erase: boolean, after?: (next: DriveStatus) => void) => void;
  exportAll: (onProgress: (done: number, total: number) => void) => Promise<DriveExportResult | null>;
}

export function useDriveStatus(pollMs = 2000): DriveController {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState<DriveAction | null>(null);
  const [storedChoice, setStoredChoice] = useState<WebStorageChoice | null>(() => loadStorageChoice());
  const busyRef = useRef<DriveAction | null>(null);
  const mountedRef = useRef(true);
  const available = Boolean(window.pywebview?.api?.get_drive_status);

  const refresh = useCallback(async () => {
    const next = await window.pywebview?.api?.get_drive_status?.().catch(() => null);
    if (mountedRef.current && next) setStatus(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!available) return () => { mountedRef.current = false; };
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [available, pollMs, refresh]);

  const markBusy = (action: DriveAction | null) => {
    busyRef.current = action;
    if (mountedRef.current) setBusy(action);
  };

  const run = (action: DriveAction, call: (() => Promise<DriveStatus>) | undefined, after?: (next: DriveStatus) => void) => {
    if (!call || busyRef.current) return;
    markBusy(action);
    void call().then(
      next => {
        if (!mountedRef.current) return;
        setStatus(next);
        after?.(next);
      },
      () => { void refresh(); },
    ).finally(() => markBusy(null));
  };

  const choose = (next: WebStorageChoice) => {
    saveStorageChoice(next);
    setStoredChoice(next);
  };

  const api = window.pywebview?.api;
  const connect = () => run('connect', api?.connect_drive && (() => api.connect_drive!()));
  const syncNow = () => run('sync', api?.sync_drive_now && (() => api.sync_drive_now!()));
  const leave = (erase: boolean, after?: (next: DriveStatus) => void) => {
    const call = erase ? api?.erase_drive_data && (() => api.erase_drive_data!()) : api?.disconnect_drive && (() => api.disconnect_drive!());
    run(erase ? 'erase' : 'disconnect', call, next => {
      if (!next.connected) choose('browser');
      after?.(next);
    });
  };
  const exportAll = async (onProgress: (done: number, total: number) => void): Promise<DriveExportResult | null> => {
    if (!api?.export_to_drive || busyRef.current) return null;
    markBusy('export');
    try {
      // Inside the tap: the Google window asks for the permission to create files in Drive.
      return await api.export_to_drive((done, total) => {
        if (mountedRef.current) onProgress(done, total);
      });
    } catch (error) {
      return { ok: false, exported: 0, total: 0, error: String(error) };
    } finally {
      markBusy(null);
    }
  };

  const choice: WebStorageChoice = status?.connected ? 'drive' : storedChoice ?? 'browser';
  return { available, status, busy, choice, choose, connect, syncNow, leave, exportAll };
}

/** The one-word state the badges show. */
export type DriveHealth = 'off' | 'syncing' | 'ok' | 'reconnect' | 'error';

export function driveHealth(status: DriveStatus | null, busy: DriveAction | null = null): DriveHealth {
  if (!status?.connected) return 'off';
  if (status.needs_reconnect) return 'reconnect';
  if (status.syncing || busy === 'sync') return 'syncing';
  if (status.error) return 'error';
  return 'ok';
}

export const DRIVE_HEALTH_LABEL: Record<DriveHealth, string> = {
  off: 'Non collegato',
  syncing: 'Sincronizzazione…',
  ok: 'Sincronizzato',
  reconnect: 'Da riconnettere',
  error: 'Errore di sincronizzazione',
};

export function formatLastSync(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Non ancora sincronizzato da questo browser.';
  return `Ultima sincronizzazione: ${date.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`;
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Loader2, RefreshCw } from 'lucide-react';
import type { DriveStatus } from '../../../bridge';
import { SettingsSectionHeading } from './SettingsLayout';

// Web previews with Drive sync only: link this browser to the hidden app folder of the user's Google
// Drive. The status lives in the host (drive/driveService.ts); the panel reads it while open.

const POLL_MS = 2000;

type Action = 'connect' | 'sync' | 'disconnect';

function formatLastSync(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Non ancora sincronizzato da questo browser.';
  return `Ultima sincronizzazione: ${date.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`;
}

export const WebDriveSection: React.FC = () => {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const next = await window.pywebview?.api?.get_drive_status?.().catch(() => null);
    if (mountedRef.current && next) setStatus(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  const run = (action: Action, call: (() => Promise<DriveStatus>) | undefined) => {
    if (!call || busy) return;
    setBusy(action);
    // Called right inside the tap: connect_drive opens the Google window, which needs it.
    void call().then(
      next => { if (mountedRef.current) setStatus(next); },
      () => { void refresh(); },
    ).finally(() => {
      if (mountedRef.current) setBusy(null);
    });
  };

  const api = window.pywebview?.api;
  const connect = () => run('connect', api?.connect_drive && (() => api.connect_drive!()));
  const syncNow = () => run('sync', api?.sync_drive_now && (() => api.sync_drive_now!()));
  const disconnect = () => run('disconnect', api?.disconnect_drive && (() => api.disconnect_drive!()));
  const spinner = <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />;

  return (
    <div className="space-y-3" data-testid="web-drive">
      <div className="space-y-0.5">
        <SettingsSectionHeading>Google Drive</SettingsSectionHeading>
        <p className="text-xs text-[var(--text-secondary)]">
          Tieni una copia delle sbobine e delle raccolte nella cartella nascosta dell’app sul tuo Google Drive, per ritrovarle sugli altri dispositivi collegati allo stesso account. Audio e chiavi API restano in questo browser.
        </p>
      </div>

      <p data-testid="web-drive-status" className="text-sm font-bold text-[var(--text-primary)]">
        {!status ? '…' : status.connected ? `Collegato come ${status.email ?? 'account Google'}` : 'Non collegato'}
      </p>
      {status?.connected && !status.needs_reconnect && (
        <p data-testid="web-drive-last-sync" className="text-xs text-[var(--text-secondary)]">
          {status.syncing || busy === 'sync' ? 'Sincronizzazione in corso…' : formatLastSync(status.last_sync_at)}
        </p>
      )}
      {status?.error && (
        <p role="alert" data-testid="web-drive-error" className="text-xs text-[var(--error-text)]">{status.error}</p>
      )}

      {status && (
        <div className="flex flex-wrap items-center gap-2">
          {!status.connected && (
            <button type="button" onClick={connect} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}
              <span>Collega Google Drive</span>
            </button>
          )}
          {status.connected && status.needs_reconnect && (
            <button type="button" onClick={connect} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}
              <span>Drive: tocca per riconnettere</span>
            </button>
          )}
          {status.connected && !status.needs_reconnect && (
            <button type="button" onClick={syncNow} disabled={busy !== null || status.syncing} className="app-button-secondary is-settings-action">
              {busy === 'sync' ? spinner : <RefreshCw className="w-4 h-4" />}
              <span>Sincronizza ora</span>
            </button>
          )}
          {status.connected && (
            <button type="button" onClick={disconnect} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'disconnect' ? spinner : <CloudOff className="w-4 h-4" />}
              <span>Disconnetti</span>
            </button>
          )}
        </div>
      )}

      <p className="text-xs text-[var(--text-secondary)]">
        La sincronizzazione parte da sola all’apertura e qualche secondo dopo ogni modifica, mai durante un’elaborazione. “Disconnetti” non cancella niente: le sbobine restano in questo browser e su Drive.
      </p>
    </div>
  );
};

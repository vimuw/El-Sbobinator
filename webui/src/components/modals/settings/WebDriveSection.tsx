import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Cloud, FolderUp, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { DriveExportResult, DriveStatus } from '../../../bridge';
import { SettingsSectionHeading } from './SettingsLayout';
import { LOCAL_ONLY_WARNING, loadStorageChoice, saveStorageChoice, type WebStorageChoice } from './webStorageChoice';

// Web previews with Drive sync only: "Dove tengo le sbobine?" (this browser, or this browser + the
// hidden app folder of the user's Google Drive), the sync status, the one-way export to a visible
// folder and the removal of everything the app keeps on Drive. The status lives in the host
// (drive/driveService.ts); the panel reads it while open.

const POLL_MS = 2000;

type Action = 'connect' | 'sync' | 'disconnect' | 'erase' | 'export';
type Confirm = 'leave' | 'erase' | null;

function formatLastSync(iso: string | null): string {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return 'Non ancora sincronizzato da questo browser.';
  return `Ultima sincronizzazione: ${date.toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`;
}

function describeExport(result: DriveExportResult): string {
  const count = `${result.exported} ${result.exported === 1 ? 'sbobina esportata' : 'sbobine esportate'}`;
  if (result.ok) return result.total === 0 ? 'Nessuna sbobina da esportare.' : `${count} in “${result.folder_name}”.`;
  return result.exported > 0 ? `${result.error} ${count} su ${result.total} in “${result.folder_name}”.` : result.error ?? 'Esportazione non riuscita.';
}

export const WebDriveSection: React.FC = () => {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [storedChoice, setStoredChoice] = useState<WebStorageChoice | null>(() => loadStorageChoice());
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [exportResult, setExportResult] = useState<DriveExportResult | null>(null);
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

  const choose = (choice: WebStorageChoice) => {
    saveStorageChoice(choice);
    setStoredChoice(choice);
  };

  const run = <T extends DriveStatus>(action: Action, call: (() => Promise<T>) | undefined, after?: (next: T) => void) => {
    if (!call || busy) return;
    setBusy(action);
    // Called right inside the tap: connect_drive opens the Google window, which needs it.
    void call().then(
      next => {
        if (!mountedRef.current) return;
        setStatus(next);
        after?.(next);
      },
      () => { void refresh(); },
    ).finally(() => {
      if (mountedRef.current) setBusy(null);
    });
  };

  const api = window.pywebview?.api;
  const connected = Boolean(status?.connected);
  const choice: WebStorageChoice = connected ? 'drive' : storedChoice ?? 'browser';
  const connect = () => run('connect', api?.connect_drive && (() => api.connect_drive!()));
  const syncNow = () => run('sync', api?.sync_drive_now && (() => api.sync_drive_now!()));
  const leave = (erase: boolean) => {
    const call = erase ? api?.erase_drive_data && (() => api.erase_drive_data!()) : api?.disconnect_drive && (() => api.disconnect_drive!());
    run(erase ? 'erase' : 'disconnect', call, next => {
      if (next.connected) return;
      setConfirm(null);
      choose('browser');
    });
  };
  const pickDrive = () => {
    if (choice === 'drive' && connected) return;
    choose('drive');
    setConfirm(null);
    if (!connected) connect();
  };
  const pickBrowser = () => {
    if (connected) setConfirm('leave');
    else choose('browser');
  };
  const exportAll = () => {
    if (!api?.export_to_drive || busy) return;
    setBusy('export');
    setExportResult(null);
    setExportProgress(null);
    // Inside the tap: the Google window asks for the permission to create files in Drive.
    void api.export_to_drive((done, total) => {
      if (mountedRef.current) setExportProgress({ done, total });
    }).then(
      result => { if (mountedRef.current) setExportResult(result); },
      error => { if (mountedRef.current) setExportResult({ ok: false, exported: 0, total: 0, error: String(error) }); },
    ).finally(() => {
      if (mountedRef.current) {
        setBusy(null);
        setExportProgress(null);
      }
    });
  };
  const spinner = <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />;
  const radio = (value: WebStorageChoice, label: string, onPick: () => void) => (
    <label className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
      <input type="radio" name="web-storage-choice" value={value} checked={choice === value} onChange={onPick} disabled={busy !== null} />
      <span>{label}</span>
    </label>
  );

  return (
    <div className="space-y-3" data-testid="web-drive">
      <div className="space-y-0.5">
        <SettingsSectionHeading>Google Drive</SettingsSectionHeading>
        <p className="text-xs text-[var(--text-secondary)]">
          Tieni una copia delle sbobine e delle raccolte nella cartella nascosta dell’app sul tuo Google Drive, per ritrovarle sugli altri dispositivi collegati allo stesso account. Audio e chiavi API restano in questo browser.
        </p>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-bold text-[var(--text-primary)] mb-1">Dove tengo le sbobine?</legend>
        {radio('browser', 'Solo in questo browser', pickBrowser)}
        {radio('drive', 'In questo browser + Google Drive', pickDrive)}
      </fieldset>

      {confirm === 'leave' && (
        <div role="group" aria-label="Smetti di usare Google Drive" className="p-3 rounded-xl border border-[var(--border-subtle)] space-y-2">
          <p className="text-xs text-[var(--text-primary)]">Questo browser smette di sincronizzarsi. Le sbobine restano qui. La copia su Drive la tengo o la elimino?</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => leave(false)} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'disconnect' && spinner}<span>Disconnetti</span>
            </button>
            <button type="button" onClick={() => leave(true)} disabled={busy !== null} className="app-button-secondary is-settings-action text-[var(--error-text)]">
              {busy === 'erase' && spinner}<span>Disconnetti ed elimina da Drive</span>
            </button>
            <button type="button" onClick={() => setConfirm(null)} disabled={busy !== null} className="app-button-secondary is-settings-action">Annulla</button>
          </div>
        </div>
      )}

      {choice === 'browser' && !connected && (
        <p data-testid="web-drive-local-only" className="text-xs text-[var(--text-secondary)]">{LOCAL_ONLY_WARNING}</p>
      )}

      {choice === 'drive' && (
        <>
          <p data-testid="web-drive-status" className="text-sm font-bold text-[var(--text-primary)]">
            {!status ? '…' : connected ? `Collegato come ${status.email ?? 'account Google'}` : 'Non collegato'}
          </p>
          {connected && !status?.needs_reconnect && (
            <p data-testid="web-drive-last-sync" className="text-xs text-[var(--text-secondary)]">
              {status?.syncing || busy === 'sync' ? 'Sincronizzazione in corso…' : formatLastSync(status?.last_sync_at ?? null)}
            </p>
          )}
        </>
      )}
      {status?.error && (
        <p role="alert" data-testid="web-drive-error" className="text-xs text-[var(--error-text)]">{status.error}</p>
      )}

      {status && choice === 'drive' && (
        <div className="flex flex-wrap items-center gap-2">
          {!connected && (
            <button type="button" onClick={connect} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}
              <span>Collega Google Drive</span>
            </button>
          )}
          {connected && status.needs_reconnect && (
            <button type="button" onClick={connect} disabled={busy !== null} className="app-button-secondary is-settings-action">
              {busy === 'connect' ? spinner : <Cloud className="w-4 h-4" />}
              <span>Drive: tocca per riconnettere</span>
            </button>
          )}
          {connected && !status.needs_reconnect && (
            <button type="button" onClick={syncNow} disabled={busy !== null || status.syncing} className="app-button-secondary is-settings-action">
              {busy === 'sync' ? spinner : <RefreshCw className="w-4 h-4" />}
              <span>Sincronizza ora</span>
            </button>
          )}
        </div>
      )}

      {choice === 'drive' && (
        <p className="text-xs text-[var(--text-secondary)]">
          La sincronizzazione parte da sola all’apertura e qualche secondo dopo ogni modifica, mai durante un’elaborazione.
        </p>
      )}

      <div className="space-y-1.5" data-testid="web-drive-export">
        <p className="text-sm font-bold text-[var(--text-primary)]">Esporta nel mio Drive</p>
        <p className="text-xs text-[var(--text-secondary)]">
          Una copia leggibile di ogni sbobina (un file HTML) in una cartella nuova del tuo Drive, con le raccolte come sottocartelle. Google ti chiede il permesso di creare file; l’app non rilegge mai quella cartella.
        </p>
        <button type="button" onClick={exportAll} disabled={busy !== null} className="app-button-secondary is-settings-action">
          {busy === 'export' ? spinner : <FolderUp className="w-4 h-4" />}
          <span>Esporta tutte le sbobine nel mio Drive</span>
        </button>
        {exportProgress && (
          <p data-testid="web-drive-export-progress" className="text-xs text-[var(--text-secondary)]">Esportazione: {exportProgress.done} di {exportProgress.total}…</p>
        )}
        {exportResult && (
          <p role={exportResult.ok ? 'status' : 'alert'} data-testid="web-drive-export-result" className={`text-xs ${exportResult.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--error-text)]'}`}>
            {describeExport(exportResult)}{' '}
            {exportResult.folder_url && (
              <a href={exportResult.folder_url} target="_blank" rel="noopener noreferrer" className="underline">Apri la cartella</a>
            )}
          </p>
        )}
      </div>

      {connected && (
        <div className="space-y-1.5">
          {confirm !== 'erase' ? (
            <button type="button" onClick={() => setConfirm('erase')} disabled={busy !== null} className="app-button-secondary is-settings-action text-[var(--error-text)]">
              <Trash2 className="w-4 h-4" />
              <span>Elimina tutti i miei dati da Drive</span>
            </button>
          ) : (
            <div role="group" aria-label="Elimina tutti i miei dati da Drive" className="p-3 rounded-xl border border-[var(--border-subtle)] space-y-2">
              <p className="text-xs text-[var(--text-primary)]">
                Cancello da Drive tutte le sbobine e le raccolte salvate da El Sbobinator e scollego questo browser. Le sbobine in questo browser restano. Gli altri dispositivi ancora collegati rimetterebbero su Drive quello che modifichi lì.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => leave(true)} disabled={busy !== null} className="app-button-secondary is-settings-action text-[var(--error-text)]">
                  {busy === 'erase' && spinner}<span>Elimina da Drive</span>
                </button>
                <button type="button" onClick={() => setConfirm(null)} disabled={busy !== null} className="app-button-secondary is-settings-action">Annulla</button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-[var(--text-muted)]">
        Puoi eliminare i dati anche da Google Drive sul computer: Impostazioni → Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti. Per togliere l’accesso all’app:{' '}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="underline">myaccount.google.com/permissions</a>.
      </p>
    </div>
  );
};

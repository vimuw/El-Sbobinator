import React, { useState } from 'react';
import { Check, Cloud, CloudSync, EyeOff, FolderUp, Loader2, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react';
import type { DriveExportResult } from '../../../bridge';
import { DRIVE_HEALTH_LABEL, DRIVE_WAITING_FOR_RUN, driveHealth, formatLastSync, type DriveController, type DriveHealth } from '../../../hooks/useDriveStatus';
import { InlineConfirm, SettingsCallout, SettingsCardLabel, SettingsMoreInfo, SettingsPanel, SettingsRow, StatusBadge, type StatusBadgeTone } from './SettingsLayout';
import { ExternalLinkIcon } from '../../ExternalLinkIcon';

// Web previews with Drive sync only, sharing one useDriveStatus. Impostazioni → Google Drive is
// two sections that follow the link state, not a "browser / Drive" choice: the account (link it,
// or sync, reconnect and disconnect it) with what goes to Drive, and "Elimina i dati da Drive". The
// "Esporta nel mio Drive" row (one-way copy to a visible folder) ends the backup in Archiviazione.

const HEALTH_TONE: Record<DriveHealth, StatusBadgeTone> = {
  off: 'neutral',
  syncing: 'accent',
  ok: 'success',
  reconnect: 'warning',
  error: 'error',
};

const spinner = <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />;

/** The round initial of the linked account, as in the sidebar. */
export function DriveAvatar({ email, size = 32 }: { email: string | null; size?: number }) {
  const initial = (email ?? '').trim().charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="drive-avatar shrink-0 inline-flex items-center justify-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
    >
      {initial || <Cloud style={{ width: size * 0.5, height: size * 0.5 }} />}
    </span>
  );
}

// Why to link, the same here and in the sidebar's Google Drive menu, which has no way to these
// settings and so says all they say before linking.
export const DRIVE_LINK_REASONS: Array<[React.ElementType, string]> = [
  [MonitorSmartphone, 'le ritrovi sugli altri dispositivi'],
  [ShieldCheck, 'se il browser le cancella, restano su Drive'],
  [EyeOff, 'in una cartella nascosta che vede solo l’app'],
];

/** What the sync leaves out, in the sidebar menu; "Cosa va su Drive" says it at length. */
export const DRIVE_STAYS_HERE = 'audio e chiavi API restano in questo browser';

// What the sync carries, in view rather than folded, beside the account it applies to. Unlinked,
// the reasons above already name the hidden folder: the first line does not say it again.
function DriveScope({ linked }: { linked: boolean }) {
  return (
    <div data-testid="web-drive-scope" className="space-y-2">
      <SettingsCardLabel block>Cosa va su Drive</SettingsCardLabel>
      <ul className="space-y-1.5 text-xs">
        <li className="flex items-start gap-2 text-[var(--text-primary)]">
          <Check className="w-4 h-4 shrink-0 text-[var(--success-text)]" aria-hidden="true" />
          <span>{linked ? 'Testi delle sbobine e raccolte, in una cartella nascosta che solo El Sbobinator vede.' : 'Testi delle sbobine e raccolte.'}</span>
        </li>
        <li className="flex items-start gap-2 text-[var(--text-secondary)]">
          <X className="w-4 h-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
          <span>Audio delle lezioni e chiavi API: restano in questo browser. Per gli audio serve un backup, in Archiviazione.</span>
        </li>
      </ul>
    </div>
  );
}

export const WebDriveSection: React.FC<{ drive: DriveController }> = ({ drive }) => {
  const { status, busy, choose, connect, syncNow, leave } = drive;

  const connected = Boolean(status?.connected);
  const health = driveHealth(status, busy);
  const link = () => {
    choose('drive');
    connect();
  };
  const error = status?.error && (
    <p role="alert" data-testid="web-drive-error" className="text-xs text-[var(--error-text)]">{status.error}</p>
  );

  if (!connected) {
    return (
      <SettingsPanel
        testId="web-drive"
        icon={Cloud}
        title="Account Google"
        description="Le sbobine ora sono solo in questo browser."
      >
        {/* The reasons and, on their right, the action that answers them, in one card: the wide
            card keeps no empty band. Where it is too narrow (phone) the button wraps under them,
            as in the sidebar's narrow menu. What goes to Drive is the detail after it. */}
        <SettingsCallout
          testId="web-drive-link"
          tone="accent"
          title="Collega il tuo account Google"
          action={(
            <button type="button" onClick={link} disabled={!status || busy !== null} className="modal-action-button is-primary">
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cloud className="w-4 h-4" />}
              <span>Collega Google Drive</span>
            </button>
          )}
        >
          <ul data-testid="web-drive-reasons" className="space-y-1.5 text-[var(--text-primary)]">
            {DRIVE_LINK_REASONS.map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-2">
                <Icon className="w-4 h-4 shrink-0 text-[var(--accent-text)]" aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </SettingsCallout>
        {error}
        <DriveScope linked={false} />
      </SettingsPanel>
    );
  }

  return (
    <SettingsPanel
      testId="web-drive"
      icon={Cloud}
      title="Account Google"
      description="Le sbobine di questo browser si sincronizzano da sole con il tuo Drive."
      badge={<StatusBadge tone={HEALTH_TONE[health]}>{DRIVE_HEALTH_LABEL[health]}</StatusBadge>}
    >
      {/* The account with its two actions: the daily one, then the way out, quieter. The avatar
          stays beside the text, which keeps at least 14rem: when the actions don't fit next to it
          (phone, tablet) they wrap under it, on the right. */}
      <div data-testid="web-drive-account" className="flex flex-wrap items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)]">
        <div data-testid="web-drive-identity" className="flex items-center gap-3 min-w-0 flex-[1_1_14rem]">
          <DriveAvatar email={status?.email ?? null} />
          <div className="min-w-0 flex-1">
            <p data-testid="web-drive-status" className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {`Collegato come ${status?.email ?? 'account Google'}`}
            </p>
            {/* The one line that asks for something: in the warning colour, saying what is on hold. */}
            <p data-testid="web-drive-last-sync" className={`text-xs ${status?.needs_reconnect ? 'font-medium text-[var(--warning-text)]' : 'text-[var(--text-secondary)]'}`}>
              {status?.needs_reconnect
                ? 'Accesso a Google scaduto: le modifiche restano in questo browser e non vanno su Drive finché non riconnetti.'
                : status?.syncing || busy === 'sync' ? 'Sincronizzazione in corso…'
                  : status?.waiting_for_run ? DRIVE_WAITING_FOR_RUN : formatLastSync(status?.last_sync_at ?? null)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Each action has its own icon: the cloud with arrows is the Drive sync, the plain arrows
              redo the login. The expired line beside it already says to reconnect, so that icon
              needs no label. */}
          {status?.needs_reconnect ? (
            <button
              type="button"
              onClick={connect}
              disabled={busy !== null}
              aria-label="Riconnetti"
              title="Riconnetti"
              className="app-button-secondary is-settings-action is-icon"
            >
              {busy === 'connect' ? spinner : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
            </button>
          ) : (
            <button type="button" onClick={syncNow} disabled={busy !== null || Boolean(status?.syncing || status?.waiting_for_run)} className="app-button-secondary is-settings-action">
              {busy === 'sync' || status?.syncing ? spinner : <CloudSync className="w-4 h-4" aria-hidden="true" />}
              <span>Sincronizza</span>
            </button>
          )}
          {/* As "Scollega Drive" in the sidebar menu, with no question: the sbobine stay here and
              the copy on Drive is kept, so linking again brings everything back. Erasing Drive,
              which cannot be undone, is only in "Elimina i dati da Drive", with its confirmation. */}
          <button
            type="button"
            onClick={() => leave(false)}
            disabled={busy !== null}
            aria-label="Scollega Drive"
            title="Scollega Drive"
            className="app-button-secondary is-settings-action is-icon"
          >
            {busy === 'disconnect' ? spinner : <LogOut className="w-4 h-4" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <p data-testid="web-drive-when" className="text-xs text-[var(--text-secondary)]">Si sincronizza da solo all’apertura e qualche secondo dopo ogni modifica, mai durante un’elaborazione.</p>
      {error}

      <DriveScope linked />
    </SettingsPanel>
  );
};

function describeExport(result: DriveExportResult): string {
  const count = `${result.exported} ${result.exported === 1 ? 'sbobina esportata' : 'sbobine esportate'}`;
  if (result.ok) return result.total === 0 ? 'Nessuna sbobina da esportare.' : `${count} in “${result.folder_name}”.`;
  return result.exported > 0 ? `${result.error} ${count} su ${result.total} in “${result.folder_name}”.` : result.error ?? 'Esportazione non riuscita.';
}

// A row inside another section: same job, one step down from a section title.
function SubRow({ testId, children }: { testId: string; children: React.ReactNode }) {
  return <div data-testid={testId} className="space-y-2 pt-1">{children}</div>;
}

export const WebDriveExportRow: React.FC<{ drive: DriveController }> = ({ drive }) => {
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<DriveExportResult | null>(null);

  const exportAll = () => {
    if (drive.busy) return;
    setResult(null);
    setProgress(null);
    void drive.exportAll((done, total) => setProgress({ done, total })).then(next => {
      setProgress(null);
      if (next) setResult(next);
    });
  };

  return (
    <SubRow testId="web-drive-export">
      <SettingsRow
        title="Esporta nel mio Drive"
        description={progress
          ? <span data-testid="web-drive-export-progress">Esportazione: {progress.done} di {progress.total}…</span>
          : 'Una copia leggibile di tutte le sbobine in una cartella nuova del tuo Drive, da aprire o condividere.'}
      >
        <button
          type="button"
          onClick={exportAll}
          disabled={drive.busy !== null}
          aria-label="Esporta tutte le sbobine nel mio Drive"
          title="Esporta tutte le sbobine nel mio Drive"
          className="app-button-secondary is-settings-action shrink-0"
        >
          {drive.busy === 'export' ? spinner : <FolderUp className="w-4 h-4" />}
          <span>Esporta</span>
        </button>
      </SettingsRow>
      {result && (
        <p role={result.ok ? 'status' : 'alert'} data-testid="web-drive-export-result" className={`text-xs ${result.ok ? 'text-[var(--text-secondary)]' : 'text-[var(--error-text)]'}`}>
          {describeExport(result)}{' '}
          {result.folder_url && (
            <a href={result.folder_url} target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">Apri la cartella<ExternalLinkIcon /></a>
          )}
        </p>
      )}
      <SettingsMoreInfo label="Come funziona l’esportazione">
        <p>Ogni sbobina diventa un file HTML, con le raccolte come sottocartelle. Funziona anche senza la sincronizzazione.</p>
        <p>Google ti chiede il permesso di creare file; l’app non rilegge mai quella cartella.</p>
      </SettingsMoreInfo>
    </SubRow>
  );
};

// Last on the Google Drive page and apart from the account, so it is never mistaken for a daily action.
export const WebDriveEraseSection: React.FC<{ drive: DriveController }> = ({ drive }) => {
  const { status, busy, leave } = drive;
  const [confirm, setConfirm] = useState(false);
  const connected = Boolean(status?.connected);

  return (
    <SettingsPanel
      testId="web-drive-erase"
      icon={Trash2}
      title="Elimina i dati da Drive"
      description={connected
        ? 'Cancella da Google Drive tutto quello che El Sbobinator ci ha salvato. Le sbobine in questo browser restano.'
        : 'Per eliminarli da qui collega prima Google Drive, oppure segui i passaggi qui sotto.'}
      action={connected && !confirm && (
        <button
          type="button"
          onClick={() => setConfirm(true)}
          disabled={busy !== null}
          aria-label="Elimina tutti i miei dati da Drive"
          title="Elimina tutti i miei dati da Drive"
          className="app-button-secondary is-settings-action is-icon is-danger shrink-0"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    >
      {connected && confirm && (
        <InlineConfirm
          tone="danger"
          label="Elimina tutti i miei dati da Drive"
          title="Eliminare tutti i dati da Drive?"
          actions={(
            <>
              <button type="button" onClick={() => setConfirm(false)} disabled={busy !== null} className="app-button-secondary is-settings-action">Annulla</button>
              <button type="button" onClick={() => leave(true, next => { if (!next.connected) setConfirm(false); })} disabled={busy !== null} className="app-button-secondary is-settings-action is-danger">
                {busy === 'erase' && spinner}<span>Elimina</span>
              </button>
            </>
          )}
        >
          {/* The section text already says what goes and what stays: only the consequences it doesn't. */}
          <p>Questo browser verrà scollegato da Drive.</p>
          <p>Se usi El Sbobinator anche su altri dispositivi collegati a Drive, scollegali prima: altrimenti quello che modifichi lì tornerà su Drive.</p>
        </InlineConfirm>
      )}
      <SettingsMoreInfo label="Altri modi per eliminarli">
        <p>Da Google Drive sul computer: Impostazioni → Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti.</p>
        <p>
          Per togliere l’accesso all’app:{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">myaccount.google.com/permissions<ExternalLinkIcon /></a>.
        </p>
      </SettingsMoreInfo>
    </SettingsPanel>
  );
};

import React from 'react';
import { ArrowDownToLine, CheckCircle, RefreshCw, Tag, ExternalLink, Loader2 } from 'lucide-react';
import { APP_VERSION, GITHUB_RELEASES_URL } from '../../../branding';

export interface SettingsUpdateInstallState {
  status?: 'idle' | 'downloading' | 'verifying' | 'installing' | 'done' | 'error';
  version?: string | null;
  bytesDone?: number;
  bytesDownloaded?: number;
  bytesTotal?: number;
  totalBytes?: number;
  percent?: number;
  error?: string | null;
}

function formatSettingsUpdateStatus(state?: SettingsUpdateInstallState): string | null {
  if (!state) return null;
  if (state.status === 'downloading') {
    const total = state.bytesTotal ?? state.totalBytes ?? 0;
    const done = state.bytesDone ?? state.bytesDownloaded ?? 0;
    const percent = total > 0 ? ` ${Math.round((done / total) * 100)}%` : '';
    return `Download aggiornamento${percent}…`;
  }
  if (state.status === 'verifying') return 'Verifica integrità aggiornamento…';
  if (state.status === 'installing') return 'Installazione aggiornamento…';
  if (state.status === 'done') return 'Installer avviato. Segui le istruzioni a schermo.';
  if (state.status === 'error') return state.error ?? 'Aggiornamento non riuscito.';
  return null;
}

interface UpdaterSectionProps {
  latestVersion: string | null;
  checkForUpdates: (force?: boolean) => void;
  isCheckingUpdate: boolean;
  hasChecked: boolean;
  checkFailed: boolean;
  updateInstallState?: SettingsUpdateInstallState;
  onInstallUpdate?: (version: string) => Promise<void>;
}

export const UpdaterSection: React.FC<UpdaterSectionProps> = React.memo(({
  latestVersion,
  checkForUpdates,
  isCheckingUpdate,
  hasChecked,
  checkFailed,
  updateInstallState,
  onInstallUpdate,
}) => {
  const isUpdateAvailable = latestVersion && latestVersion !== APP_VERSION;
  const updateStatusMessage = formatSettingsUpdateStatus(updateInstallState);
  const isInstalling = updateInstallState && ['downloading', 'verifying', 'installing'].includes(updateInstallState.status || '');
  const isDone = updateInstallState?.status === 'done';
  const isError = updateInstallState?.status === 'error';

  const handleOpenGitHub = () => {
    if (window.pywebview?.api?.open_url) {
      void window.pywebview.api.open_url('https://github.com/vimuw/El-Sbobinator/releases/latest');
    } else {
      window.open('https://github.com/vimuw/El-Sbobinator/releases/latest', '_blank');
    }
  };

  return (
    <div className="space-y-4 pt-2 border-t border-[var(--border-subtle)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-[var(--accent-text)]" />
          <div>
            <h4 className="text-xs font-semibold text-[var(--text-primary)]">Versione Applicazione</h4>
            <p className="text-[11px] text-[var(--text-muted)]">v{APP_VERSION}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => checkForUpdates(true)}
          disabled={isCheckingUpdate}
          className="app-button-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
        >
          {isCheckingUpdate ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" />
          )}
          {isCheckingUpdate ? 'Controllo...' : 'Cerca Aggiornamenti'}
        </button>
      </div>

      {/* Update Download & Installation Status Banner */}
      {updateStatusMessage && (
        <div className={`p-3 rounded-lg border text-xs space-y-1.5 ${
          isError
            ? 'bg-[var(--error-subtle)] border-[var(--error-ring)] text-[var(--error-text)]'
            : isDone
            ? 'bg-[var(--success-subtle)] border-[var(--success-ring)] text-[var(--success-text)]'
            : 'bg-[var(--accent-subtle)] border-[var(--accent-ring)] text-[var(--text-primary)]'
        }`}>
          <div className="flex items-center gap-2 font-medium">
            {isInstalling && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-text)]" />}
            {isDone && <CheckCircle className="w-3.5 h-3.5 text-[var(--success-text)]" />}
            <span>{updateStatusMessage}</span>
          </div>

          {isError && (
            <div className="pt-1">
              <button
                type="button"
                onClick={handleOpenGitHub}
                className="text-xs underline font-semibold hover:opacity-80 text-[var(--accent-text)]"
              >
                Apri GitHub
              </button>
            </div>
          )}
        </div>
      )}

      {hasChecked && !isCheckingUpdate && (
        <div className="text-xs space-y-2">
          {checkFailed && (
            <p className="text-[var(--error-text)]">Verifica aggiornamenti non riuscita.</p>
          )}

          {isUpdateAvailable && !isInstalling && !isDone && (
            <div className="p-3 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-ring)] flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-[var(--text-primary)] block">Nuova versione disponibile!</span>
                <span className="text-[11px] text-[var(--text-muted)] block">v{latestVersion}</span>
              </div>
              {onInstallUpdate && (
                <button
                  type="button"
                  onClick={() => { void onInstallUpdate(latestVersion).catch(() => {}); }}
                  aria-label="Installa aggiornamento"
                  disabled={updateInstallState?.status === 'downloading'}
                  className="modal-action-button is-primary text-xs px-3 py-1.5 flex items-center gap-1.5 shrink-0"
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  Scarica e Installa
                </button>
              )}
            </div>
          )}

          {!isUpdateAvailable && !checkFailed && !updateStatusMessage && (
            <div className="flex items-center gap-1.5 text-[var(--success-text)] font-medium">
              <CheckCircle className="w-4 h-4" />
              ✓ Sei aggiornato alla versione più recente.
            </div>
          )}
        </div>
      )}

      {/* Release Link */}
      <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1 pt-1">
        <a
          href={GITHUB_RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline text-[var(--accent-text)] inline-flex items-center gap-1"
        >
          Vedi note di rilascio su GitHub
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>
    </div>
  );
});

UpdaterSection.displayName = 'UpdaterSection';

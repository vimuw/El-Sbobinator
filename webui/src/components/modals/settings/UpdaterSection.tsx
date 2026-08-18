import React from 'react';
import { ArrowDownToLine, CheckCircle, RefreshCw, Tag, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
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

const formatVersion = (ver?: string | null): string => {
  if (!ver) return '';
  const clean = ver.trim().replace(/^v+/, '');
  return clean ? `v${clean}` : '';
};

const formatBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
};

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
  const cleanAppVersion = formatVersion(APP_VERSION);
  const cleanLatestVersion = formatVersion(latestVersion);
  const isUpdateAvailable = Boolean(cleanLatestVersion && cleanLatestVersion !== cleanAppVersion);

  const isDownloading = updateInstallState?.status === 'downloading';
  const isVerifying = updateInstallState?.status === 'verifying';
  const isInstalling = updateInstallState?.status === 'installing';
  const isDone = updateInstallState?.status === 'done';
  const isError = updateInstallState?.status === 'error';
  const isInProgress = isDownloading || isVerifying || isInstalling;

  const handleOpenGitHub = () => {
    if (window.pywebview?.api?.open_url) {
      void window.pywebview.api.open_url('https://github.com/vimuw/El-Sbobinator/releases/latest');
    } else {
      window.open('https://github.com/vimuw/El-Sbobinator/releases/latest', '_blank');
    }
  };

  return (
    <div className="space-y-4 pt-3 border-t border-[var(--border-subtle)]">
      {/* Header row: Version Info & Check Icon Button */}
      <div className="flex items-center justify-between">
        <div className="flex items-start gap-3">
          <Tag className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">Versione Applicazione</h4>
            <p className="text-xs text-[var(--text-muted)]">
              Installata: <span className="font-mono font-medium text-[var(--text-secondary)]">{cleanAppVersion}</span>
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => checkForUpdates(true)}
          disabled={isCheckingUpdate || isInProgress}
          aria-label="Cerca aggiornamenti"
          title={isCheckingUpdate ? 'Controllo in corso…' : 'Cerca aggiornamenti'}
          className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-4 h-4 ${isCheckingUpdate ? 'animate-spin text-[var(--accent-text)]' : ''}`} />
        </button>
      </div>

      {/* Update Available Banner Card */}
      {isUpdateAvailable && !isDone && (
        <div className="p-3.5 rounded-xl bg-[var(--accent-subtle)] border border-[var(--accent-ring)] space-y-3">
          {/* Top/Inline Content */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[var(--accent-bg)] text-white tracking-wide uppercase shrink-0">
                  Nuovo
                </span>
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Disponibile: <span className="font-mono text-[var(--accent-text)]">{cleanLatestVersion}</span>
                </span>
              </div>
              <div>
                <a
                  href={GITHUB_RELEASES_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-medium text-[var(--accent-text)] hover:underline inline-flex items-center gap-1 opacity-90 hover:opacity-100 transition-opacity"
                >
                  Note di rilascio su GitHub
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            {/* Action button if not downloading/installing */}
            {!isInProgress && onInstallUpdate && (
              <button
                type="button"
                onClick={() => { void onInstallUpdate(latestVersion!).catch(() => {}); }}
                aria-label="Installa aggiornamento"
                className="modal-action-button is-primary is-compact cursor-pointer shrink-0 font-semibold"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                Aggiorna
              </button>
            )}
          </div>

          {/* Download progress / verifying in progress */}
          {isDownloading && (
            <div className="space-y-2 pt-1">
              {(() => {
                const total = updateInstallState?.bytesTotal ?? updateInstallState?.totalBytes ?? 0;
                const done = updateInstallState?.bytesDone ?? updateInstallState?.bytesDownloaded ?? 0;
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (updateInstallState?.percent ?? 0);
                return (
                  <>
                    <div className="w-full h-2 rounded-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] overflow-hidden">
                      <div
                        className="h-full bg-[var(--accent-bg)] rounded-full transition-all duration-200"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                      <span className="flex items-center gap-1.5 font-medium text-[var(--text-secondary)]">
                        <Loader2 className="w-3 h-3 animate-spin text-[var(--accent-text)]" />
                        Download aggiornamento…
                      </span>
                      <span className="font-mono">{total > 0 ? `${formatBytes(done)} / ${formatBytes(total)} (${pct}%)` : `${pct}%`}</span>
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {(isVerifying || isInstalling) && (
            <div className="flex items-center gap-2 text-xs font-medium text-[var(--text-primary)] pt-1">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
              <span>{isVerifying ? 'Verifica integrità aggiornamento…' : 'Installazione aggiornamento…'}</span>
            </div>
          )}
        </div>
      )}

      {/* Done / Installer Launched Banner */}
      {isDone && (
        <div className="p-3 rounded-xl bg-[var(--success-subtle)] border border-[var(--success-ring)] text-xs text-[var(--success-text)] flex items-center gap-2 font-medium">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>Installer avviato. Segui le istruzioni a schermo.</span>
        </div>
      )}

      {/* Error Banner */}
      {(isError || (hasChecked && checkFailed && !isCheckingUpdate)) && (
        <div className="p-3 rounded-xl bg-[var(--error-subtle)] border border-[var(--error-ring)] text-xs text-[var(--error-text)] space-y-2">
          <div className="flex items-center gap-2 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{updateInstallState?.error || (checkFailed ? 'Verifica aggiornamenti non riuscita.' : 'Aggiornamento non riuscito.')}</span>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => {
                if (isError && onInstallUpdate && latestVersion) {
                  void onInstallUpdate(latestVersion).catch(() => {});
                } else {
                  checkForUpdates(true);
                }
              }}
              className="app-button-secondary text-xs px-2.5 py-1"
            >
              Riprova
            </button>
            <button
              type="button"
              onClick={handleOpenGitHub}
              className="text-xs font-semibold underline hover:opacity-80 text-[var(--accent-text)] px-1"
            >
              Apri GitHub
            </button>
          </div>
        </div>
      )}

      {/* Up to date Banner */}
      {hasChecked && !isCheckingUpdate && !isUpdateAvailable && !checkFailed && !isError && !isDone && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--success-text)] font-medium">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>✓ Sei aggiornato alla versione più recente.</span>
        </div>
      )}

      {/* Fallback GitHub link if no update is available */}
      {!isUpdateAvailable && (
        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
          <a
            href={GITHUB_RELEASES_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline text-[var(--accent-text)] inline-flex items-center gap-1 opacity-80 hover:opacity-100 transition-opacity"
          >
            Vedi note di rilascio su GitHub
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}
    </div>
  );
});

UpdaterSection.displayName = 'UpdaterSection';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, RefreshCw, ExternalLink, Loader2, AlertCircle } from 'lucide-react';
import { APP_VERSION, GITHUB_RELEASES_URL } from '../../../branding';
import { SettingsSectionHeading } from './SettingsLayout';

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
  /** Install progress and outcome appear in one place only: where the install was started. */
  showsInstallFeedback?: boolean;
}

export const UpdaterSection: React.FC<UpdaterSectionProps> = React.memo(({
  latestVersion,
  checkForUpdates,
  isCheckingUpdate,
  hasChecked,
  checkFailed,
  updateInstallState,
  onInstallUpdate,
  showsInstallFeedback = false,
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
  const feedbackRequestedRef = useRef(false);
  // An update already known on opening is offered only by the notice at the top; after a
  // manual check down here, the notice is off screen, so the check button itself becomes
  // the install action.
  const [checkedHere, setCheckedHere] = useState(false);
  const offersUpdateHere = checkedHere && isUpdateAvailable && !isCheckingUpdate && !checkFailed && !isDone && !isInProgress;
  const canInstallHere = offersUpdateHere && Boolean(onInstallUpdate);
  const checkStatusRef = useRef<HTMLDivElement>(null);
  // The download row gains a size readout with the first sized progress event, which can
  // wrap onto a new line on narrow windows, so it counts as a change of feedback too.
  const hasDownloadSize = isDownloading && Boolean(updateInstallState?.bytesTotal ?? updateInstallState?.totalBytes);
  const installFeedbackShape = `${updateInstallState?.status ?? ''}${hasDownloadSize ? ':sized' : ''}`;
  const previousInstallFeedbackShapeRef = useRef(installFeedbackShape);

  useEffect(() => {
    const installStatusChanged = previousInstallFeedbackShapeRef.current !== installFeedbackShape;
    previousInstallFeedbackShapeRef.current = installFeedbackShape;
    const feedback = checkStatusRef.current;
    let shouldReveal = feedbackRequestedRef.current;
    // Keep expanding installation feedback visible only while this section is on screen.
    if (!shouldReveal && installStatusChanged && feedback) {
      const scrollContainer = feedback.closest('.app-scroll');
      if (scrollContainer && feedback.parentElement) {
        const sectionBounds = feedback.parentElement.getBoundingClientRect();
        const viewportBounds = scrollContainer.getBoundingClientRect();
        shouldReveal = sectionBounds.bottom > viewportBounds.top && sectionBounds.top < viewportBounds.bottom;
      }
    }
    if (!shouldReveal || isCheckingUpdate || (!hasChecked && !isInProgress && !isError && !isDone)) return;
    feedbackRequestedRef.current = false;
    if (feedback?.textContent) {
      feedback.scrollIntoView({ block: 'nearest' });
    }
  }, [isCheckingUpdate, hasChecked, latestVersion, checkFailed, isInProgress, isError, isDone, installFeedbackShape]);

  return (
    <div role="region" aria-label="Versione e aggiornamenti" className="space-y-3">
      {/* Header row: Version Info & Check Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <SettingsSectionHeading>Versione e aggiornamenti</SettingsSectionHeading>
          <p className="text-xs text-[var(--text-secondary)]">
            Installata:{' '}
            <span className="font-mono font-bold text-[var(--text-primary)]">{cleanAppVersion}</span>
            {offersUpdateHere && (
              <>
                <span aria-hidden="true" className="mx-1.5">→</span>
                <span className="sr-only">disponibile </span>
                <span className="font-mono font-bold text-[var(--accent-text)]">{cleanLatestVersion}</span>
              </>
            )}
            {/* With an update pending, the notice at the top of the page links the notes,
                unless that notice is off screen behind a manual check down here. */}
            {(!isUpdateAvailable || offersUpdateHere) && <a
              href={GITHUB_RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-2 hover:underline text-[var(--accent-text)] font-semibold inline-flex items-center gap-0.5"
            >
              Note di rilascio ↗
            </a>}
          </p>
        </div>

        {/* One button in one place: the check action turns into the install action, so focus
            stays on the control the user just pressed. */}
        {canInstallHere ? (
          <button
            type="button"
            onClick={() => {
              feedbackRequestedRef.current = true;
              void Promise.resolve(onInstallUpdate!(latestVersion!)).catch(() => {});
            }}
            className="settings-pill-button animate-fade-in"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>Aggiorna a {cleanLatestVersion}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              feedbackRequestedRef.current = true;
              setCheckedHere(true);
              checkForUpdates(true);
            }}
            disabled={isCheckingUpdate || isInProgress}
            aria-label="Cerca aggiornamenti"
            title={isCheckingUpdate ? 'Controllo in corso…' : 'Cerca aggiornamenti'}
            className="app-button-secondary is-settings-action"
          >
            <RefreshCw
              className={`w-4 h-4 transition-transform duration-500 ease-out ${
                isCheckingUpdate
                  ? 'animate-spin text-[var(--accent-text)]'
                  : 'settings-refresh-icon'
              }`}
            />
            <span>{isCheckingUpdate ? 'Controllo in corso…' : 'Cerca aggiornamenti'}</span>
          </button>
        )}
      </div>

      <div ref={checkStatusRef} role="status" aria-atomic="true" className="space-y-3 scroll-mb-4">
        {offersUpdateHere && <span className="sr-only">È disponibile la versione {cleanLatestVersion}.</span>}

        {/* Error Banner */}
        {hasChecked && checkFailed && !isCheckingUpdate && !isError && !isInProgress && !isDone && (
          <div className="alert-card is-error text-xs flex-row items-center gap-2 p-3 font-bold animate-fade-in">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Verifica aggiornamenti non riuscita.</span>
          </div>
        )}

        {/* Up to date Banner */}
        {hasChecked && !isCheckingUpdate && !isUpdateAvailable && !checkFailed && !isError && !isDone && !isInProgress && (
          <div className="flex items-center gap-2 text-xs text-[var(--success-text)] font-bold">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>Sei aggiornato alla versione più recente.</span>
          </div>
        )}
        {showsInstallFeedback && <UpdateInstallFeedback state={updateInstallState} />}
      </div>
    </div>
  );
});

UpdaterSection.displayName = 'UpdaterSection';

export const UpdateNotice: React.FC<Pick<UpdaterSectionProps, 'latestVersion' | 'updateInstallState' | 'onInstallUpdate' | 'showsInstallFeedback'>> = React.memo(({
  latestVersion,
  updateInstallState,
  onInstallUpdate,
  showsInstallFeedback = true,
}) => {
  const cleanLatestVersion = formatVersion(latestVersion);
  const isUpdateAvailable = Boolean(cleanLatestVersion && cleanLatestVersion !== formatVersion(APP_VERSION));
  const isDownloading = updateInstallState?.status === 'downloading';
  const isVerifying = updateInstallState?.status === 'verifying';
  const isInstalling = updateInstallState?.status === 'installing';
  const isDone = updateInstallState?.status === 'done';
  const isError = updateInstallState?.status === 'error';
  const isInProgress = isDownloading || isVerifying || isInstalling;

  const showsCard = isUpdateAvailable && !isDone;
  const showsOutcome = (isDone || isError) && showsInstallFeedback;
  if (!showsCard && !showsOutcome) return null;

  return (
    <div role="region" aria-label="Aggiornamento applicazione" className="space-y-3">
      {/* Update Available Banner Card */}
      {showsCard && (
        <div className="p-4 rounded-lg bg-[var(--accent-subtle)] border border-[var(--border-subtle)] space-y-3 relative overflow-hidden">
          {/* Top/Inline Content */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1 basis-64">
              <div aria-hidden="true" className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--bg-surface)] border border-[var(--accent-ring)] text-[var(--accent-text)] shrink-0">
                <ArrowDownToLine className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-base font-bold text-[var(--text-primary)] leading-tight">
                    Nuova versione disponibile
                  </h4>
                  <span className="text-xs font-bold font-mono text-[var(--accent-text)] shrink-0">
                    {cleanLatestVersion}
                  </span>
                </div>

                <div>
                  <a
                    href={GITHUB_RELEASES_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-semibold text-[var(--accent-text)] hover:underline inline-flex items-center gap-1 transition-colors"
                  >
                    Note di rilascio su GitHub
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Action button if not downloading/installing */}
            {!isInProgress && onInstallUpdate && (
              <InstallUpdateButton version={latestVersion!} onInstallUpdate={onInstallUpdate} />
            )}
          </div>

          {isInProgress && showsInstallFeedback && <UpdateInstallFeedback state={updateInstallState} />}
        </div>
      )}

      {showsOutcome && <UpdateInstallFeedback state={updateInstallState} />}
    </div>
  );
});

UpdateNotice.displayName = 'UpdateNotice';

function InstallUpdateButton({ version, onInstallUpdate }: {
  version: string;
  onInstallUpdate: (version: string) => Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        void Promise.resolve(onInstallUpdate(version)).catch(() => {});
      }}
      aria-label="Installa aggiornamento"
      className="settings-pill-button"
    >
      <ArrowDownToLine className="w-3.5 h-3.5" />
      Aggiorna ora
    </button>
  );
}

function UpdateInstallFeedback({ state }: { state?: SettingsUpdateInstallState }) {
  if (state?.status === 'downloading') {
    const total = state.bytesTotal ?? state.totalBytes ?? 0;
    const done = state.bytesDone ?? state.bytesDownloaded ?? 0;
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : (state.percent ?? 0);
    return (
      <div className="space-y-2 pt-1">
        <div
          role="progressbar"
          aria-label="Download aggiornamento"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="w-full h-1.5 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] overflow-hidden"
        >
          <div
            className="h-full bg-[var(--accent-bg)] rounded-full transition-all duration-200"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
          <span className="flex items-center gap-1.5 font-bold text-[var(--text-primary)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-text)]" />
            Download aggiornamento…
          </span>
          <span className="font-mono font-medium">{total > 0 ? `${formatBytes(done)} / ${formatBytes(total)} (${pct}%)` : `${pct}%`}</span>
        </div>
      </div>
    );
  }
  if (state?.status === 'verifying' || state?.status === 'installing') {
    return (
      <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-primary)] pt-1">
        <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
        <span>{state.status === 'verifying' ? 'Verifica integrità aggiornamento…' : 'Installazione aggiornamento…'}</span>
      </div>
    );
  }
  if (state?.status === 'done') {
    return (
      <div className="alert-card is-success text-xs flex-row items-center gap-2 p-3 font-bold animate-fade-in">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Installer avviato. Segui le istruzioni a schermo.</span>
      </div>
    );
  }
  if (state?.status === 'error') {
    return (
      <div className="alert-card is-error text-xs flex-row items-center gap-2 p-3 font-bold animate-fade-in">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span>{state.error || 'Aggiornamento non riuscito.'}</span>
      </div>
    );
  }
  return null;
}

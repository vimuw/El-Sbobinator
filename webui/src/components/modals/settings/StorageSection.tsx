import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, FolderInput, FolderOpen, Info, Loader2, Trash2, X } from 'lucide-react';
import { SettingsSectionHeading } from './SettingsLayout';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

interface StorageSectionProps {
  sessionInfo: { total_bytes: number; total_sessions: number; session_root: string; usage_detail?: string } | null;
  isLoadingSessionInfo?: boolean;
  isMoveInProgress: boolean;
  moveProgress: { moved: number; total: number } | null;
  moveError: string | null;
  onOpenSessionFolder: () => void;
  onAskMoveFolder: () => void;
  isCleaningSession: boolean;
  cleanupResult: { removed: number; freed_bytes: number } | null;
  onAskCleanup: () => void;
  onDismissCleanupResult?: () => void;
  canManageSessionFolder?: boolean;
  /** Web build: everything lives in this browser's storage, not in a folder on disk. */
  inBrowser?: boolean;
}

export const StorageSection: React.FC<StorageSectionProps> = React.memo(({
  sessionInfo,
  isLoadingSessionInfo,
  isMoveInProgress,
  moveProgress,
  moveError,
  onOpenSessionFolder,
  onAskMoveFolder,
  isCleaningSession,
  cleanupResult,
  onAskCleanup,
  onDismissCleanupResult,
  canManageSessionFolder = true,
  inBrowser = false,
}) => {
  return (
    <div className="space-y-6">
      {/* 1. Posizione cartella e spazio occupato */}
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5 min-w-0">
              <SettingsSectionHeading>{inBrowser ? 'Spazio in questo browser' : 'Cartella sessioni'}</SettingsSectionHeading>
              <p className="text-xs text-[var(--text-secondary)]">
                {inBrowser
                  ? 'Sbobine, audio delle lezioni e avanzamento delle elaborazioni restano in questo browser, su questo dispositivo.'
                  : 'Posizione su disco delle trascrizioni e dei file di lavoro.'}
              </p>
            </div>
            {canManageSessionFolder && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onOpenSessionFolder}
                  title="Apri cartella sessioni"
                  className="app-button-secondary is-settings-action"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>Apri</span>
                </button>
                <button
                  type="button"
                  onClick={onAskMoveFolder}
                  disabled={isMoveInProgress}
                  aria-label="Cambia cartella"
                  title="Cambia cartella"
                  className="app-button-secondary is-settings-action"
                >
                  {isMoveInProgress ? (
                    <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
                  ) : (
                    <FolderInput className="w-4 h-4" />
                  )}
                  <span>Cambia cartella</span>
                </button>
              </div>
            )}
          </div>

          <div className={`p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-xs break-all text-[var(--text-primary)] font-medium${inBrowser ? '' : ' font-mono'}`}>
            {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
          </div>

          <p data-testid="storage-usage" className="text-xs text-[var(--text-secondary)]">
            {isLoadingSessionInfo
              ? 'Calcolo dello spazio occupato…'
              : sessionInfo
                ? `${sessionInfo.total_sessions} ${sessionInfo.total_sessions === 1 ? 'sbobina' : 'sbobine'} · ${formatSize(sessionInfo.total_bytes)} occupati`
                : 'Spazio occupato non disponibile.'}
          </p>

          {!isLoadingSessionInfo && sessionInfo?.usage_detail && (
            <p data-testid="storage-usage-detail" className="text-xs text-[var(--text-secondary)]">
              {sessionInfo.usage_detail}
            </p>
          )}

          {isMoveInProgress && (
            <div className="alert-card is-info text-xs space-y-2">
              <div className="flex items-center justify-between text-[var(--accent-text)] font-medium">
                <span>Spostamento cartella in corso...</span>
                {moveProgress && moveProgress.total > 0 && (
                  <span>{moveProgress.moved} / {moveProgress.total} file</span>
                )}
              </div>
              <div className="w-full h-2 bg-[var(--bg-surface)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-bg)] transition-all duration-300"
                  style={{
                    width: `${
                      moveProgress && moveProgress.total > 0
                        ? Math.round((moveProgress.moved / moveProgress.total) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {moveError && (
            <div className="alert-card is-error text-xs font-medium">
              {moveError}
            </div>
          )}
        </div>
      </div>

      {/* 2. Pulizia delle elaborazioni incomplete (the web build has no session folders to clean) */}
      {!inBrowser && (
        <div className="border-t border-[var(--border-default)] pt-6 space-y-3">
          <SettingsSectionHeading>Pulizia archivio</SettingsSectionHeading>

          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg hover:bg-[var(--bg-hover)] transition-colors -mx-2">
            <div className="space-y-0.5 min-w-0">
              <span className="text-sm font-bold text-[var(--text-primary)] block">
                Elaborazioni incomplete
              </span>
              <p className="text-xs text-[var(--text-secondary)]">
                Sbobine interrotte o non finite. Dopo la pulizia non si potranno più riprendere.
              </p>
            </div>
            <button
              type="button"
              onClick={onAskCleanup}
              disabled={isCleaningSession}
              aria-label="Pulisci elaborazioni incomplete"
              title="Conta ed elimina tutte le elaborazioni incomplete"
              className="app-button-secondary is-settings-action is-icon is-danger"
            >
              {isCleaningSession ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--error-text)]" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Cleanup Results Feedback Notification Banner */}
          <AnimatePresence>
            {cleanupResult && (
              <motion.div
                initial={{ opacity: 0, y: -6, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, y: -6, height: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="overflow-hidden"
              >
                <div
                  className={`relative alert-card ${cleanupResult.removed > 0 ? 'is-success' : 'is-info'} !flex-row items-start justify-between gap-3`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 pr-6">
                    {cleanupResult.removed > 0 ? (
                      <CheckCircle2 className="w-4 h-4 text-[var(--success-text)] shrink-0 mt-0.5" />
                    ) : (
                      <Info className="w-4 h-4 text-[var(--text-secondary)] shrink-0 mt-0.5" />
                    )}
                    <p
                      className={`text-xs ${cleanupResult.removed > 0 ? 'font-semibold text-[var(--success-text)]' : 'font-medium text-[var(--text-secondary)]'}`}
                    >
                      {cleanupResult.removed > 0
                        ? cleanupResult.removed === 1
                          ? `Rimossa 1 elaborazione incompleta, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                          : `Rimosse ${cleanupResult.removed} elaborazioni incomplete, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                        : 'Nessuna elaborazione incompleta da eliminare.'}
                    </p>
                  </div>

                  {onDismissCleanupResult && (
                    <button
                      type="button"
                      onClick={onDismissCleanupResult}
                      aria-label="Chiudi notifica"
                      title="Chiudi notifica"
                      className="absolute top-2.5 right-2.5 p-1 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer shrink-0"
                    >
                      <X className="w-4 h-4 shrink-0" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
});

StorageSection.displayName = 'StorageSection';

import React from 'react';
import { Database, Folder, Loader2 } from 'lucide-react';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

const SESSION_CLEANUP_DAYS = 30;

interface StorageSectionProps {
  sessionInfo: { total_bytes: number; total_sessions: number; session_root: string } | null;
  isLoadingSessionInfo?: boolean;
  isMoveInProgress: boolean;
  moveProgress: { moved: number; total: number } | null;
  moveError: string | null;
  onOpenSessionFolder: () => void;
  onAskMoveFolder: () => void;
  isCleaningSession: boolean;
  isCleaningCompletedSessions: boolean;
  cleanupPreview: { removed: number; freed_bytes: number; candidates?: number } | null;
  completedCleanupPreview: { removed: number; freed_bytes: number; candidates?: number } | null;
  cleanupResult: { removed: number; freed_bytes: number; candidates?: number; preserved_completed?: number; missing_completed_html?: number } | null;
  completedCleanupResult?: { removed: number; freed_bytes: number; candidates?: number } | null;
  onAskCleanup: () => void;
  onAskCompletedCleanup: () => void;
}

export const StorageSection: React.FC<StorageSectionProps> = ({
  sessionInfo,
  isLoadingSessionInfo,
  isMoveInProgress,
  moveProgress,
  moveError,
  onOpenSessionFolder,
  onAskMoveFolder,
  isCleaningSession,
  isCleaningCompletedSessions,
  cleanupPreview: _cleanupPreview,
  completedCleanupPreview: _completedCleanupPreview,
  cleanupResult,
  completedCleanupResult,
  onAskCleanup,
  onAskCompletedCleanup,
}) => {
  return (
    <div className="space-y-6">
      {/* Storage Information Card */}
      <div className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[var(--accent-subtle)] text-[var(--accent-color)]">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)]">Spazio Disco Sessioni</h3>
            <p className="text-xs text-[var(--text-muted)]">
              Sbobine salvate localmente e file temporanei.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[var(--border-subtle)]">
          <div>
            <span className="text-xs text-[var(--text-muted)] block">Dimensione Totale</span>
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {isLoadingSessionInfo ? 'Calcolo…' : sessionInfo ? formatSize(sessionInfo.total_bytes) : '—'}
            </span>
          </div>
          <div>
            <span className="text-xs text-[var(--text-muted)] block">Totale Sbobine</span>
            <span className="text-lg font-bold text-[var(--text-primary)]">
              {sessionInfo ? `${sessionInfo.total_sessions} ${sessionInfo.total_sessions === 1 ? 'sessione' : 'sessioni'}` : '—'}
            </span>
          </div>
        </div>

        <div className="pt-2 border-t border-[var(--border-subtle)] text-xs space-y-2">
          <span className="text-[var(--text-muted)] block font-medium">Cartella Corrente:</span>
          <div
            onClick={onOpenSessionFolder}
            title="Apri cartella sessioni"
            className="p-2 rounded bg-[var(--bg-surface)] font-mono text-[11px] break-all text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-pointer hover:underline"
          >
            {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={onOpenSessionFolder}
              className="app-button-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
            >
              <Folder className="w-3.5 h-3.5" />
              Apri Cartella
            </button>
            <button
              type="button"
              onClick={onAskMoveFolder}
              disabled={isMoveInProgress}
              className="app-button-secondary text-xs px-3 py-1.5"
            >
              {isMoveInProgress ? 'Spostamento...' : 'Cambia Cartella'}
            </button>
          </div>
        </div>

        {isMoveInProgress && (
          <div className="p-3 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-color)]/20 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-[var(--accent-color)] font-medium">
              <span>Spostamento cartella in corso...</span>
              {moveProgress && moveProgress.total > 0 && (
                <span>{moveProgress.moved} / {moveProgress.total} file</span>
              )}
            </div>
            <div className="w-full h-1.5 bg-[var(--bg-panel)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--accent-color)] transition-all duration-300"
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
          <div className="p-3 rounded-lg bg-[var(--color-rose)]/10 border border-[var(--color-rose)]/20 text-xs text-[var(--color-rose)] font-medium">
            {moveError}
          </div>
        )}
      </div>

      {/* Storage Cleanup Section */}
      <div className="p-4 rounded-xl bg-[var(--bg-panel)] border border-[var(--border-subtle)] space-y-4">
        <div>
          <h3 className="font-semibold text-sm text-[var(--text-primary)]">Manutenzione e Pulizia</h3>
          <p className="text-xs text-[var(--text-muted)]">
            Rimuovi file temporanei di elaborazioni vecchie di oltre {SESSION_CLEANUP_DAYS} giorni per liberare spazio.
          </p>
        </div>

        {(cleanupResult || completedCleanupResult) && (
          <div className="space-y-1.5 bg-[var(--bg-panel)] rounded-lg p-3 border border-[var(--border-subtle)]">
            {cleanupResult && (
              <>
                <p className="text-xs font-medium" style={{ color: cleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                  {cleanupResult.removed > 0
                    ? `Rimossa ${cleanupResult.removed} elaborazione incompleta, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                    : 'Nessuna elaborazione incompleta da eliminare.'}
                </p>
                {(cleanupResult?.preserved_completed ?? 0) > 0 && (
                  <p className="text-xs text-[var(--text-muted)]">
                    {cleanupResult?.preserved_completed} sbobine completate preservate.
                  </p>
                )}
                {(cleanupResult?.missing_completed_html ?? 0) > 0 && (
                  <p className="text-xs text-[var(--warning-text)]">
                    {cleanupResult?.missing_completed_html} sessioni completate senza HTML finale trattate come incomplete.
                  </p>
                )}
              </>
            )}
            {completedCleanupResult && (
              <p className="text-xs font-medium" style={{ color: completedCleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-muted)' }}>
                {completedCleanupResult.removed > 0
                  ? `Eliminate ${completedCleanupResult.removed} sbobine completate, liberati ${formatSize(completedCleanupResult.freed_bytes)}.`
                  : 'Nessuna sbobina completata vecchia da eliminare.'}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onAskCleanup}
            disabled={isCleaningSession}
            title="Conta ed elimina elaborazioni incomplete"
            className="modal-action-button text-xs px-3 py-2 flex items-center gap-1.5"
          >
            {isCleaningSession && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Pulisci Sessioni Incomplete
          </button>
          <button
            type="button"
            onClick={onAskCompletedCleanup}
            disabled={isCleaningCompletedSessions}
            title="Conta ed elimina sbobine completate"
            className="modal-action-button text-xs px-3 py-2 flex items-center gap-1.5 text-[var(--error-text)]"
          >
            {isCleaningCompletedSessions && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Pulisci Sbobine Completate Vecchie
          </button>
        </div>
      </div>
    </div>
  );
};

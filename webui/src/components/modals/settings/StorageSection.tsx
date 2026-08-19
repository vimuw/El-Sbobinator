import React from 'react';
import { Database, Folder, FolderInput, Loader2, Trash2 } from 'lucide-react';

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

export const StorageSection: React.FC<StorageSectionProps> = React.memo(({
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
    <div className="p-4 rounded-xl border border-[var(--border-subtle)] space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2 mb-0.5">
          <Database className="w-4 h-4 text-[var(--accent-text)]" />
          Spazio Disco e Sessioni
        </h3>
        <p className="text-xs text-[var(--text-muted)]">
          Gestione dell&apos;archivio locale, cartella di salvataggio e pulizia dati.
        </p>
      </div>

      {/* Stat Tiles */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5">
          <span className="text-[11px] text-[var(--text-muted)] block">
            Dimensione Totale
          </span>
          <span className="text-base font-medium text-[var(--text-primary)] block">
            {isLoadingSessionInfo ? 'Calcolo…' : sessionInfo ? formatSize(sessionInfo.total_bytes) : '—'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5">
          <span className="text-[11px] text-[var(--text-muted)] block">
            Totale Sbobine
          </span>
          <span className="text-base font-medium text-[var(--text-primary)] block">
            {sessionInfo ? `${sessionInfo.total_sessions} ${sessionInfo.total_sessions === 1 ? 'sessione' : 'sessioni'}` : '—'}
          </span>
        </div>
      </div>

      {/* Row: Sessions Folder */}
      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <span className="text-xs font-semibold text-[var(--text-primary)] block">
              Cartella Sessioni
            </span>
            <p className="text-[11px] text-[var(--text-muted)]">
              Posizione su disco delle trascrizioni e dei file di lavoro.
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onOpenSessionFolder}
              aria-label="Apri cartella"
              title="Apri cartella"
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active-bg)] transition-all shrink-0"
            >
              <Folder className="w-4 h-4" />
              <span className="sr-only">Apri Cartella</span>
            </button>
            <button
              type="button"
              onClick={onAskMoveFolder}
              disabled={isMoveInProgress}
              aria-label="Cambia Cartella"
              title="Cambia Cartella"
              className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active-bg)] transition-all disabled:opacity-40 shrink-0"
            >
              {isMoveInProgress ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
              ) : (
                <FolderInput className="w-4 h-4" />
              )}
              <span className="sr-only">Cambia Cartella</span>
            </button>
          </div>
        </div>

        <div
          onClick={onOpenSessionFolder}
          title="Apri cartella sessioni"
          className="p-2 rounded-lg bg-[var(--bg-input)] font-mono text-[11px] break-all text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--accent-ring)] hover:underline transition-colors"
        >
          {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
        </div>

        {isMoveInProgress && (
          <div className="p-3 rounded-lg bg-[var(--accent-subtle)] border border-[var(--accent-color)]/20 text-xs space-y-1.5">
            <div className="flex items-center justify-between text-[var(--accent-color)] font-medium">
              <span>Spostamento cartella in corso...</span>
              {moveProgress && moveProgress.total > 0 && (
                <span>{moveProgress.moved} / {moveProgress.total} file</span>
              )}
            </div>
            <div className="w-full h-1.5 bg-[var(--bg-input)] rounded-full overflow-hidden">
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
          <div className="p-3 rounded-lg bg-[var(--error-subtle)] border border-[var(--error-ring)] text-xs text-[var(--error-text)] font-medium">
            {moveError}
          </div>
        )}
      </div>

      {/* Section: Cleanup / Deletion */}
      <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
        <div className="space-y-0.5">
          <span className="text-xs font-semibold text-[var(--text-primary)] block">
            Eliminazione e Pulizia Sbobine
          </span>
          <p className="text-[11px] text-[var(--text-muted)]">
            Rimuovi bozze interrotte o vecchie sbobine per liberare spazio su disco.
          </p>
        </div>

        <div className="space-y-2">
          {/* Row: Incomplete Sessions */}
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)]">
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Sessioni incomplete
              </span>
              <p className="text-[11px] text-[var(--text-muted)]">
                File temporanei e bozze interrotte
              </p>
            </div>
            <button
              type="button"
              onClick={onAskCleanup}
              disabled={isCleaningSession}
              aria-label="Pulisci sessioni incomplete"
              title="Conta ed elimina tutte le elaborazioni incomplete"
              className="p-2 rounded-lg text-[var(--error-text)] hover:bg-[var(--error-subtle)] transition-all disabled:opacity-40 shrink-0"
            >
              {isCleaningSession ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--error-text)]" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Row: Old Completed Sessions */}
          <div className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)]">
            <div className="space-y-0.5 min-w-0">
              <span className="text-xs font-semibold text-[var(--text-primary)] block">
                Sbobine completate vecchie
              </span>
              <p className="text-[11px] text-[var(--text-muted)]">
                Sbobine completate salvate da oltre {SESSION_CLEANUP_DAYS} giorni
              </p>
            </div>
            <button
              type="button"
              onClick={onAskCompletedCleanup}
              disabled={isCleaningCompletedSessions}
              aria-label={`Elimina sbobine completate vecchie di oltre ${SESSION_CLEANUP_DAYS} giorni`}
              title={`Conta ed elimina sbobine completate vecchie di oltre ${SESSION_CLEANUP_DAYS} giorni`}
              className="p-2 rounded-lg text-[var(--error-text)] hover:bg-[var(--error-subtle)] transition-all disabled:opacity-40 shrink-0"
            >
              {isCleaningCompletedSessions ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--error-text)]" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Cleanup Results Feedback */}
      {(cleanupResult || completedCleanupResult) && (
        <div className="pt-3 border-t border-[var(--border-subtle)]">
          <div className="space-y-1.5 bg-[var(--bg-input)] rounded-lg p-3 border border-[var(--border-subtle)]">
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
        </div>
      )}
    </div>
  );
});

StorageSection.displayName = 'StorageSection';

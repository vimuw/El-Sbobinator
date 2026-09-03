import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Database, FolderInput, FolderOpen, Info, Loader2, Trash2, X } from 'lucide-react';

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
  onDismissCleanupResult?: () => void;
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
  onDismissCleanupResult,
}) => {
  return (
    <div className="space-y-5">
      {/* 1. Spazio Disco e Posizione Cartella */}
      <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
        {/* Header */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Database className="w-4 h-4 text-[var(--accent-text)]" />
            Spazio Disco e Sessioni
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Statistiche di utilizzo dell&apos;archivio locale e posizione della cartella di salvataggio.
          </p>
        </div>

      {/* Stat Tiles */}
      <div className="grid grid-cols-2 gap-3 pt-1">
        <div className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5">
          <span className="text-[11px] text-[var(--text-muted)] block">
            Dimensione Totale
          </span>
          <span className="text-base font-semibold text-[var(--text-primary)] block">
            {isLoadingSessionInfo ? 'Calcolo…' : sessionInfo ? formatSize(sessionInfo.total_bytes) : '—'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5">
          <span className="text-[11px] text-[var(--text-muted)] block">
            Totale Sbobine
          </span>
          <span className="text-base font-semibold text-[var(--text-primary)] block">
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
          <button
            type="button"
            onClick={onAskMoveFolder}
            disabled={isMoveInProgress}
            aria-label="Cambia Cartella"
            title="Cambia Cartella"
            className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active-bg)] transition-colors disabled:opacity-40 shrink-0"
          >
            {isMoveInProgress ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            ) : (
              <FolderInput className="w-4 h-4" />
            )}
            <span className="sr-only">Cambia Cartella</span>
          </button>
        </div>

        <div
          onClick={onOpenSessionFolder}
          title="Apri cartella sessioni"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onOpenSessionFolder();
            }
          }}
          className="flex items-center justify-between gap-2 p-2 rounded-lg bg-[var(--bg-input)] font-mono text-[11px] break-all text-[var(--text-secondary)] border border-[var(--border-subtle)] cursor-pointer hover:border-[var(--accent-ring)] hover:text-[var(--text-primary)] group transition-colors"
        >
          <span className="font-mono text-[11px] break-all group-hover:underline">
            {sessionInfo?.session_root || (isLoadingSessionInfo ? '…' : '—')}
          </span>
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-[var(--text-muted)] group-hover:text-[var(--text-primary)] transition-colors" />
        </div>

        {isMoveInProgress && (
          <div className="alert-card is-info text-xs space-y-1.5">
            <div className="flex items-center justify-between text-[var(--accent-text)] font-medium">
              <span>Spostamento cartella in corso...</span>
              {moveProgress && moveProgress.total > 0 && (
                <span>{moveProgress.moved} / {moveProgress.total} file</span>
              )}
            </div>
            <div className="w-full h-1.5 bg-[var(--bg-surface)] rounded-full overflow-hidden">
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

      {/* 2. Eliminazione e Pulizia Sbobine */}
      <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
        {/* Header */}
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-[var(--accent-text)]" />
            Eliminazione e Pulizia Sbobine
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Rimuovi bozze interrotte o vecchie sbobine per liberare spazio su disco.
          </p>
        </div>

        <div className="space-y-2 pt-1">
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
              className="p-1.5 rounded-lg text-[var(--error-text)] hover:bg-[var(--error-subtle)] transition-colors disabled:opacity-40 shrink-0"
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
              className="p-1.5 rounded-lg text-[var(--error-text)] hover:bg-[var(--error-subtle)] transition-colors disabled:opacity-40 shrink-0"
            >
              {isCleaningCompletedSessions ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--error-text)]" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

      {/* Cleanup Results Feedback Notification Banner */}
      <AnimatePresence>
        {(cleanupResult || completedCleanupResult) && (
          <motion.div
            initial={{ opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, y: -6, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div
              className={`relative alert-card ${
                (cleanupResult?.removed ?? 0) > 0 || (completedCleanupResult?.removed ?? 0) > 0
                  ? 'is-success'
                  : 'is-info'
              } !flex-row items-start justify-between gap-3`}
            >
              <div className="flex items-start gap-2.5 min-w-0 pr-6">
                {(cleanupResult?.removed ?? 0) > 0 || (completedCleanupResult?.removed ?? 0) > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--success-text)] shrink-0 mt-0.5" />
                ) : (
                  <Info className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                )}
                <div className="space-y-0.5 min-w-0">
                  {cleanupResult && (
                    <>
                      <p
                        className="text-xs font-semibold"
                        style={{ color: cleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-primary)' }}
                      >
                        {cleanupResult.removed > 0
                          ? cleanupResult.removed === 1
                            ? `Rimossa 1 elaborazione incompleta, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                            : `Rimosse ${cleanupResult.removed} elaborazioni incomplete, liberati ${formatSize(cleanupResult.freed_bytes)}.`
                          : 'Nessuna elaborazione incompleta da eliminare.'}
                      </p>
                      {(cleanupResult?.preserved_completed ?? 0) > 0 && (
                        <p className="text-[11px] text-[var(--text-muted)]">
                          {cleanupResult.preserved_completed} sbobine completate preservate.
                        </p>
                      )}
                      {(cleanupResult?.missing_completed_html ?? 0) > 0 && (
                        <p className="text-[11px] text-[var(--warning-text)]">
                          {cleanupResult.missing_completed_html} sessioni completate senza HTML finale trattate come incomplete.
                        </p>
                      )}
                    </>
                  )}
                  {completedCleanupResult && (
                    <p
                      className="text-xs font-semibold"
                      style={{ color: completedCleanupResult.removed > 0 ? 'var(--success-text)' : 'var(--text-primary)' }}
                    >
                      {completedCleanupResult.removed > 0
                        ? completedCleanupResult.removed === 1
                          ? `Eliminata 1 sbobina completata, liberati ${formatSize(completedCleanupResult.freed_bytes)}.`
                          : `Eliminate ${completedCleanupResult.removed} sbobine completate, liberati ${formatSize(completedCleanupResult.freed_bytes)}.`
                        : 'Nessuna sbobina completata vecchia da eliminare.'}
                    </p>
                  )}
                </div>
              </div>

              {onDismissCleanupResult && (
                <button
                  type="button"
                  onClick={onDismissCleanupResult}
                  aria-label="Chiudi notifica"
                  title="Chiudi notifica"
                  className="group/close absolute top-2.5 right-2.5 p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--sidebar-active-bg)] transition-colors cursor-pointer shrink-0"
                >
                  <X className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-hover/close:scale-110 group-hover/close:rotate-90" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </div>
  );
});

StorageSection.displayName = 'StorageSection';

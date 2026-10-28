import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, CheckCircle2, FolderInput, FolderOpen, HardDrive, Info, Loader2, ShieldCheck, Trash2, X } from 'lucide-react';
import type { StorageUsagePart } from '../../../bridge';
import { formatSize } from '../../../utils';
import { SettingsCallout, SettingsMoreInfo, SettingsPanel, SettingsSectionHeading, StatusBadge } from './SettingsLayout';

interface StorageSectionProps {
  sessionInfo: {
    total_bytes: number;
    total_sessions: number;
    session_root: string;
    usage_detail?: string;
    usage_breakdown?: StorageUsagePart[];
    browser_estimate_bytes?: number;
    persisted?: boolean;
  } | null;
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
  /** Web build: whether Google Drive sync exists here and is linked; it changes what the warning suggests. */
  drive?: 'unavailable' | 'disconnected' | 'connected';
  /** Web build: opens Impostazioni → Sincronizzazione from the warning. */
  onOpenDrive?: () => void;
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
  drive,
  onOpenDrive,
}) => {
  if (inBrowser) return <WebSpacePanel sessionInfo={sessionInfo} isLoadingSessionInfo={isLoadingSessionInfo} drive={drive} onOpenDrive={onOpenDrive} />;
  return (
    <div className="space-y-6">
      {/* 1. Posizione cartella e spazio occupato */}
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2 min-w-0">
              <SettingsSectionHeading icon={HardDrive}>Cartella sessioni</SettingsSectionHeading>
              <p className="text-xs text-[var(--text-secondary)]">
                Posizione su disco delle trascrizioni e dei file di lavoro.
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

          <div className="p-2.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] text-xs break-all text-[var(--text-primary)] font-medium font-mono">
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

      {/* 2. Pulizia delle elaborazioni incomplete */}

        <div className="border-t border-[var(--border-default)] pt-6 space-y-3">
          <SettingsSectionHeading icon={Trash2}>Pulizia archivio</SettingsSectionHeading>

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

    </div>
  );
});

StorageSection.displayName = 'StorageSection';

// Web build: everything lives in this browser's storage, not in a folder on disk, and there is no
// folder to open, move or clean. The count and the total come first, then what takes that space.
// Drive keeps the texts but never the lecture audio (web/drive/syncFormat.ts), and the warning says so.
function WebSpacePanel({ sessionInfo, isLoadingSessionInfo, drive = 'unavailable', onOpenDrive }: Pick<StorageSectionProps, 'sessionInfo' | 'isLoadingSessionInfo' | 'drive' | 'onOpenDrive'>) {
  const ready = !isLoadingSessionInfo && sessionInfo;
  const onDrive = drive === 'connected';
  return (
    <SettingsPanel
      icon={HardDrive}
      title="Le tue sbobine"
      description="Sbobine, audio delle lezioni e avanzamento delle elaborazioni sono salvati in questo browser, su questo dispositivo."
      badge={ready && sessionInfo.persisted === true
        ? <StatusBadge tone="success"><ShieldCheck className="w-3 h-3" aria-hidden="true" />Protette</StatusBadge>
        : ready && sessionInfo.persisted === false
          ? onDrive
            ? (
              // Says what is safe, in the words of the note below: "Copia su Drive" read like a button.
              <StatusBadge tone="success" title="Le sbobine hanno una copia nel tuo Google Drive. Gli audio delle lezioni no.">
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />Salvate anche su Drive
              </StatusBadge>
            )
            : <StatusBadge tone="warning"><AlertTriangle className="w-3 h-3" aria-hidden="true" />Non protette</StatusBadge>
          : undefined}
    >
      {ready ? <WebUsageSummary info={sessionInfo} /> : (
        <p data-testid="storage-usage" className="text-xs text-[var(--text-secondary)]">
          {isLoadingSessionInfo ? 'Calcolo dello spazio occupato…' : 'Spazio occupato non disponibile.'}
        </p>
      )}

      {ready && sessionInfo.persisted === true && (
        <p data-testid="storage-persisted" className="text-xs text-[var(--text-secondary)]">
          Il browser protegge questi dati dalla pulizia automatica.
        </p>
      )}

      {ready && sessionInfo.persisted === false && (onDrive ? (
        <div data-testid="storage-persist-warning" role="note" className="alert-card is-info text-xs space-y-1.5">
          <p className="font-semibold">Le sbobine sono copiate nel tuo Google Drive</p>
          <p>
            Il browser può comunque svuotare questa memoria se non apri il sito per qualche giorno o manca spazio:
            le sbobine le ritrovi ricollegando Drive. Gli audio delle lezioni restano solo qui: se ti servono, scaricali con un backup.
          </p>
        </div>
      ) : (
        <SettingsCallout
          testId="storage-persist-warning"
          role="note"
          tone="warning"
          icon={AlertTriangle}
          title="Il browser può cancellare questi dati"
          footer={(
            <SettingsMoreInfo label="Più informazioni">
              <p>Con Safari su iPad e iPhone bastano circa 7 giorni senza aprire il sito.</p>
              {drive === 'disconnected' && <p>Su Drive vanno i testi delle sbobine, non gli audio delle lezioni: per quelli serve un backup.</p>}
            </SettingsMoreInfo>
          )}
        >
          <p>
            Se non apri il sito per qualche giorno o manca spazio, il browser può eliminare sbobine e audio senza chiedere.
            {/* The way out is a link in the sentence to Impostazioni → Sincronizzazione, named after
                that page so it doesn't read like a link to the Google Drive site. */}
            {drive === 'disconnected' ? (
              <>
                {' '}
                {onOpenDrive
                  ? <button type="button" onClick={onOpenDrive} className="settings-inline-link">Attiva la sincronizzazione</button>
                  : 'Attiva la sincronizzazione'}
                {': le sbobine restano anche nel tuo Google Drive.'}
              </>
            ) : ' Scarica ogni tanto un backup qui sotto.'}
          </p>
        </SettingsCallout>
      ))}
    </SettingsPanel>
  );
}

type WebSessionInfo = NonNullable<StorageSectionProps['sessionInfo']>;

// --processing-text equals the accent in the dark theme, so the second colour is the plain text one.
const PART_COLORS = ['var(--accent-text)', 'var(--text-primary)', 'var(--warning-text)', 'var(--text-muted)'];
const partColor = (index: number) => PART_COLORS[index % PART_COLORS.length];

function WebUsageSummary({ info }: { info: WebSessionInfo }) {
  const parts = info.usage_breakdown ?? [];
  const used = parts.reduce((sum, part) => sum + part.bytes, 0);
  return (
    <div data-testid="storage-usage" className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] p-3 space-y-3">
      {/* One headline figure read as a sentence, then a bar across the card showing what it is made of. */}
      <p className="flex flex-wrap items-baseline gap-x-2 min-w-0">
        <span data-testid="storage-total" className="text-2xl font-bold leading-tight text-[var(--text-primary)] tabular-nums">{formatSize(info.total_bytes)}</span>
        <span className="text-xs text-[var(--text-secondary)]">
          occupati da <span data-testid="storage-count" className="font-semibold text-[var(--text-primary)] tabular-nums">{info.total_sessions}</span>
          {info.total_sessions === 1 ? ' sbobina' : ' sbobine'}
        </span>
      </p>
      {parts.length > 0 && (
        <div data-testid="storage-bar" aria-hidden="true" className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--bg-hover)]">
          {used > 0 && parts.map((part, index) => part.bytes > 0 && (
            <span key={part.label} className="h-full" style={{ width: `${(part.bytes / used) * 100}%`, background: partColor(index) }} />
          ))}
        </div>
      )}
      {parts.length > 0 ? (
        <ul data-testid="storage-breakdown" aria-label="Cosa occupa lo spazio" className="space-y-1">
          {parts.map((part, index) => (
            <li key={part.label} className="flex items-baseline justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 text-[var(--text-secondary)] min-w-0">
                <span aria-hidden="true" className="w-2 h-2 rounded-full shrink-0" style={{ background: partColor(index) }} />
                {part.label}
              </span>
              <span className="font-semibold text-[var(--text-primary)] tabular-nums shrink-0">{formatSize(part.bytes)}</span>
            </li>
          ))}
        </ul>
      ) : info.usage_detail && (
        <p data-testid="storage-usage-detail" className="border-t border-[var(--border-default)] pt-2.5 text-xs text-[var(--text-secondary)]">
          {info.usage_detail}
        </p>
      )}
      {parts.length > 0 && info.browser_estimate_bytes !== undefined && (
        <p data-testid="storage-browser-estimate" className="text-[11px] text-[var(--text-muted)]">
          Stima del browser: {formatSize(info.browser_estimate_bytes)}. Su Safari può non contare gli audio.
        </p>
      )}
    </div>
  );
}

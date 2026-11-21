import React from 'react';
import { AlertTriangle, HardDrive, ShieldCheck } from 'lucide-react';
import type { StorageUsagePart } from '../../../bridge';
import { formatSize } from '../../../utils';
import { SettingsCallout, SettingsMoreInfo, SettingsPanel, StatusBadge } from './SettingsLayout';

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
  /** Whether Google Drive sync exists here and is linked; it changes what the warning suggests. */
  drive?: 'unavailable' | 'disconnected' | 'connected';
  /** Opens Impostazioni → Google Drive from the warning. */
  onOpenDrive?: () => void;
  /** "Vedi quali" on the sbobine's audio opens the archive on the sbobine that keep it. */
  onShowKeptAudio?: () => void;
}

// Everything lives in this browser's storage: there is no folder to open, move or clean. The count
// and the total come first, then what takes that space. Drive keeps the texts but never the lecture
// audio (web/drive/syncFormat.ts), and the warning says so.
export const StorageSection: React.FC<StorageSectionProps> = React.memo(function StorageSection({ sessionInfo, isLoadingSessionInfo, drive = 'unavailable', onOpenDrive, onShowKeptAudio }) {
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
      {ready ? <WebUsageSummary info={sessionInfo} onShowKeptAudio={onShowKeptAudio} /> : (
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
            {/* The way out is a link in the sentence to Impostazioni → Google Drive, named after
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
});

type WebSessionInfo = NonNullable<StorageSectionProps['sessionInfo']>;

// Colours of their own (theme.css): the text colours read bright in the dark theme but muddy in the light one.
const PART_COLORS = ['var(--storage-part-1)', 'var(--storage-part-2)', 'var(--storage-part-3)', 'var(--storage-part-4)', 'var(--storage-part-5)'];
const partColor = (index: number) => PART_COLORS[index % PART_COLORS.length];

function WebUsageSummary({ info, onShowKeptAudio }: { info: WebSessionInfo; onShowKeptAudio?: () => void }) {
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
                {part.kind === 'session_audio' && part.bytes > 0 && onShowKeptAudio && (
                  <button type="button" onClick={onShowKeptAudio} className="settings-inline-link shrink-0">Vedi quali</button>
                )}
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
        <p data-testid="storage-browser-estimate" className="text-caption text-[var(--text-muted)]">
          Stima del browser: {formatSize(info.browser_estimate_bytes)}. Su Safari può non contare gli audio.
        </p>
      )}
    </div>
  );
}

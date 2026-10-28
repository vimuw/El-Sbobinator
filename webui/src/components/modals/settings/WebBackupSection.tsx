import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, Download, Loader2, Upload } from 'lucide-react';
import { formatSize } from '../../../utils';
import { SettingsMoreInfo, SettingsPanel, SettingsRow } from './SettingsLayout';

// Web build only: backup of the sbobine kept in this browser. Preparing and saving are two taps:
// the zip is built asynchronously, then a real <a download> link saves it, so Safari on iPad sees
// the download inside a tap.

interface BackupInfo {
  sessions: number;
  textBytes: number;
  audioBytes: number;
  audioFiles: number;
  lastBackupAt: string | null;
}

interface PreparedBackup {
  url: string;
  filename: string;
  size: number;
}

type Feedback = { tone: 'success' | 'error'; text: string } | null;

function formatBackupDate(iso: string | null): string {
  if (!iso) return 'Nessun backup scaricato da questo browser.';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Nessun backup scaricato da questo browser.';
  return `Ultimo backup scaricato: ${date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}.`;
}

interface WebBackupSectionProps {
  /** Called after an import changed the archive, so the archive page reloads it. */
  onArchiveImported?: () => void;
  /** Rows after the backup, e.g. "Esporta nel mio Drive". */
  children?: React.ReactNode;
}

export const WebBackupSection: React.FC<WebBackupSectionProps> = ({ onArchiveImported, children }) => {
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [prepared, setPrepared] = useState<PreparedBackup | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const preparedUrlRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await window.pywebview?.api?.get_web_backup_info?.().catch(() => null);
    if (!mountedRef.current || !result?.ok) return;
    setInfo({
      sessions: result.sessions ?? 0,
      textBytes: result.text_bytes ?? 0,
      audioBytes: result.audio_bytes ?? 0,
      audioFiles: result.audio_files ?? 0,
      lastBackupAt: result.last_backup_at ?? null,
    });
  }, []);

  const dropPrepared = useCallback(() => {
    if (preparedUrlRef.current) URL.revokeObjectURL(preparedUrlRef.current);
    preparedUrlRef.current = null;
    setPrepared(null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      if (preparedUrlRef.current) URL.revokeObjectURL(preparedUrlRef.current);
    };
  }, [refresh]);

  const handlePrepare = async () => {
    const api = window.pywebview?.api;
    if (!api?.create_web_backup || progress !== null) return;
    dropPrepared();
    setFeedback(null);
    setProgress(0);
    const result = await api.create_web_backup(audioIncluded, (done, total) => {
      if (mountedRef.current) setProgress(total > 0 ? Math.round((done / total) * 100) : 100);
    }).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }) as { ok: false; error: string; blob?: undefined; filename?: undefined });
    if (!mountedRef.current) return;
    setProgress(null);
    if (!result.ok || !result.blob || !result.filename) {
      setFeedback({ tone: 'error', text: result.error ?? 'Backup non riuscito.' });
      return;
    }
    const url = URL.createObjectURL(result.blob);
    preparedUrlRef.current = url;
    setPrepared({ url, filename: result.filename, size: result.blob.size });
  };

  const handleSaved = async () => {
    const result = await window.pywebview?.api?.record_web_backup_download?.().catch(() => null);
    if (mountedRef.current && result?.last_backup_at) {
      setInfo(current => (current ? { ...current, lastBackupAt: result.last_backup_at ?? null } : current));
    }
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const api = window.pywebview?.api;
    if (!file || !api?.import_web_backup) return;
    setFeedback(null);
    setIsImporting(true);
    const result = await api.import_web_backup(file).catch((error: unknown) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }) as { ok: false; error: string; summary?: undefined });
    if (!mountedRef.current) return;
    setIsImporting(false);
    if (result.ok) {
      setFeedback({ tone: 'success', text: `Backup importato: ${result.summary ?? ''}` });
      dropPrepared();
      onArchiveImported?.();
      void refresh();
    } else {
      setFeedback({ tone: 'error', text: result.error ?? 'Importazione non riuscita.' });
    }
  };

  const busy = progress !== null || isImporting;
  const noAudio = !info || info.audioFiles === 0;
  // With no audio saved the switch is off, not a disabled "on" that promises audio in the file.
  const audioIncluded = includeAudio && !noAudio;
  const estimate = info ? info.textBytes + (audioIncluded ? info.audioBytes : 0) : 0;

  return (
    <SettingsPanel
      icon={Archive}
      testId="web-backup"
      title="Backup delle sbobine"
      description="Un file con tutte le sbobine e le raccolte: conservalo, o aprilo su un altro dispositivo o browser."
    >
      <SettingsRow
        title="Includi gli audio delle lezioni"
        description={!info ? '…' : info.audioFiles === 0 ? 'Nessun audio salvato in questo browser' : `${info.audioFiles} file, ${formatSize(info.audioBytes)}`}
      >
        <button
          type="button"
          role="switch"
          aria-checked={audioIncluded}
          aria-label="Includi gli audio delle lezioni nel backup"
          disabled={busy || noAudio}
          onClick={() => {
            setIncludeAudio(value => !value);
            dropPrepared();
          }}
          className={`touch-hit relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed ${
            audioIncluded ? 'bg-[var(--accent-bg)]' : 'bg-[var(--bg-input)] ring-1 ring-[var(--border-strong)]'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              audioIncluded ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </SettingsRow>

      {/* One row per action, its button on the right, like "Esporta nel mio Drive" below:
          the size and the last download describe the download, so they sit in its row. */}
      <SettingsRow
        title="Scarica un backup"
        description={(
          <>
            <span data-testid="web-backup-estimate" className="block">
              {info
                ? `${info.sessions} ${info.sessions === 1 ? 'sbobina' : 'sbobine'} · dimensione stimata ${formatSize(estimate)}`
                : 'Calcolo della dimensione…'}
              {prepared ? ' · pronto: tocca “Salva” per salvarlo sul dispositivo.' : ''}
            </span>
            <span data-testid="web-backup-last" className="block">
              {formatBackupDate(info?.lastBackupAt ?? null)}
            </span>
          </>
        )}
      >
        {prepared ? (
          <a
            href={prepared.url}
            download={prepared.filename}
            onClick={() => void handleSaved()}
            className="app-button-secondary is-settings-action shrink-0"
            data-testid="web-backup-download"
          >
            <Download className="w-4 h-4" />
            <span>Salva il backup ({formatSize(prepared.size)})</span>
          </a>
        ) : (
          <button
            type="button"
            onClick={() => void handlePrepare()}
            disabled={busy || !info || info.sessions === 0}
            aria-label="Prepara backup"
            className="app-button-secondary is-settings-action shrink-0"
          >
            {progress !== null ? <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" /> : <Download className="w-4 h-4" />}
            <span>{progress !== null ? `Preparazione… ${progress}%` : 'Prepara'}</span>
          </button>
        )}
      </SettingsRow>

      <SettingsRow
        title="Importa un backup"
        description="Aggiunge le sbobine del file a quelle di questo browser. Non elimina niente."
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          aria-label="Importa backup"
          className="app-button-secondary is-settings-action shrink-0"
        >
          {isImporting ? <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" /> : <Upload className="w-4 h-4" />}
          <span>{isImporting ? 'Importazione…' : 'Importa'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          aria-label="Scegli il file di backup da importare"
          onChange={event => void handleImportFile(event)}
        />
      </SettingsRow>

      {feedback && (
        <div role={feedback.tone === 'error' ? 'alert' : 'status'} className={`alert-card ${feedback.tone === 'error' ? 'is-error' : 'is-success'} text-xs font-medium`}>
          {feedback.text}
        </div>
      )}

      <SettingsMoreInfo label="Cosa c’è nel backup">
        {/* The total under "Le tue sbobine" counts more than this estimate: say why. */}
        <p data-testid="web-backup-scope">
          Il backup contiene solo i testi e, se lo scegli, gli audio delle sbobine: l’avanzamento delle elaborazioni e gli audio in coda restano solo in questo browser. Le chiavi API non sono incluse.
        </p>
        <p>Prima si prepara il file, poi lo salvi. Importare un backup aggiunge le sbobine a quelle di questo browser e non elimina niente.</p>
        <p>Una sbobina già presente viene sostituita solo se nel backup il suo testo è stato modificato più di recente.</p>
      </SettingsMoreInfo>
      {children}
    </SettingsPanel>
  );
};

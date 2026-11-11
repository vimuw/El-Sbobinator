import type React from 'react';
import { CircleAlert, FileText, FileX, HardDrive, KeyRound, Pause, RotateCcw, ServerCrash, Sparkles, Trash2, TriangleAlert, WifiOff, X } from 'lucide-react';
import type { RunOutcome } from '../appState';
import { isKeyProblemMessage } from '../keyProblemMessages';
import { errorLabel, isNetworkError, isQuotaError, isResumableError } from '../utils';

// What the last batch left for the user to do, in the place the processing banner had: a file
// stopped (paused or failed) or finished with warnings. Notifications keep the history; this says
// what is true now and offers the one action that solves it.

export interface RunOutcomeActions {
  onResume: (fileId: string) => void;
  onRemove: (fileId: string) => void;
  onOpenSettings: () => void;
  onOpenStorage: () => void;
  onOpenSbobina: (htmlPath: string, title: string, sessionDir?: string) => void;
  onReviseSections: (sessionDir: string, fileId: string) => void;
  onDismiss: () => void;
}

interface OutcomeAction {
  label: string;
  icon: React.ReactElement;
  run: () => void;
}

interface OutcomeView {
  tone: 'warning' | 'error';
  icon: React.ReactElement;
  title: string;
  message: string;
  primary?: OutcomeAction;
  secondary?: OutcomeAction;
}

const ICON = 'h-5 w-5';
const BUTTON_ICON = 'h-3.5 w-3.5';

// Kept in sync with the error texts of webRun.failurePayload (key problems: keyProblemMessages).
const LOST_FILE = /^Il browser non riesce più a leggere il file audio/;
const OTHER_FILE = /non è lo stesso audio/;
const STORAGE_FULL = /^Spazio del browser esaurito/;

function retryTime(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) return null;
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function failedChunk(error?: string): string | null {
  return error?.match(/^phase1_chunk_failed_(\d+)$/)?.[1] ?? null;
}

function describeOutcome(outcome: RunOutcome, actions: RunOutcomeActions, canResume: boolean): OutcomeView {
  const resume = (label = 'Riprendi'): OutcomeAction | undefined => (canResume
    ? { label, icon: <RotateCcw className={BUTTON_ICON} />, run: () => actions.onResume(outcome.fileId) }
    : undefined);
  const settings = (label: string): OutcomeAction => ({ label, icon: <KeyRound className={BUTTON_ICON} />, run: actions.onOpenSettings });

  if (outcome.kind === 'warning') {
    const blocks = outcome.revisionFailedBlocks ?? [];
    const { htmlPath, sessionDir } = outcome;
    return {
      tone: 'warning',
      icon: <TriangleAlert className={ICON} />,
      title: 'Sbobina pronta, con avvisi',
      message: 'Il testo è salvato. Prima di studiarlo controlla questi punti:',
      primary: htmlPath
        ? { label: 'Apri la sbobina', icon: <FileText className={BUTTON_ICON} />, run: () => actions.onOpenSbobina(htmlPath, outcome.fileName, sessionDir) }
        : undefined,
      secondary: blocks.length && sessionDir && canResume
        ? { label: 'Rivedi le sezioni', icon: <Sparkles className={BUTTON_ICON} />, run: () => actions.onReviseSections(sessionDir, outcome.fileId) }
        : undefined,
    };
  }

  const label = errorLabel(outcome.error, outcome.errorDetail);
  if (outcome.retryReason === 'circuit_breaker_paused') {
    const at = retryTime(outcome.recommendedRetryAt);
    return {
      tone: 'warning',
      icon: <ServerCrash className={ICON} />,
      title: 'Sbobina in pausa: Gemini è sovraccarico',
      message: `I server di Google non hanno risposto dopo 4 tentativi. I blocchi già fatti sono salvati: riprova tra qualche minuto${at ? ` (meglio dopo le ${at})` : ''}.`,
      primary: resume(),
    };
  }
  if (outcome.kind === 'paused') {
    return { tone: 'warning', icon: <Pause className={ICON} />, title: 'Sbobina in pausa', message: label, primary: resume() };
  }
  if (isQuotaError(outcome.error)) {
    return {
      tone: 'warning',
      icon: <KeyRound className={ICON} />,
      title: 'Quota giornaliera esaurita',
      message: 'Le richieste gratuite di oggi sono finite su tutte le chiavi. I progressi sono salvati: riprendi domani dopo le 09:00, oppure aggiungi una chiave di riserva.',
      primary: settings('Aggiungi una chiave'),
      secondary: resume(),
    };
  }
  const error = outcome.error ?? '';
  if (isKeyProblemMessage(error)) {
    return { tone: 'error', icon: <KeyRound className={ICON} />, title: 'Chiave API da controllare', message: label, primary: settings('Apri le impostazioni') };
  }
  // Retrying cannot help: the queue holds a file the browser cannot read, or a different audio.
  if (LOST_FILE.test(error) || OTHER_FILE.test(error)) {
    return {
      tone: 'error',
      icon: <FileX className={ICON} />,
      title: LOST_FILE.test(error) ? 'File audio non più leggibile' : 'Non è lo stesso file audio',
      message: label,
      primary: { label: 'Rimuovi dalla coda', icon: <Trash2 className={BUTTON_ICON} />, run: () => actions.onRemove(outcome.fileId) },
    };
  }
  if (STORAGE_FULL.test(error)) {
    return {
      tone: 'error',
      icon: <HardDrive className={ICON} />,
      title: 'Spazio del browser esaurito',
      message: 'Il browser non ha più spazio per salvare la sbobina. Elimina le sbobine che non ti servono o fai un backup, poi riprendi: i blocchi già fatti sono salvati.',
      primary: { label: 'Apri Archiviazione', icon: <HardDrive className={BUTTON_ICON} />, run: actions.onOpenStorage },
      secondary: resume(),
    };
  }
  if (error === 'processing_failed' && isNetworkError(outcome.errorDetail)) {
    return { tone: 'warning', icon: <WifiOff className={ICON} />, title: 'Connessione persa', message: label, primary: resume() };
  }
  const chunk = failedChunk(outcome.error);
  if (chunk) {
    return { tone: 'error', icon: <CircleAlert className={ICON} />, title: `Sbobina interrotta al blocco ${chunk}`, message: label, primary: resume() };
  }
  if (error === 'phase1_degenerate_output') {
    return { tone: 'error', icon: <CircleAlert className={ICON} />, title: 'Testo non valido da Gemini', message: label, primary: resume('Riprova') };
  }
  if (error === 'bad_request_phase1') {
    return { tone: 'error', icon: <CircleAlert className={ICON} />, title: 'Richiesta rifiutata da Gemini', message: label, primary: resume('Riprova') };
  }
  return {
    tone: 'error',
    icon: <CircleAlert className={ICON} />,
    title: 'Sbobina non completata',
    message: label,
    primary: resume(isResumableError(outcome.error) ? 'Riprendi' : 'Riprova'),
  };
}

export function RunOutcomeBanner({ outcome, actions, canResume }: { outcome: RunOutcome; actions: RunOutcomeActions; canResume: boolean }) {
  const view = describeOutcome(outcome, actions, canResume);
  const warnings = outcome.warnings.map(warning => warning.message);
  const blocks = outcome.revisionFailedBlocks ?? [];
  // Older hosts send unrevised sections only in fileDone, without the banner warning.
  if (outcome.kind === 'warning' && blocks.length && !outcome.warnings.some(warning => warning.code === 'unrevised_blocks')) {
    warnings.push(blocks.length === 1 ? `1 sezione inclusa senza revisione (sezione ${blocks[0]})` : `${blocks.length} sezioni incluse senza revisione (sezioni ${blocks.join(', ')})`);
  }
  return (
    <section
      role={view.tone === 'error' ? 'alert' : 'status'}
      aria-labelledby="run-outcome-title"
      data-testid="run-outcome-banner"
      data-kind={outcome.kind}
      className={`run-outcome is-${view.tone}`}
    >
      <span className="run-outcome-icon" aria-hidden="true">{view.icon}</span>
      <div className="run-outcome-body">
        <h2 id="run-outcome-title" className="run-outcome-title">{view.title}</h2>
        {outcome.fileName && <p className="run-outcome-file" title={outcome.fileName}>{outcome.fileName}</p>}
        <p className="run-outcome-message">{view.message}</p>
        {warnings.length > 0 && (
          <ul className="run-outcome-warnings" aria-label="Avvisi">
            {warnings.map(message => <li key={message}>{message}</li>)}
          </ul>
        )}
      </div>
      {/* Beside the text on wider screens, under it on a phone. */}
      {(view.primary || view.secondary) && (
        <div className="run-outcome-actions" data-testid="run-outcome-actions">
          {view.primary && (
            <button type="button" className="modal-action-button is-primary is-compact" onClick={view.primary.run}>
              {view.primary.icon}
              {view.primary.label}
            </button>
          )}
          {view.secondary && (
            <button type="button" className="app-button-secondary is-settings-action" onClick={view.secondary.run}>
              {view.secondary.icon}
              {view.secondary.label}
            </button>
          )}
        </div>
      )}
      <button
        type="button"
        aria-label="Chiudi avviso"
        title="Chiudi avviso"
        className="icon-button compact-icon-button run-outcome-close"
        onClick={actions.onDismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </section>
  );
}

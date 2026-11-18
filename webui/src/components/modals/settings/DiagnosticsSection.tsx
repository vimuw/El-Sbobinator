import { reportClientError } from '../../../diagnostics';
import React, { useState, useEffect } from 'react';
import {
  Loader2,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Copy,
  RefreshCw,
  FlaskConical,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react';
import { ReportProblemLink } from '../../ReportProblemLink';
import { SUPPORT_EMAIL } from '../../../branding';
import { getHostCapabilities } from '../../../hostCapabilities';
import { loadAutoReports, saveAutoReports } from '../../../monitoring/config';
import { MAX_REPORT_HISTORY, loadReportHistory, subscribeReportHistory, type SentReport } from '../../../feedback/history';
import { CustomSelect } from './CustomSelect';
import type { ValidationResult } from '../../../bridge';
import { SettingsRow, SettingsSectionHeading } from './SettingsLayout';

const REPORT_KIND_LABELS: Record<SentReport['kind'], string> = { bug: 'Bug', idea: 'Suggerimento', altro: 'Altro' };
const REPORT_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface DiagnosticsSectionProps {
  isValidatingEnvironment: boolean;
  onRunValidation: () => void;
  validationResult: ValidationResult | null;
  onCopyReport: (sessionDir?: string) => Promise<void>;
  // FFmpeg, disk and session-folder checks only exist on desktop.
  showEnvironmentCheck?: boolean;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = React.memo(({
  isValidatingEnvironment,
  onRunValidation,
  validationResult,
  onCopyReport,
  showEnvironmentCheck = true,
}) => {
  const [copiedToast, setCopiedToast] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const hasRun = Boolean(validationResult);
  const [sessions, setSessions] = useState<Array<{ path: string; label: string }>>([]);
  const [sessionDir, setSessionDir] = useState('');
  const [supportError, setSupportError] = useState('');

  useEffect(() => {
    let active = true;
    if (window.pywebview?.api?.list_diagnostic_sessions) {
      void window.pywebview.api.list_diagnostic_sessions().then(result => {
        if (active && result.ok) setSessions(result.sessions || []);
      }).catch(() => {});
    }
    return () => { active = false; };
  }, []);

  const handleCopyReport = async () => {
    if (isCopying) return;
    setIsCopying(true);
    setSupportError('');
    try {
      await onCopyReport(sessionDir || undefined);
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    } catch (e) {
      setSupportError(e instanceof Error ? e.message : String(e));
      reportClientError('Copy diagnostic report failed:', e);
    } finally {
      setIsCopying(false);
    }
  };

  const problems = validationResult?.checks?.filter(check => check.status !== 'ok') ?? [];
  const feedbackWindow = !getHostCapabilities().reportByEmail;
  const [autoReports, setAutoReportsState] = useState(loadAutoReports);
  const [sentReports, setSentReports] = useState(() => loadReportHistory());
  // A report sent from the window opened here shows up at once.
  useEffect(() => subscribeReportHistory(() => setSentReports(loadReportHistory())), []);
  // A report code or the support address, whichever was copied last.
  const [copiedText, setCopiedText] = useState('');
  const [copyFailed, setCopyFailed] = useState(false);
  useEffect(() => {
    if (!copiedText) return;
    const timer = setTimeout(() => setCopiedText(''), 2500);
    return () => clearTimeout(timer);
  }, [copiedText]);

  const copyText = async (text: string) => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedText(text);
    } catch {
      setCopiedText('');
      setCopyFailed(true);
    }
  };
  const copyFailedAlert = copyFailed && <p role="alert" className="text-xs text-[var(--error-text)]">Non riesco a copiarlo: selezionalo e copialo a mano.</p>;

  const toggleAutoReports = () => {
    const next = !autoReports;
    setAutoReportsState(next);
    saveAutoReports(next);
    // Loaded with the page in web builds with reports; Vite drops the SDK from the desktop bundle.
    // A chunk that does not load (blocked, offline) leaves the saved choice for the next page.
    if (import.meta.env.MODE === 'web') {
      void import('../../../monitoring/sentry')
        .then(monitoring => monitoring.setAutoReports(next))
        .catch(error => reportClientError('monitoring', error));
    }
  };

  return (
    <div className="space-y-3 animate-fade-in">
      <section aria-labelledby="diagnostic-support-heading" className="space-y-3">
        <div className="space-y-2">
          <SettingsSectionHeading icon={MessageSquareWarning} id="diagnostic-support-heading">Segnala un problema</SettingsSectionHeading>
          <p className="text-xs text-[var(--text-secondary)]">
            {feedbackWindow ? 'Scrivi cosa è successo: le informazioni tecniche si allegano da sole, se vuoi.' : 'Due passaggi: copia il report e incollalo in un’email.'}
          </p>
        </div>
        {feedbackWindow ? (
          <div>
            <SettingsRow title="Invia una segnalazione" description="Un messaggio, con immagini se servono.">
              <ReportProblemLink className="app-button-secondary is-settings-action shrink-0" />
            </SettingsRow>
            {/* The reports sent with the button above, right under it: a caption, not one more row. */}
            {sentReports.length > 0 && (
              <div className="space-y-1 pt-2">
                <div className="space-y-0.5 px-0.5">
                  <span id="diagnostic-sent-reports" className="text-xs font-semibold text-[var(--text-secondary)] block">Le tue segnalazioni</span>
                  <p className="text-xs text-[var(--text-secondary)]">Le ultime {MAX_REPORT_HISTORY} inviate da questo browser: se mi scrivi, indica il codice.</p>
                </div>
                <ul aria-labelledby="diagnostic-sent-reports">
                  {sentReports.map(report => (
                    <li key={report.code}>
                      <SettingsRow
                        title={<span className="font-mono text-base tracking-wide select-all">{report.code}</span>}
                        description={<>{REPORT_KIND_LABELS[report.kind]} · <time dateTime={report.sentAt}>{REPORT_DATE.format(new Date(report.sentAt))}</time></>}
                      >
                        <button
                          type="button"
                          className="app-button-secondary is-settings-action shrink-0"
                          aria-label={copiedText === report.code ? `Codice ${report.code} copiato` : `Copia codice ${report.code}`}
                          onClick={() => void copyText(report.code)}
                        >
                          {copiedText === report.code
                            ? <Check className="w-4 h-4 text-[var(--success-text)]" aria-hidden="true" />
                            : <Copy className="w-4 h-4" aria-hidden="true" />}
                          <span aria-hidden="true">{copiedText === report.code ? 'Copiato' : 'Copia'}</span>
                        </button>
                      </SettingsRow>
                    </li>
                  ))}
                </ul>
                {copyFailedAlert}
              </div>
            )}
          </div>
        ) : (<>
        {/* The two steps in the order they are done, each with its button on the right, like the
            rows of Archiviazione. The sbobina choice decides what the report holds, so it follows step 1. */}
        <div>
          <SettingsRow
            title="1. Copia il report"
            description="Errori e log, mai audio, trascrizioni o chiavi API."
          >
            <button
              type="button"
              onClick={handleCopyReport}
              disabled={isCopying}
              className="app-button-secondary is-settings-action shrink-0"
              title={copiedToast ? 'Report copiato!' : 'Copia il report da incollare nell’email'}
              aria-label="Copia report diagnostico"
            >
              {copiedToast ? (
                <Check className="w-4 h-4 text-[var(--success-text)]" />
              ) : isCopying ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              <span>{copiedToast ? 'Copiato' : 'Copia'}</span>
            </button>
          </SettingsRow>
          {sessions.length > 0 && (
            <div className="flex flex-col gap-2 pb-2">
              <label htmlFor="diagnostic-session" className="text-xs text-[var(--text-secondary)]">Sbobina con il problema (facoltativa)</label>
              <CustomSelect
                id="diagnostic-session"
                value={sessionDir}
                disabled={isCopying}
                onChange={setSessionDir}
                options={[
                  { value: '', label: 'Nessuna in particolare' },
                  ...sessions.map(session => ({ value: session.path, label: session.label })),
                ]}
              />
            </div>
          )}
          {/* The address in sight: without a mail app the button opens nothing (the browser stays
              silent, the desktop app only logs the failure). */}
          <SettingsRow
            title="2. Scrivimi un’email"
            description={<>Descrivi il problema e incolla il report. Se non si apre nulla, scrivi a <span className="font-semibold text-[var(--text-primary)] select-all whitespace-nowrap">{SUPPORT_EMAIL}</span>.</>}
          >
            <ReportProblemLink className="app-button-secondary is-settings-action shrink-0" />
            <button
              type="button"
              className="app-button-secondary is-settings-action shrink-0"
              aria-label={copiedText === SUPPORT_EMAIL ? 'Indirizzo email copiato' : 'Copia indirizzo email'}
              onClick={() => void copyText(SUPPORT_EMAIL)}
            >
              {copiedText === SUPPORT_EMAIL
                ? <Check className="w-4 h-4 text-[var(--success-text)]" aria-hidden="true" />
                : <Copy className="w-4 h-4" aria-hidden="true" />}
              <span aria-hidden="true">{copiedText === SUPPORT_EMAIL ? 'Copiato' : 'Copia indirizzo'}</span>
            </button>
          </SettingsRow>
          {copyFailedAlert}
        </div>
        </>)}
        {supportError && <p role="alert" className="text-xs text-[var(--error-text)]">{supportError}</p>}
      </section>

      {/* A standing choice about what the app sends on its own, not a way to report: its own
          section, drawn like Verifica ambiente with the control on the right. */}
      {feedbackWindow && (
        <section aria-labelledby="diagnostic-auto-reports-heading" className="border-t border-[var(--border-default)] pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <SettingsSectionHeading icon={ShieldCheck} id="diagnostic-auto-reports-heading">Report automatici</SettingsSectionHeading>
              <p className="text-xs text-[var(--text-secondary)]">
                Se qualcosa si rompe, l’app invia da sola un report tecnico, senza i tuoi testi né l’audio.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoReports}
              aria-label="Invia report automatici degli errori"
              onClick={toggleAutoReports}
              className={`touch-hit relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                autoReports ? 'bg-[var(--accent-bg)]' : 'bg-[var(--border-default)]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-[var(--shadow-xs)] ring-0 transition duration-200 ease-in-out ${
                  autoReports ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </section>
      )}

      {showEnvironmentCheck && (
        <section aria-labelledby="diagnostic-environment-heading" className="space-y-3 border-t border-[var(--border-default)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2 min-w-0">
              <SettingsSectionHeading icon={FlaskConical} id="diagnostic-environment-heading">Verifica ambiente</SettingsSectionHeading>
              <p className="text-xs text-[var(--text-secondary)]">
                Controlla chiave API, FFmpeg e cartella sessioni. Non consuma quota.
              </p>
            </div>
            <button
              type="button"
              onClick={onRunValidation}
              disabled={isValidatingEnvironment}
              className="app-button-secondary is-settings-action shrink-0"
              title={isValidatingEnvironment ? 'Verifica in corso…' : hasRun ? 'Riesegui verifica ambiente' : 'Verifica ambiente'}
              aria-label={hasRun ? 'Riesegui verifica ambiente' : 'Verifica ambiente'}
            >
              {isValidatingEnvironment ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent-text)]" />
                  <span>Verifica in corso...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="w-3.5 h-3.5 text-[var(--accent-text)] transition-transform duration-500 ease-out settings-refresh-icon" />
                  <span>{hasRun ? 'Riesegui' : 'Verifica ora'}</span>
                </>
              )}
            </button>
          </div>

          {validationResult && (() => {
            const hasErrors = !validationResult.ok || problems.some(c => c.status === 'error');
            const hasWarnings = !hasErrors && (Boolean(validationResult.has_warnings) || problems.length > 0);
            const bannerClass = hasErrors ? 'is-error' : hasWarnings ? 'is-warning' : 'is-success';
            const textColor = hasErrors ? 'var(--error-text)' : hasWarnings ? 'var(--warning-text)' : 'var(--success-text)';

            return (
              <div className={`alert-card ${bannerClass} flex-row items-center gap-2.5 animate-fade-in`}>
                {hasErrors ? (
                  <AlertCircle className="w-4 h-4 text-[var(--error-text)] shrink-0" />
                ) : hasWarnings ? (
                  <AlertTriangle className="w-4 h-4 text-[var(--warning-text)] shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-[var(--success-text)] shrink-0" />
                )}
                <span className="text-sm font-bold" style={{ color: textColor }}>
                  {validationResult.summary}
                </span>
              </div>
            );
          })()}

          {problems.length > 0 && (
            <ul aria-label="Problemi rilevati" className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
              {problems.map(check => (
                <li key={check.id} className="flex justify-between items-start py-3 gap-3">
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <span className="text-sm font-bold text-[var(--text-primary)]">{check.label}</span>
                    {check.message && (
                      <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{check.message}</p>
                    )}
                    {check.details && (
                      <p className="text-xs font-mono text-[var(--text-secondary)] break-all whitespace-pre-wrap leading-relaxed">{check.details}</p>
                    )}
                  </div>
                  <div className="shrink-0 pl-2">
                    {check.status === 'warning' ? (
                      <AlertTriangle className="w-4 h-4 text-[var(--warning-text)]" aria-label="Avviso" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-[var(--error-text)]" aria-label="Errore" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
});

DiagnosticsSection.displayName = 'DiagnosticsSection';

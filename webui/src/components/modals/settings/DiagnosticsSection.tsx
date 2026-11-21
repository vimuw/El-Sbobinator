import { reportClientError } from '../../../diagnostics';
import React, { useState, useEffect } from 'react';
import {
  Loader2,
  Check,
  Copy,
  MessageSquareWarning,
  ShieldCheck,
} from 'lucide-react';
import { ReportProblemLink } from '../../ReportProblemLink';
import { SUPPORT_EMAIL } from '../../../branding';
import { getHostCapabilities } from '../../../hostCapabilities';
import { loadAutoReports, saveAutoReports } from '../../../monitoring/config';
import { MAX_REPORT_HISTORY, REPORT_MAX_AGE_DAYS, loadReportHistory, subscribeReportHistory, type SentReport } from '../../../feedback/history';
import { SettingsRow, SettingsSectionHeading } from './SettingsLayout';

const REPORT_KIND_LABELS: Record<SentReport['kind'], string> = { bug: 'Bug', idea: 'Suggerimento', altro: 'Altro' };
const REPORT_CODE_CLASS = 'font-mono font-semibold tracking-wide select-all';
const REPORT_DATE = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

interface DiagnosticsSectionProps {
  onCopyReport: () => Promise<void>;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = React.memo(({
  onCopyReport,
}) => {
  const [copiedToast, setCopiedToast] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [supportError, setSupportError] = useState('');

  const handleCopyReport = async () => {
    if (isCopying) return;
    setIsCopying(true);
    setSupportError('');
    try {
      await onCopyReport();
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
    } catch (e) {
      setSupportError(e instanceof Error ? e.message : String(e));
      reportClientError('Copy diagnostic report failed:', e);
    } finally {
      setIsCopying(false);
    }
  };

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
    // Loaded with the page in builds with reports.
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
            {/* The reports sent with the button above, right under it: a caption, not one more row. A
                quieter line than the one between sections sets them apart as a group of their own. */}
            {sentReports.length > 0 && (
              <div className="mt-2 space-y-1 border-t border-[var(--border-subtle)] pt-3">
                <div className="space-y-0.5 px-0.5">
                  <span id="diagnostic-sent-reports" className="text-xs font-semibold text-[var(--text-secondary)] block">Le tue segnalazioni</span>
                  <p className="text-xs text-[var(--text-secondary)]">Le ultime {MAX_REPORT_HISTORY} inviate da questo browser negli ultimi {REPORT_MAX_AGE_DAYS} giorni: se mi scrivi, indica il codice.</p>
                </div>
                <ul aria-labelledby="diagnostic-sent-reports">
                  {sentReports.map(report => (
                    <li key={report.code}>
                      {/* What the user wrote says which report it is; the code they quote sits with type and
                          date. A report saved before the excerpt was kept shows its code as the title. */}
                      <SettingsRow
                        title={report.excerpt
                          ? <span className="block truncate" title={report.excerpt}>{report.excerpt}</span>
                          : <span className={REPORT_CODE_CLASS}>{report.code}</span>}
                        description={<>
                          {report.excerpt && <><span className={`${REPORT_CODE_CLASS} text-[var(--text-primary)]`}>{report.code}</span> · </>}
                          {REPORT_KIND_LABELS[report.kind]} · <time dateTime={report.sentAt}>{REPORT_DATE.format(new Date(report.sentAt))}</time>
                        </>}
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
          {/* The address in sight: without a mail app the button opens nothing and the browser
              stays silent. */}
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

    </div>
  );
});

DiagnosticsSection.displayName = 'DiagnosticsSection';

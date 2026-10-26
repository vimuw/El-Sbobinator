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
} from 'lucide-react';
import { ReportProblemLink } from '../../ReportProblemLink';
import { CustomSelect } from './CustomSelect';
import type { ValidationResult } from '../../../bridge';
import { SettingsSectionHeading } from './SettingsLayout';

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

  return (
    <div className="space-y-3 animate-fade-in">
      <section aria-labelledby="diagnostic-support-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <SettingsSectionHeading id="diagnostic-support-heading">Segnala un problema</SettingsSectionHeading>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <ReportProblemLink className="app-button-secondary is-settings-action" />
            <button
              type="button"
              onClick={handleCopyReport}
              disabled={isCopying}
              className="app-button-secondary is-settings-action"
              title={copiedToast ? 'Report copiato!' : 'Copia il report da incollare nel modulo'}
              aria-label="Copia report diagnostico"
            >
              {copiedToast ? (
                <Check className="w-4 h-4 text-[var(--success-text)]" />
              ) : isCopying ? (
                <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              <span>{copiedToast ? 'Copiato' : 'Copia report'}</span>
            </button>
          </div>
        </div>
        <p className="text-xs text-[var(--text-secondary)]">
          Descrivi il problema nel modulo e incolla il report: contiene errori e log, mai audio, trascrizioni o chiavi API.
        </p>
        {sessions.length > 0 && (
          <div className="flex flex-col gap-2">
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
        {supportError && <p role="alert" className="text-xs text-[var(--error-text)]">{supportError}</p>}
      </section>

      {showEnvironmentCheck && (
        <section aria-labelledby="diagnostic-environment-heading" className="space-y-3 border-t border-[var(--border-default)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5 min-w-0">
              <SettingsSectionHeading id="diagnostic-environment-heading">Verifica ambiente</SettingsSectionHeading>
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

import React, { useState } from 'react';
import {
  FlaskConical,
  Loader2,
  Check,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  X,
  Copy,
  FolderOpen,
  RefreshCw,
} from 'lucide-react';
import type { ValidationResult, ApiUsageResult } from '../../../bridge';

export interface DisplayCheck {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warning' | 'error';
  message?: string;
  details?: string;
  errorMessage?: string;
  errorDetails?: string;
}

interface DiagnosticsSectionProps {
  isValidatingEnvironment: boolean;
  onRunValidation: () => void;
  validationResult: ValidationResult | null;
  displayChecks: DisplayCheck[];
  onOpenLogs?: () => void;
  onCopyReport?: () => Promise<void>;
  apiUsage?: ApiUsageResult | null;
  showOpenLogs?: boolean;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = React.memo(({
  isValidatingEnvironment,
  onRunValidation,
  validationResult,
  displayChecks,
  onOpenLogs,
  onCopyReport,
  apiUsage: _apiUsage,
  showOpenLogs = true,
}) => {
  const [copiedToast, setCopiedToast] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const handleCopyReport = async () => {
    if (isCopying) return;
    setIsCopying(true);
    try {
      if (onCopyReport) {
        await onCopyReport();
        setCopiedToast(true);
        setTimeout(() => setCopiedToast(false), 2500);
      } else if (window.pywebview?.api?.get_diagnostic_report) {
        const res = await window.pywebview.api.get_diagnostic_report();
        if (res?.ok && res.report) {
          await navigator.clipboard.writeText(res.report);
          setCopiedToast(true);
          setTimeout(() => setCopiedToast(false), 2500);
        }
      }
    } catch (e) {
      console.error('Copy diagnostic report failed:', e);
    } finally {
      setIsCopying(false);
    }
  };

  const handleOpenLogsFolder = () => {
    if (onOpenLogs) {
      onOpenLogs();
    } else if (window.pywebview?.api?.open_logs_folder) {
      void window.pywebview.api.open_logs_folder();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Verifica Ambiente e Integrità */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
            Verifica Ambiente e Integrità
          </h3>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleCopyReport}
            disabled={isCopying}
            className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
            title={copiedToast ? 'Report copiato!' : 'Copia report per assistenza'}
            aria-label="Copia report diagnostico"
          >
            {copiedToast ? (
              <Check className="w-4 h-4 text-[var(--success-text)]" />
            ) : isCopying ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>

          {showOpenLogs && (
            <button
              type="button"
              onClick={handleOpenLogsFolder}
              className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors shrink-0 cursor-pointer"
              title="Apri cartella log"
              aria-label="Apri cartella log"
            >
              <FolderOpen className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={onRunValidation}
            disabled={isValidatingEnvironment}
            className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 shrink-0 cursor-pointer"
            title="Verifica ambiente"
            aria-label="Verifica ambiente"
          >
            {isValidatingEnvironment ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            ) : (
              <RefreshCw className="w-4 h-4 text-[var(--accent-text)]" />
            )}
          </button>
        </div>
      </div>

      {/* Validation Result Banner */}
      {validationResult && (() => {
        const hasErrors = !validationResult.ok || validationResult.checks?.some(c => c.status === 'error');
        const hasWarnings = !hasErrors && (Boolean(validationResult.has_warnings) || Boolean(validationResult.checks?.some(c => c.status === 'warning')));
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
            <span
              className="text-sm font-bold"
              style={{ color: textColor }}
            >
              {validationResult.summary}
            </span>
          </div>
        );
      })()}

      {/* System Requirements Checks List */}
      <ul className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)]">
        {displayChecks.map(check => (
          <li
            key={check.id}
            className="flex justify-between items-start py-3 gap-3 transition-colors"
          >
            <div className="flex-1 min-w-0 space-y-0.5">
              <span className="text-sm font-bold text-[var(--text-primary)]">{check.label}</span>
              {check.status !== 'pending' && check.message && (
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{check.message}</p>
              )}
              {check.details && (
                <p className="text-xs font-mono text-[var(--text-secondary)] break-all whitespace-pre-wrap mt-0.5 leading-relaxed">
                  {check.details}
                </p>
              )}
              {(check.status === 'error' || check.status === 'warning') && check.errorMessage && (
                <div className={`mt-2 alert-card ${check.status === 'error' ? 'is-error' : 'is-warning'} text-xs space-y-1 animate-fade-in`}>
                  <p className="font-bold">{check.errorMessage}</p>
                  {check.errorDetails && (
                    <p className="font-mono break-all text-[var(--text-secondary)]">{check.errorDetails}</p>
                  )}
                </div>
              )}
            </div>
            <div className="shrink-0 pl-2 flex items-center h-full">
              {check.status === 'pending' ? (
                <span className="text-xs font-semibold rounded-full px-2.5 py-0.5 text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-default)]">
                  da verificare
                </span>
              ) : check.status === 'ok' ? (
                <div
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--success-subtle)] text-[var(--success-text)] animate-fade-in"
                  title="Verificato"
                >
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
              ) : check.status === 'warning' ? (
                <div
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--warning-subtle)] text-[var(--warning-text)] animate-fade-in"
                  title="Avviso"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                </div>
              ) : (
                <div
                  className="flex items-center justify-center w-5 h-5 rounded-full bg-[var(--error-subtle)] text-[var(--error-text)] animate-fade-in"
                  title="Errore"
                >
                  <X className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
});

DiagnosticsSection.displayName = 'DiagnosticsSection';

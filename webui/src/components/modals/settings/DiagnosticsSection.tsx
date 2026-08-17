import React from 'react';
import { ShieldCheck, FlaskConical, Loader2, Check, AlertCircle, AlertTriangle, X } from 'lucide-react';
import type { ValidationResult } from '../../../bridge';

export interface DisplayCheck {
  id: string;
  label: string;
  status: 'pending' | 'ok' | 'warning' | 'error';
  message: string;
  details?: string;
  errorMessage?: string;
  errorDetails?: string;
}

interface DiagnosticsSectionProps {
  isValidatingEnvironment: boolean;
  onRunValidation: () => void;
  validationResult: ValidationResult | null;
  displayChecks: DisplayCheck[];
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = React.memo(({
  isValidatingEnvironment,
  onRunValidation,
  validationResult,
  displayChecks,
}) => {
  return (
    <div className="space-y-6">
      <div className="p-4 rounded-xl border border-[var(--border-subtle)] space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-text)]" />
              Diagnosi e Verifica Ambiente
            </h4>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Esegui il controllo completo dei prerequisiti di sistema e della connessione API Gemini.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunValidation}
            disabled={isValidatingEnvironment}
            className="icon-button shrink-0 p-2 rounded-lg bg-[var(--sidebar-active-bg)] hover:bg-[var(--accent-subtle)] text-[var(--text-primary)] transition-colors disabled:opacity-40"
            title="Verifica ambiente"
          >
            {isValidatingEnvironment ? (
              <Loader2 className="w-4 h-4 animate-spin text-[var(--text-primary)]" />
            ) : (
              <FlaskConical className="w-4 h-4 text-[var(--text-secondary)]" />
            )}
          </button>
        </div>

        <div className="space-y-4">
          {validationResult && (
            <div className="flex items-center gap-2 px-1 pb-3 border-b border-[var(--border-subtle)] animate-fade-in">
              {validationResult.ok ? (
                <Check className="w-4 h-4 text-[var(--success-text)] shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[var(--error-text)] shrink-0" />
              )}
              <span
                className="text-sm font-bold"
                style={{ color: validationResult.ok ? 'var(--success-text)' : 'var(--error-text)' }}
              >
                {validationResult.summary}
              </span>
            </div>
          )}

          <ul className="space-y-3 py-1">
            {displayChecks.map(check => (
              <li
                key={check.id}
                className="flex justify-between items-start py-2.5 border-b border-[var(--border-subtle)] last:border-0"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <span className="text-sm font-semibold text-[var(--text-primary)]">{check.label}</span>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{check.message}</p>
                  {check.details && (
                    <p className="text-xs font-mono text-[var(--text-muted)] break-all mt-1">{check.details}</p>
                  )}
                  {(check.status === 'error' || check.status === 'warning') && check.errorMessage && (
                    <div className="mt-1.5 p-2 rounded bg-[var(--error-subtle)] border border-[var(--error-ring)] text-xs text-[var(--error-text)] space-y-1 animate-fade-in">
                      <p className="font-semibold">{check.errorMessage}</p>
                      {check.errorDetails && (
                        <p className="font-mono break-all opacity-90">{check.errorDetails}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 pl-3 flex items-center h-full">
                  {check.status === 'pending' ? (
                    <span className="text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 text-[var(--text-muted)] bg-[var(--sidebar-active-bg)]">
                      da verificare
                    </span>
                  ) : check.status === 'ok' ? (
                    <div
                      className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--success-subtle)] text-[var(--success-text)] animate-fade-in"
                      title="Verificato"
                    >
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  ) : check.status === 'warning' ? (
                    <div
                      className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--warning-subtle)] text-[var(--warning-text)] animate-fade-in"
                      title="Avviso"
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div
                      className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--error-subtle)] text-[var(--error-text)] animate-fade-in"
                      title="Errore"
                    >
                      <X className="w-3.5 h-3.5 stroke-[3]" />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
});

DiagnosticsSection.displayName = 'DiagnosticsSection';

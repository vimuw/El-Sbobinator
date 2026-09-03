import React, { useState } from 'react';
import {
  ShieldCheck,
  FlaskConical,
  Loader2,
  Check,
  AlertCircle,
  AlertTriangle,
  X,
  Copy,
  FolderOpen,
  Activity,
  Clock,
  RefreshCw,
} from 'lucide-react';
import type { ApiUsageResult, ValidationResult } from '../../../bridge';

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
  apiUsage?: ApiUsageResult | null;
  isLoadingUsage?: boolean;
  onRefreshUsage?: () => void;
  onOpenLogs?: () => void;
  onCopyReport?: () => Promise<void>;
}

export const DiagnosticsSection: React.FC<DiagnosticsSectionProps> = React.memo(({
  isValidatingEnvironment,
  onRunValidation,
  validationResult,
  displayChecks,
  apiUsage,
  isLoadingUsage,
  onRefreshUsage,
  onOpenLogs,
  onCopyReport,
}) => {
  const [copiedToast, setCopiedToast] = useState(false);
  const [isCopying, setIsCopying] = useState(false);

  const totalRemainingRequests =
    apiUsage?.total_requests_remaining ??
    apiUsage?.keys.reduce((acc, k) => {
      return (
        acc +
        Object.values(k.models).reduce((mAcc, m) => mAcc + m.remaining, 0)
      );
    }, 0) ??
    0;

  const handleCopyReport = async () => {
    if (isCopying) return;
    setIsCopying(true);
    try {
      if (onCopyReport) {
        await onCopyReport();
      } else if (window.pywebview?.api?.get_diagnostic_report) {
        const res = await window.pywebview.api.get_diagnostic_report();
        if (res?.ok && res.report) {
          await navigator.clipboard.writeText(res.report);
        }
      }
      setCopiedToast(true);
      setTimeout(() => setCopiedToast(false), 2500);
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
    <div className="space-y-5">
      {/* 1. Real-time Google AI Studio Quota Tracker (Notion-like) */}
      <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
        {/* Header */}
        <div className="space-y-3 pb-1">
          {/* Header row + Subtitle */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
                <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                <span>Quote & Utilizzo Google AI Studio</span>
                {apiUsage && apiUsage.keys.length > 0 && (
                  <span className="text-[11px] font-normal text-[var(--text-muted)] bg-[var(--bg-input)] px-2 py-0.5 rounded-full border border-[var(--border-subtle)]">
                    {apiUsage.keys.length}{' '}
                    {apiUsage.keys.length === 1 ? 'chiave' : 'chiavi'}
                  </span>
                )}
              </h3>

              <button
                type="button"
                onClick={onRefreshUsage}
                disabled={isLoadingUsage}
                className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 group/refresh shrink-0"
                title="Aggiorna conteggio quote"
                aria-label="Aggiorna conteggio quote"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 transition-transform duration-500 ease-out ${
                    isLoadingUsage
                      ? 'animate-spin text-[var(--accent-text)]'
                      : 'group-hover/refresh:rotate-180 group-hover/refresh:scale-105'
                  }`}
                />
              </button>
            </div>

            <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--text-muted)] shrink-0" />
              {apiUsage?.next_reset_info || 'Reset quote: ore 09:00 (fuso Google PT)'}
            </p>
          </div>

          {/* Row 2: Stat Tiles (aligned with StorageSection) */}
          {apiUsage && (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div
                className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5 cursor-help transition-colors hover:border-[var(--border-default)]"
                title={`${totalRemainingRequests} chiamate totali rimaste tra tutte le chiavi.`}
              >
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Chiamate Residue
                </span>
                <span
                  className={`text-base font-semibold block ${
                    totalRemainingRequests === 0
                      ? 'text-[var(--error-text)]'
                      : totalRemainingRequests < 20
                      ? 'text-[var(--warning-text)]'
                      : 'text-[var(--text-primary)]'
                  }`}
                >
                  {totalRemainingRequests} chiamate rimaste
                </span>
              </div>

              <div
                className="p-3 rounded-lg bg-[var(--bg-input)] border border-[var(--border-subtle)] space-y-0.5 cursor-help transition-colors hover:border-[var(--border-default)]"
                title={`Equivalgono a circa ${apiUsage.estimated_sbobine_remaining} lezioni complete da 2h30–3h (~19 chiamate a lezione: 12 chunk audio da 15 min + 7 macro-sezioni di testo).`}
              >
                <span className="text-[11px] text-[var(--text-muted)] block">
                  Autonomia Stimata
                </span>
                <span className="text-base font-semibold text-[var(--text-primary)] block">
                  ~{apiUsage.estimated_sbobine_remaining} lezioni (3h)
                </span>
              </div>
            </div>
          )}
        </div>

        {apiUsage?.is_degraded_mode && (
          <div className="alert-card is-warning text-xs flex-row items-start gap-2 animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-semibold">Modalità Degradata Attiva</p>
              <p className="opacity-90">{apiUsage.degraded_reason}</p>
            </div>
          </div>
        )}

        {isLoadingUsage ? (
          <div className="py-8 flex items-center justify-center gap-2 text-xs text-[var(--text-muted)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            Caricamento quote in corso...
          </div>
        ) : apiUsage && apiUsage.keys.length > 0 ? (
          <div className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] pt-1">
            {apiUsage.keys.map(k => {
              const hasUsage = Object.values(k.models).some(m => m.used_today > 0);
              const isAnyExhausted = Object.values(k.models).some(m => m.is_exhausted);
              const isPrimaryLabelDuplicate = k.label.toLowerCase().includes('principale');

              return (
                <div
                  key={k.id}
                  className={`py-3 space-y-2 transition-colors ${
                    !hasUsage ? 'opacity-85 hover:opacity-100' : ''
                  }`}
                >
                  {/* Key Row Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          isAnyExhausted
                            ? 'bg-[var(--error-bg)]'
                            : hasUsage
                            ? 'bg-[var(--accent-bg)]'
                            : 'bg-[var(--text-muted)] opacity-35'
                        }`}
                      />
                      <span className="text-xs font-semibold text-[var(--text-primary)] truncate">
                        {k.label}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-[var(--bg-panel)] font-mono text-[11px] text-[var(--text-muted)] shrink-0">
                        {k.masked_key.length > 8 ? `...${k.masked_key.slice(-4)}` : k.masked_key}
                      </span>
                      {k.is_primary && !isPrimaryLabelDuplicate && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent-ring)] shrink-0">
                          Principale
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Per-Model Progress Rows */}
                  <div className="space-y-1.5">
                    {Object.values(k.models).map(m => {
                      const percentUsed = Math.min(100, Math.round((m.used_today / Math.max(1, m.limit)) * 100));
                      const isExhausted = m.is_exhausted || m.used_today >= m.limit;
                      return (
                        <div key={m.model_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 text-xs">
                          <span className="font-mono text-xs text-[var(--text-secondary)] sm:w-44 shrink-0 truncate">
                            {m.model_id}
                          </span>
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-panel)] overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 rounded-full ${
                                  isExhausted
                                    ? 'bg-[var(--error-bg)]'
                                    : percentUsed > 80
                                    ? 'bg-[var(--warning-bg)]'
                                    : 'bg-[var(--accent-bg)]'
                                }`}
                                style={{ width: `${percentUsed}%` }}
                              />
                            </div>
                            <div className="font-mono text-xs shrink-0 text-right min-w-24">
                              <span
                                className={`font-medium ${
                                  isExhausted
                                    ? 'text-[var(--error-text)] font-semibold'
                                    : m.used_today > 0
                                    ? 'text-[var(--text-primary)] font-semibold'
                                    : 'text-[var(--text-muted)]'
                                }`}
                              >
                                {m.used_today}/{m.limit}
                              </span>
                              <span className="text-[11px] text-[var(--text-muted)] ml-1">
                                ({m.remaining} rimaste)
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-[var(--text-muted)] py-2 italic">
            Inserisci una chiave API per monitorare le quote giornaliere per ciascun modello.
          </p>
        )}
      </div>

      {/* 2. Unified Diagnostics Card with streamlined header icon toolbar */}
      <div className="p-4 sm:p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] space-y-4">
        {/* Header */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-[var(--text-primary)] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
              Diagnosi e Verifica Ambiente
            </h3>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyReport}
                disabled={isCopying}
                className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 shrink-0"
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

              <button
                type="button"
                onClick={handleOpenLogsFolder}
                className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors shrink-0"
                title="Apri cartella log"
                aria-label="Apri cartella log"
              >
                <FolderOpen className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={onRunValidation}
                disabled={isValidatingEnvironment}
                className="p-1.5 rounded-lg hover:bg-[var(--sidebar-active-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 shrink-0"
                title="Verifica ambiente"
                aria-label="Verifica ambiente"
              >
                {isValidatingEnvironment ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
                ) : (
                  <FlaskConical className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            Controllo requisiti: FFmpeg, spazio libero su disco e connessione API Google.
          </p>
        </div>

        {/* Validation Checks */}
        <div className="space-y-3">
          {validationResult && (
            <div className={`alert-card ${validationResult.ok ? 'is-success' : 'is-error'} flex-row items-center gap-2 animate-fade-in`}>
              {validationResult.ok ? (
                <Check className="w-4 h-4 text-[var(--success-text)] shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-[var(--error-text)] shrink-0" />
              )}
              <span
                className="text-xs font-bold"
                style={{ color: validationResult.ok ? 'var(--success-text)' : 'var(--error-text)' }}
              >
                {validationResult.summary}
              </span>
            </div>
          )}

          <ul className="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)] pt-1">
            {displayChecks.map(check => (
              <li
                key={check.id}
                className="flex justify-between items-start py-3 gap-3 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <span className="text-xs font-semibold text-[var(--text-primary)]">{check.label}</span>
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{check.message}</p>
                  {check.details && (
                    <p className="text-[11px] font-mono text-[var(--text-muted)] break-all whitespace-pre-wrap mt-0.5 leading-relaxed">
                      {check.details}
                    </p>
                  )}
                  {(check.status === 'error' || check.status === 'warning') && check.errorMessage && (
                    <div className={`mt-2 alert-card ${check.status === 'error' ? 'is-error' : 'is-warning'} text-xs space-y-1 animate-fade-in`}>
                      <p className="font-semibold">{check.errorMessage}</p>
                      {check.errorDetails && (
                        <p className="font-mono break-all opacity-90">{check.errorDetails}</p>
                      )}
                    </div>
                  )}
                </div>
                <div className="shrink-0 pl-2 flex items-center h-full">
                  {check.status === 'pending' ? (
                    <span className="text-[10px] font-medium rounded px-1.5 py-0.5 text-[var(--text-muted)] bg-[var(--bg-panel)]">
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
      </div>
    </div>
  );
});

DiagnosticsSection.displayName = 'DiagnosticsSection';

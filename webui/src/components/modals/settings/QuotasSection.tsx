import React from 'react';
import { Activity, Clock, RefreshCw, AlertTriangle, Loader2 } from 'lucide-react';
import type { ApiUsageResult } from '../../../bridge';

interface QuotasSectionProps {
  apiUsage?: ApiUsageResult | null;
  isLoadingUsage?: boolean;
  onRefreshUsage?: () => void;
}

export const QuotasSection: React.FC<QuotasSectionProps> = React.memo(({
  apiUsage,
  isLoadingUsage,
  onRefreshUsage,
}) => {
  const totalRemainingRequests =
    apiUsage?.total_requests_remaining ??
    apiUsage?.keys?.reduce((acc, k) => {
      return (
        acc +
        Object.values(k.models || {}).reduce((mAcc, m) => mAcc + (m.remaining || 0), 0)
      );
    }, 0) ??
    0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header and Refresh Control */}
      <div className="flex items-center justify-between gap-3 pb-1">
        <div className="space-y-1 min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
            <span>Quote & Utilizzo Google AI Studio</span>
            {apiUsage && (apiUsage.keys?.length ?? 0) > 0 && (
              <span className="text-[11px] font-semibold text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-default)] px-1.5 py-0.5 rounded-full leading-none normal-case tracking-normal">
                {apiUsage.keys.length}{' '}
                {apiUsage.keys.length === 1 ? 'chiave' : 'chiavi'}
              </span>
            )}
          </h3>
          <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
            {apiUsage?.next_reset_info || 'Reset quote: ore 09:00 (fuso Google PT)'}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefreshUsage}
          disabled={isLoadingUsage}
          className="p-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 group/refresh shrink-0 cursor-pointer"
          title="Aggiorna conteggio quote"
          aria-label="Aggiorna conteggio quote"
        >
          <RefreshCw
            className={`w-4 h-4 transition-transform duration-500 ease-out ${
              isLoadingUsage
                ? 'animate-spin text-[var(--accent-text)]'
                : 'group-hover/refresh:rotate-180 group-hover/refresh:scale-105'
            }`}
          />
        </button>
      </div>

      {/* Metric Stat Cards */}
      {apiUsage && (
        <div className="grid grid-cols-2 gap-3">
          <div
            className="p-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-1 cursor-help"
            title={`${totalRemainingRequests} chiamate totali rimaste tra tutte le chiavi.`}
          >
            <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
              Chiamate Residue
            </span>
            <span
              className={`text-2xl font-bold block ${
                totalRemainingRequests === 0
                  ? 'text-[var(--error-text)]'
                  : totalRemainingRequests < 20
                  ? 'text-[var(--warning-text)]'
                  : 'text-[var(--text-primary)]'
              }`}
            >
              {totalRemainingRequests}
            </span>
          </div>

          <div
            className="p-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-1 cursor-help"
            title={`Equivalgono a circa ${apiUsage.estimated_sbobine_remaining} lezioni complete da 2h30–3h (~19 chiamate a lezione: 12 chunk audio da 15 min + 7 macro-sezioni di testo).`}
          >
            <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider block">
              Autonomia Stimata
            </span>
            <span className="text-2xl font-bold text-[var(--text-primary)] block">
              ~{apiUsage.estimated_sbobine_remaining} lezioni <span className="text-xs font-normal text-[var(--text-secondary)]">(3h)</span>
            </span>
          </div>
        </div>
      )}

      {apiUsage?.is_degraded_mode && (
        <div className="alert-card is-warning text-xs flex-row items-start gap-2 animate-fade-in">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold">Modalità Degradata Attiva</p>
            <p className="text-[var(--text-secondary)]">{apiUsage.degraded_reason}</p>
          </div>
        </div>
      )}

      {/* Keys and per-model consumption list */}
      {isLoadingUsage ? (
        <div className="py-12 flex items-center justify-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
          Caricamento quote in corso...
        </div>
      ) : apiUsage && (apiUsage.keys?.length ?? 0) > 0 ? (
        <div className="divide-y divide-[var(--border-default)] border-t border-[var(--border-default)] pt-1">
          {apiUsage.keys.map(k => {
            const hasUsage = Object.values(k.models || {}).some(m => m.used_today > 0);
            const isAnyExhausted = Object.values(k.models || {}).some(m => m.is_exhausted);
            const isPrimaryLabelDuplicate = Boolean(k.label?.toLowerCase().includes('principale'));

            return (
              <div
                key={k.id}
                className={`py-4 space-y-3 transition-colors ${
                  !hasUsage ? 'opacity-90 hover:opacity-100' : ''
                }`}
              >
                {/* Key Row Header */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                        isAnyExhausted
                          ? 'bg-[var(--error-bg)]'
                          : hasUsage
                          ? 'bg-[var(--accent-bg)]'
                          : 'bg-[var(--text-secondary)] opacity-40'
                      }`}
                    />
                    <span className="text-sm font-bold text-[var(--text-primary)] truncate">
                      {k.label}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border-default)] font-mono text-xs font-bold text-[var(--text-primary)] shrink-0">
                      {k.masked_key.length > 8 ? `...${k.masked_key.slice(-4)}` : k.masked_key}
                    </span>
                    {k.is_primary && !isPrimaryLabelDuplicate && (
                      <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent-ring)] shrink-0">
                        Principale
                      </span>
                    )}
                  </div>
                </div>

                {/* Per-Model Progress Rows */}
                <div className="space-y-2">
                  {Object.values(k.models || {}).map(m => {
                    const percentUsed = Math.min(100, Math.round((m.used_today / Math.max(1, m.limit)) * 100));
                    const isExhausted = m.is_exhausted || m.used_today >= m.limit;
                    return (
                      <div key={m.model_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 text-xs">
                        <span className="font-mono text-xs text-[var(--text-primary)] font-semibold sm:w-44 shrink-0 truncate">
                          {m.model_id}
                        </span>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--progress-bg)' }}>
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
                              className={`font-bold ${
                                isExhausted
                                  ? 'text-[var(--error-text)]'
                                  : m.used_today > 0
                                  ? 'text-[var(--text-primary)]'
                                  : 'text-[var(--text-secondary)]'
                              }`}
                            >
                              {m.used_today}/{m.limit}
                            </span>
                            <span className="text-[11px] text-[var(--text-secondary)] ml-1 font-medium">
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
        <div className="py-8 text-center space-y-2">
          <Activity className="w-8 h-8 text-[var(--text-secondary)] mx-auto opacity-50" />
          <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
            Inserisci una chiave API per monitorare le quote giornaliere per ciascun modello.
          </p>
        </div>
      )}
    </div>
  );
});

QuotasSection.displayName = 'QuotasSection';

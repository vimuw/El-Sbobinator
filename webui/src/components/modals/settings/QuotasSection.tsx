import React, { useMemo } from 'react';
import {
  Loader2,
  Gauge,
  Sparkles,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import type { ApiUsageResult, CredentialProfile } from '../../../bridge';
import { DEFAULT_MODEL, getModelDisplayName, sortModelsByVersion, MODEL_ORDER } from '../../../utils';
import { isCredentialUsableForModel, maskedSuffix } from './credentialAvailability';

interface QuotasSectionProps {
  apiUsage?: ApiUsageResult | null;
  isLoadingUsage?: boolean;
  preferredModel?: string;
}

export const QuotasSection: React.FC<QuotasSectionProps> = React.memo(
  ({
    apiUsage,
    isLoadingUsage,
    preferredModel = DEFAULT_MODEL,
  }) => {
    const effectivePreferredModel = preferredModel || DEFAULT_MODEL;

    const projectLimits = useMemo(
      () => apiUsage?.project_limits || {},
      [apiUsage?.project_limits]
    );

    // Get all supported models in version order
    const allKnownModels = useMemo(() => {
      const keys = Object.keys(projectLimits);
      const combined = Array.from(new Set([...MODEL_ORDER, ...keys]));
      return sortModelsByVersion(combined);
    }, [projectLimits]);

    const credentials: CredentialProfile[] = useMemo(() => {
      if (apiUsage?.credentials && apiUsage.credentials.length > 0) {
        return apiUsage.credentials;
      }
      return (apiUsage?.keys || []).map((k, idx) => ({
        id: k.id,
        masked_key: k.masked_key,
        label: k.label,
        is_primary: k.is_primary,
        operational_status: (k.operational_status ||
          (Object.values(k.models || {}).some(m => m.is_exhausted)
            ? 'temporarily_failing'
            : 'active')) as CredentialProfile['operational_status'],
        key_type: (idx === 0 ? 'standard_legacy' : 'unknown') as CredentialProfile['key_type'],
        project_id: null,
        last_error_message: null,
        exhausted_models: [],
      }));
    }, [apiUsage]);

    const limitsLabel = (mName: string) => {
      const lim = projectLimits[mName];
      return `${lim?.rpd_limit ? `${lim.rpd_limit} RPD` : '20 RPD standard'} • ${lim?.rpm_limit ? `${lim.rpm_limit} RPM` : '5 RPM'}`;
    };
    // When every model has the same limits, state them once in the footnote instead of per row.
    const sharedLimitsLabel = new Set(allKnownModels.map(limitsLabel)).size === 1
      ? limitsLabel(allKnownModels[0])
      : null;

    // Open the matrix by default when some key cannot serve some model today.
    const anyKeyBlocked = credentials.some(c =>
      allKnownModels.some(m => !isCredentialUsableForModel(c, m))
    );

    return (
      <div className="space-y-3 animate-fade-in">
        {/* Loading Spinner */}
        {isLoadingUsage ? (
          <div className="py-3 flex items-center justify-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            Caricamento quote in corso…
          </div>
        ) : apiUsage && credentials.length > 0 ? (
          <>
            {/* Matrix: one row per model, one column per key */}
            {allKnownModels.length > 0 && (
              <details className="settings-details is-api-quota" open={anyKeyBlocked}>
                <summary>
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Gauge className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                    Quote per modello
                  </span>
                  <ChevronDown className="w-4 h-4 shrink-0" />
                </summary>

                <div className="settings-details-content overflow-x-auto">
                  <div
                    role="table"
                    aria-label="Disponibilità delle chiavi per modello"
                    className="grid items-center text-xs min-w-max"
                    style={{ gridTemplateColumns: `minmax(9rem, 1fr) repeat(${credentials.length}, 2.75rem) 3rem` }}
                  >
                    <div role="row" className="contents">
                      <span role="columnheader" className="py-2 text-[11px] font-semibold text-[var(--text-secondary)]">Modello</span>
                      {credentials.map((c, idx) => (
                        <span
                          key={c.id || `${c.masked_key}-${idx}`}
                          role="columnheader"
                          className="py-2 text-center font-mono text-[10px] font-semibold text-[var(--text-secondary)]"
                          title={c.label || undefined}
                        >
                          {maskedSuffix(c.masked_key)}
                        </span>
                      ))}
                      <span role="columnheader" className="py-2 text-right text-[11px] font-semibold text-[var(--text-secondary)]">Totale</span>
                    </div>

                    {allKnownModels.map(mName => {
                      const modelName = getModelDisplayName(mName);
                      const readyForM = credentials.filter(c => isCredentialUsableForModel(c, mName)).length;
                      const noneReady = readyForM === 0;
                      const allReady = readyForM === credentials.length;

                      return (
                        <div key={mName} role="row" className="contents">
                          <div role="rowheader" className="py-2.5 min-w-0 border-t border-[var(--border-default)]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-[var(--text-primary)]">{modelName}</span>
                              {mName === effectivePreferredModel && (
                                <span className="text-[11px] font-semibold text-[var(--accent-text)] shrink-0">
                                  Selezionato
                                </span>
                              )}
                            </div>
                            {!sharedLimitsLabel && (
                              <span className="text-[11px] text-[var(--text-secondary)] block">
                                {limitsLabel(mName)}
                              </span>
                            )}
                          </div>
                          {credentials.map((c, idx) => {
                            const usable = isCredentialUsableForModel(c, mName);
                            const keyName = c.label || `Chiave ...${maskedSuffix(c.masked_key)}`;
                            const text = `${keyName}: ${usable ? 'disponibile' : 'non disponibile'} per ${modelName}`;
                            return (
                              <span
                                key={c.id || `${c.masked_key}-${idx}`}
                                role="cell"
                                aria-label={text}
                                title={text}
                                className="py-2.5 self-stretch flex items-center justify-center border-t border-[var(--border-default)]"
                              >
                                {usable ? (
                                  <Check className="w-4 h-4 text-[var(--success-text)]" aria-hidden="true" />
                                ) : (
                                  <X className="w-4 h-4 text-[var(--warning-text)]" aria-hidden="true" />
                                )}
                              </span>
                            );
                          })}
                          <span
                            role="cell"
                            className={`py-2.5 self-stretch flex items-center justify-end font-semibold border-t border-[var(--border-default)] ${
                              noneReady
                                ? 'text-[var(--error-text)]'
                                : allReady
                                ? 'text-[var(--text-secondary)]'
                                : 'text-[var(--warning-text)]'
                            }`}
                            aria-label={`${readyForM} di ${credentials.length} chiavi disponibili per ${modelName}`}
                          >
                            {readyForM}/{credentials.length}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <p className="settings-details-note text-xs text-[var(--text-secondary)] flex items-start gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                  <span>
                    {sharedLimitsLabel && `Limiti per chiave su ogni modello: ${sharedLimitsLabel}. `}
                    RPD: richieste al giorno · RPM: richieste al minuto. Una chiave che ha esaurito la quota su un modello può essere ancora disponibile sugli altri.
                  </span>
                </p>
              </details>
            )}


          </>
        ) : (
          <div className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
            <Gauge className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Inserisci una chiave API in Generale per visualizzare lo stato delle quote e la disponibilità delle risorse.
            </p>
          </div>
        )}
      </div>
    );
  }
);

QuotasSection.displayName = 'QuotasSection';

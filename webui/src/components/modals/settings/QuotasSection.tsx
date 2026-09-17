import React, { useMemo } from 'react';
import {
  Activity,
  Clock,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Cpu,
  Sparkles,
} from 'lucide-react';
import type { ApiUsageResult, CredentialProfile, ModelOption } from '../../../bridge';
import { getModelDisplayName, sortModelsByVersion, MODEL_ORDER } from '../../../utils';

interface QuotasSectionProps {
  apiUsage?: ApiUsageResult | null;
  isLoadingUsage?: boolean;
  onRefreshUsage?: () => void;
  preferredModel?: string;
  availableModels?: ModelOption[];
}

export const QuotasSection: React.FC<QuotasSectionProps> = React.memo(
  ({
    apiUsage,
    isLoadingUsage,
    onRefreshUsage,
    preferredModel = 'gemini-2.5-flash',
    availableModels = [],
  }) => {
    const primaryStatus = apiUsage?.primary_status ?? 'operational';
    const effectivePreferredModel = preferredModel || 'gemini-2.5-flash';

    const getStatusHero = () => {
      switch (primaryStatus) {
        case 'rate_limited':
          return {
            containerClass: 'alert-card is-warning !flex-row items-start gap-3',
            icon: <Clock className="w-5 h-5 shrink-0 text-[var(--warning-text)] animate-pulse" />,
            title: 'In attesa — Rate limit temporaneo',
            subtitle:
              apiUsage?.status_message ||
              (apiUsage?.retry_after_seconds
                ? `Ripresa automatica tra ${Math.round(apiUsage.retry_after_seconds)}s.`
                : 'In attesa del raffreddamento dei limiti al minuto (RPM/TPM).'),
          };
        case 'quota_exhausted':
          return {
            containerClass: 'alert-card is-error !flex-row items-start gap-3',
            icon: <AlertCircle className="w-5 h-5 shrink-0 text-[var(--error-text)]" />,
            title: 'Quota giornaliera esaurita (RPD)',
            subtitle:
              apiUsage?.status_message ||
              'Tutte le risorse per il modello selezionato hanno esaurito i turni giornalieri gratuiti. Reset automatico alle ore 09:00 (ora italiana / 00:00 PT).',
          };
        case 'degraded':
          return {
            containerClass: 'alert-card is-warning !flex-row items-start gap-3',
            icon: <AlertTriangle className="w-5 h-5 shrink-0 text-[var(--warning-text)]" />,
            title: 'Modalità Riserva Attiva',
            subtitle:
              apiUsage?.degraded_reason ||
              apiUsage?.status_message ||
              'Chiave principale esaurita per oggi con questo modello. Il lavoro prosegue automaticamente con le chiavi di riserva.',
          };
        case 'credential_error':
          return {
            containerClass: 'alert-card is-error !flex-row items-start gap-3',
            icon: <XCircle className="w-5 h-5 shrink-0 text-[var(--error-text)]" />,
            title: 'Errore Autenticazione API',
            subtitle:
              apiUsage?.status_message ||
              'Chiave API non valida o permessi insufficienti sul progetto Google.',
          };
        case 'operational':
        default:
          return {
            containerClass:
              'rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] flex items-start gap-3',
            icon: <CheckCircle2 className="w-5 h-5 shrink-0 text-[var(--accent-text)]" />,
            title: 'API Google Gemini Operativa',
            subtitle:
              apiUsage?.status_message ||
              'Tutti i sistemi sono pronti e sincronizzati per nuove sbobinature.',
          };
      }
    };

    const hero = getStatusHero();

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

    const otherModels = useMemo(
      () => allKnownModels.filter(m => m !== effectivePreferredModel),
      [allKnownModels, effectivePreferredModel]
    );

    const activeModelSummary = useMemo(() => {
      const found = availableModels.find(m => m.id === effectivePreferredModel);
      return found?.summary;
    }, [availableModels, effectivePreferredModel]);

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

    // Active model calculations

    const activeModelReadyCreds = useMemo(
      () =>
        credentials.filter(
          c =>
            c.operational_status !== 'invalid' &&
            c.operational_status !== 'permission_denied' &&
            !(c.exhausted_models || []).includes(effectivePreferredModel)
        ),
      [credentials, effectivePreferredModel]
    );

    const primaryCred = credentials.find(c => c.is_primary);
    const isPrimaryExhaustedOnActive = Boolean(
      primaryCred && (primaryCred.exhausted_models || []).includes(effectivePreferredModel)
    );

    const activeFallbackCred = isPrimaryExhaustedOnActive
      ? activeModelReadyCreds.find(c => !c.is_primary)
      : null;

    return (
      <div className="space-y-6 animate-fade-in">
        {/* 1. Header & Refresh Control */}
        <div className="flex items-center justify-between gap-3 pb-1">
          <div className="space-y-1 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
              <span>Quote API & Risorse</span>
              {credentials.length > 0 && (
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-default)] px-2.5 py-0.5 rounded-full leading-normal normal-case tracking-normal inline-flex items-center justify-center">
                  {credentials.length} {credentials.length === 1 ? 'chiave' : 'chiavi'}
                </span>
              )}
            </h3>
            <p className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
              {apiUsage?.next_reset_info || 'Reset automatico alle 09:00 (ora italiana / 00:00 PT)'}
            </p>
          </div>

          <button
            type="button"
            onClick={onRefreshUsage}
            disabled={isLoadingUsage}
            className="p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-default)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors disabled:opacity-40 group/refresh shrink-0 cursor-pointer"
            title="Aggiorna telemetria e stato quote"
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

        {/* Loading Spinner */}
        {isLoadingUsage ? (
          <div className="py-12 flex items-center justify-center gap-2 text-xs font-medium text-[var(--text-secondary)]">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--accent-text)]" />
            Caricamento telemetria e stato quote in corso...
          </div>
        ) : apiUsage && credentials.length > 0 ? (
          <>
            {/* 2. Primary Operational Status Banner */}
            <div className={`p-3.5 transition-colors ${hero.containerClass}`}>
              {hero.icon}
              <div className="space-y-0.5 min-w-0 flex-1">
                <p className="text-sm font-bold tracking-tight">{hero.title}</p>
                <p className="text-xs opacity-90 leading-relaxed">{hero.subtitle}</p>
              </div>
            </div>

            {/* 3. Card Modello Attivo & Autonomia Stimata */}
            <div className="p-4 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-default)] pb-3">
                <div className="space-y-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Cpu className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                    <span className="text-sm font-bold text-[var(--text-primary)]">
                      {getModelDisplayName(effectivePreferredModel)}
                    </span>
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent-ring)] leading-normal">
                      In uso
                    </span>
                  </div>
                  {activeModelSummary && (
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      {activeModelSummary}
                    </p>
                  )}
                </div>
              </div>

              {/* Metriche Autonomia e Chiavi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-default)] space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider block">
                    Autonomia Stimata
                  </span>
                  <span className="text-sm font-bold text-[var(--text-primary)] block">
                    {activeModelReadyCreds.length > 0
                      ? `~${activeModelReadyCreds.length}–${activeModelReadyCreds.length * 2} lezioni stimate oggi`
                      : 'Quota esaurita per oggi'}
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block">
                    {activeModelReadyCreds.length > 0
                      ? 'Basata sui limiti di richieste giornaliere (RPD)'
                      : 'Reset alle 09:00 o seleziona un altro modello'}
                  </span>
                </div>

                <div className="p-3 rounded-lg bg-[var(--bg-app)] border border-[var(--border-default)] space-y-1">
                  <span className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider block">
                    Chiavi Pronte
                  </span>
                  <span className="text-sm font-bold text-[var(--text-primary)] block">
                    {activeModelReadyCreds.length} su {credentials.length} chiavi pronte
                  </span>
                  <span className="text-[11px] text-[var(--text-secondary)] block">
                    {activeModelReadyCreds.length === 0
                      ? credentials.length === 1
                        ? 'Quota esaurita (nessuna riserva configurata)'
                        : 'Tutte le chiavi hanno esaurito la quota'
                      : isPrimaryExhaustedOnActive && activeFallbackCred
                      ? 'Chiave principale esaurita — riserva subentrata'
                      : activeModelReadyCreds.length === credentials.length
                      ? 'Tutte le chiavi operative per questo modello'
                      : 'Alcune chiavi hanno esaurito la quota'}
                  </span>
                </div>
              </div>

              {/* Avviso Riserva (compatto e non ridondante) */}
              {isPrimaryExhaustedOnActive && activeFallbackCred && (
                <div className="text-xs text-[var(--warning-text)] bg-[var(--warning-subtle,var(--bg-surface))] px-3 py-2 rounded-lg border border-[var(--warning-ring)] flex items-center gap-2 leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>
                    La Chiave Principale ha esaurito la quota per questo modello. El Sbobinator sta utilizzando automaticamente la <strong>{activeFallbackCred.label || 'Chiave di Riserva'}</strong>.
                  </span>
                </div>
              )}
            </div>

            {/* 4. Panoramica Altri Modelli Supportati (Quote Separate) */}
            {otherModels.length > 0 && (
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Altri Modelli Disponibili (Quote Separate)
                  </h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {otherModels.map(mName => {
                    const lim = projectLimits[mName];
                    const readyForM = credentials.filter(
                      c =>
                        c.operational_status !== 'invalid' &&
                        c.operational_status !== 'permission_denied' &&
                        !(c.exhausted_models || []).includes(mName)
                    ).length;

                    const allReady = readyForM === credentials.length;
                    const noneReady = readyForM === 0;

                    return (
                      <div
                        key={mName}
                        className="p-2.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--text-primary)] block truncate">
                            {getModelDisplayName(mName)}
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)] block">
                            {lim?.rpd_limit ? `${lim.rpd_limit} RPD` : '20 RPD standard'} •{' '}
                            {lim?.rpm_limit ? `${lim.rpm_limit} RPM` : '5 RPM'}
                          </span>
                        </div>

                        <div className="shrink-0">
                          {noneReady ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border border-[var(--error-ring)] inline-flex items-center justify-center leading-normal">
                              0/{credentials.length} pronte
                            </span>
                          ) : allReady ? (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-default)] inline-flex items-center justify-center leading-normal">
                              {credentials.length}/{credentials.length} pronte
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)] border border-[var(--warning-ring)] inline-flex items-center justify-center leading-normal">
                              {readyForM}/{credentials.length} pronte
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="text-[11px] text-[var(--text-secondary)] flex items-center gap-1.5 pt-1">
                  <Sparkles className="w-3.5 h-3.5 text-[var(--accent-text)] shrink-0" />
                  <span>
                    Ciascun modello Google dispone di quote giornaliere separate (reset alle 09:00). Se una chiave esaurisce la quota su un modello, rimane utilizzabile sugli altri.
                  </span>
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center space-y-2">
            <Activity className="w-8 h-8 text-[var(--text-secondary)] mx-auto opacity-50" />
            <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
              Inserisci una chiave API in Generale per visualizzare l&apos;autonomia stimata, lo stato delle quote e la disponibilità delle risorse.
            </p>
          </div>
        )}
      </div>
    );
  }
);

QuotasSection.displayName = 'QuotasSection';

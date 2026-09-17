import React from 'react';
import {
  Activity,
  Clock,
  RefreshCw,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Layers,
  Cpu,
  Key,
} from 'lucide-react';
import type { ApiUsageResult, CredentialProfile } from '../../../bridge';

interface QuotasSectionProps {
  apiUsage?: ApiUsageResult | null;
  isLoadingUsage?: boolean;
  onRefreshUsage?: () => void;
}

export const QuotasSection: React.FC<QuotasSectionProps> = React.memo(
  ({ apiUsage, isLoadingUsage, onRefreshUsage }) => {
    const primaryStatus = apiUsage?.primary_status ?? 'operational';

    const getStatusHero = () => {
      switch (primaryStatus) {
        case 'rate_limited':
          return {
            containerClass:
              'border-[var(--warning-border,var(--border-default))] bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)]',
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
            containerClass:
              'border-[var(--error-border,var(--border-default))] bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)]',
            icon: <AlertCircle className="w-5 h-5 shrink-0 text-[var(--error-text)]" />,
            title: 'Quota giornaliera esaurita (RPD)',
            subtitle:
              apiUsage?.status_message ||
              'La quota giornaliera gratuita del progetto è terminata. Reset automatico alle ore 09:00 (fuso PT).',
          };
        case 'degraded':
          return {
            containerClass:
              'border-[var(--warning-border,var(--border-default))] bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)]',
            icon: <AlertTriangle className="w-5 h-5 shrink-0 text-[var(--warning-text)]" />,
            title: 'Modalità Riserva Attiva',
            subtitle:
              apiUsage?.degraded_reason ||
              apiUsage?.status_message ||
              'Chiave o modello primario esaurito per oggi. Il lavoro prosegue automaticamente con le risorse di riserva.',
          };
        case 'credential_error':
          return {
            containerClass:
              'border-[var(--error-border,var(--border-default))] bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)]',
            icon: <XCircle className="w-5 h-5 shrink-0 text-[var(--error-text)]" />,
            title: 'Errore Autenticazione API',
            subtitle:
              apiUsage?.status_message ||
              'Chiave API non valida o permessi non sufficienti sul progetto Google.',
          };
        case 'operational':
        default:
          return {
            containerClass:
              'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)]',
            icon: <CheckCircle2 className="w-5 h-5 shrink-0 text-[var(--accent-text)]" />,
            title: 'API Google Gemini Operativa',
            subtitle:
              apiUsage?.status_message ||
              'Tutti i sistemi sono pronti e sincronizzati per nuove sbobinature.',
          };
      }
    };

    const hero = getStatusHero();
    const projectLimits = apiUsage?.project_limits || {};
    const modelKeys = Object.keys(projectLimits);
    const telemetry = apiUsage?.telemetry;
    const workStats = apiUsage?.work_stats;
    const credentials: CredentialProfile[] =
      apiUsage?.credentials && apiUsage.credentials.length > 0
        ? apiUsage.credentials
        : (apiUsage?.keys || []).map((k, idx) => ({
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
          }));


    const renderCredentialStatusBadge = (cred: CredentialProfile) => {
      const status = cred.operational_status;
      const isQuotaExhausted =
        status === 'temporarily_failing' &&
        (!cred.last_error_message ||
          cred.last_error_message.toLowerCase().includes('quota') ||
          cred.last_error_message.toLowerCase().includes('rpd') ||
          cred.last_error_code === 429);

      const baseBadge =
        'text-[11px] font-semibold px-2.5 py-0.5 rounded-full inline-flex items-center justify-center leading-normal shrink-0';

      switch (status) {
        case 'active':
          return (
            <span className={`${baseBadge} bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent-ring)]`}>
              Attiva
            </span>
          );
        case 'unused':
          return (
            <span className={`${baseBadge} bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]`}>
              In standby
            </span>
          );
        case 'temporarily_failing':
          return (
            <span className={`${baseBadge} bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)] border border-[var(--warning-border,var(--border-default))]`}>
              {isQuotaExhausted ? 'Quota esaurita (oggi)' : 'Non disponibile (temporaneo)'}
            </span>
          );
        case 'invalid':
          return (
            <span className={`${baseBadge} bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border border-[var(--error-border,var(--border-default))]`}>
              Non valida (401)
            </span>
          );
        case 'permission_denied':
          return (
            <span className={`${baseBadge} bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border border-[var(--error-border,var(--border-default))]`}>
              Permesso negato (403)
            </span>
          );
        case 'request_error':
          return (
            <span className={`${baseBadge} bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border border-[var(--error-border,var(--border-default))]`}>
              Errore richiesta (400)
            </span>
          );
        default:
          return (
            <span className={`${baseBadge} bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-default)]`}>
              Stato sconosciuto
            </span>
          );
      }
    };

    return (
      <div className="space-y-6 animate-fade-in">
        {/* Header and Refresh Control */}
        <div className="flex items-center justify-between gap-3 pb-1">
          <div className="space-y-1 min-w-0">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
              <span>Quote & Telemetria API</span>
              {apiUsage && credentials.length > 0 && (
                <span className="text-[11px] font-semibold text-[var(--text-secondary)] bg-[var(--bg-surface)] border border-[var(--border-default)] px-2.5 py-0.5 rounded-full leading-normal normal-case tracking-normal inline-flex items-center justify-center">
                  {credentials.length} {credentials.length === 1 ? 'chiave' : 'chiavi'}
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
        ) : apiUsage ? (
          <>
            {/* Primary Operational Status Banner (State-First Hero) */}
            <div
              className={`p-4 rounded-xl border flex items-start gap-3 transition-colors ${hero.containerClass}`}
            >
              {hero.icon}
              <div className="space-y-0.5 min-w-0 flex-1">
                <p className="text-sm font-bold tracking-tight">{hero.title}</p>
                <p className="text-xs opacity-90 leading-relaxed">{hero.subtitle}</p>
              </div>
            </div>

            {/* Metric Stat Cards (Work Done + Telemetry Activity) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Card 1: Work Done */}
              <div className="p-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center gap-2">
                  <Layers className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Lavoro Svolto Oggi
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[var(--border-default)] text-center">
                  <div>
                    <span className="text-lg font-bold text-[var(--text-primary)] block">
                      {workStats?.chunks_completed ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium">
                      Chunk
                    </span>
                  </div>
                  <div>
                    <span className="text-lg font-bold text-[var(--text-primary)] block">
                      {workStats?.revisions_completed ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium">
                      Revisioni
                    </span>
                  </div>
                  <div>
                    <span className="text-lg font-bold text-[var(--text-primary)] block">
                      {workStats?.sbobine_completed ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium">
                      Sbobine
                    </span>
                  </div>
                </div>
              </div>

              {/* Card 2: Telemetry API */}
              <div className="p-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[var(--accent-text)] shrink-0" />
                  <span className="text-[11px] font-bold text-[var(--text-secondary)] uppercase tracking-wider">
                    Telemetria Chiamate
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1.5 pt-1 border-t border-[var(--border-default)] text-center">
                  <div>
                    <span className="text-lg font-bold text-[var(--text-primary)] block">
                      {telemetry?.requests_sent ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate block">
                      Inviate
                    </span>
                  </div>
                  <div>
                    <span className="text-lg font-bold text-[var(--text-primary)] block">
                      {telemetry?.responses_succeeded ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate block">
                      Successi
                    </span>
                  </div>
                  <div>
                    <span className="text-lg font-bold text-[var(--warning-text)] block">
                      {telemetry?.retries_total ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate block">
                      Retry
                    </span>
                  </div>
                  <div>
                    <span
                      className={`text-lg font-bold block ${
                        (telemetry?.final_failures ?? 0) > 0
                          ? 'text-[var(--error-text)]'
                          : 'text-[var(--text-secondary)]'
                      }`}
                    >
                      {telemetry?.final_failures ?? 0}
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)] font-medium truncate block">
                      Errori
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Section: Project / Model Limits */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                  Limiti di Progetto & Modelli
                </h4>
              </div>

              {/* Disclaimer Notice */}
              <div className="p-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] text-xs text-[var(--text-secondary)] leading-relaxed flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[var(--accent-text)] shrink-0 mt-0.5" />
                <p>
                  I tetti di richieste giornaliere (RPD) e al minuto (RPM) sono vincolati all&apos;intero
                  <strong> Progetto Google Cloud</strong>. L&apos;aggiunta di ulteriori chiavi dello stesso progetto
                  non moltiplica la quota complessiva.
                </p>
              </div>

              {/* Model Limit Rows */}
              {modelKeys.length > 0 && (
                <div className="border border-[var(--border-default)] rounded-xl divide-y divide-[var(--border-default)] overflow-hidden bg-[var(--bg-surface)]">
                  {modelKeys.map(mName => {
                    const lim = projectLimits[mName];
                    const isExhausted = lim?.quota_state === 'rpd_exhausted';
                    const isRateLimited = lim?.quota_state === 'rate_limited';
                    const modelLabels: Record<string, string> = {
                      'gemini-2.5-flash': 'Gemini 2.5 Flash',
                      'gemini-3.6-flash': 'Gemini 3.6 Flash',
                      'gemini-3.8-flash': 'Gemini 3.8 Flash',
                      'gemini-3.7-flash': 'Gemini 3.7 Flash',
                      'gemini-3.5-flash': 'Gemini 3.5 Flash',
                    };
                    const displayLabel = modelLabels[mName] || mName;

                    return (
                      <div
                        key={mName}
                        className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-[var(--text-primary)]">
                              {displayLabel}
                            </span>
                          </div>
                          <span className="text-[11px] text-[var(--text-secondary)] block">
                            {lim?.rpd_limit ? `${lim.rpd_limit} RPD` : 'RPD standard'} •{' '}
                            {lim?.rpm_limit ? `${lim.rpm_limit} RPM` : 'RPM standard'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          {isExhausted ? (
                            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--error-subtle,var(--bg-surface))] text-[var(--error-text)] border border-[var(--error-border,var(--border-default))] inline-flex items-center justify-center leading-normal shrink-0">
                              Esaurito oggi (RPD)
                            </span>
                          ) : isRateLimited ? (
                            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--warning-subtle,var(--bg-surface))] text-[var(--warning-text)] border border-[var(--warning-border,var(--border-default))] inline-flex items-center justify-center leading-normal shrink-0">
                              Rate limited (RPM)
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-default)] inline-flex items-center justify-center leading-normal shrink-0">
                              Normale
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Section: Configured Credentials Diagnostics */}
            {credentials.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-[var(--text-secondary)] shrink-0" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)]">
                    Stato Chiavi Configurate
                  </h4>
                </div>

                <div className="border border-[var(--border-default)] rounded-xl divide-y divide-[var(--border-default)] overflow-hidden bg-[var(--bg-surface)]">
                  {credentials.map((cred, idx) => {
                    const maskedDisplay =
                      cred.masked_key && cred.masked_key.length > 8
                        ? `...${cred.masked_key.slice(-4)}`
                        : cred.masked_key;

                    const isQuotaError =
                      Boolean(cred.last_error_message &&
                      (cred.last_error_message.toLowerCase().includes('quota') ||
                        cred.last_error_message.toLowerCase().includes('rpd') ||
                        cred.last_error_code === 429));

                    return (
                      <div key={cred.id || idx} className="p-3 space-y-1.5 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0 flex-wrap">
                            <span className="font-bold text-[var(--text-primary)]">
                              {cred.label || (cred.is_primary ? 'Chiave Principale' : `Chiave Riserva ${idx}`)}
                            </span>
                            <span className="px-2.5 py-0.5 rounded-full bg-[var(--bg-hover)] border border-[var(--border-default)] font-mono text-[11px] text-[var(--text-primary)] font-semibold inline-flex items-center leading-normal">
                              {maskedDisplay}
                            </span>
                            {cred.is_primary && (
                              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--accent-subtle)] text-[var(--accent-text)] border border-[var(--accent-ring)] inline-flex items-center leading-normal">
                                Principale
                              </span>
                            )}
                            {cred.project_id && (
                              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-default)] inline-flex items-center leading-normal">
                                Progetto: {cred.project_id}
                              </span>
                            )}
                          </div>

                          <div>{renderCredentialStatusBadge(cred)}</div>
                        </div>

                        {cred.last_error_message && !isQuotaError && (
                          <div className="text-[11px] text-[var(--error-text)] bg-[var(--error-subtle,var(--bg-surface))] p-2 rounded-lg border border-[var(--error-border,var(--border-default))] leading-relaxed">
                            Errore: {cred.last_error_message}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="py-8 text-center space-y-2">
            <Activity className="w-8 h-8 text-[var(--text-secondary)] mx-auto opacity-50" />
            <p className="text-xs text-[var(--text-secondary)] max-w-sm mx-auto leading-relaxed">
              Inserisci una chiave API per visualizzare lo stato operativo, i limiti di progetto e la telemetria.
            </p>
          </div>
        )}
      </div>
    );
  }
);

QuotasSection.displayName = 'QuotasSection';

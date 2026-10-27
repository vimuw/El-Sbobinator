// Port of el_sbobinator/services/usage_service.py for the web build: what each key can still do
// today, kept in this browser's localStorage. Like the desktop it does not count requests against
// the limit (Google does not say how many are left): a key is marked exhausted on a model when
// Gemini answers with the daily quota error, and invalid when Gemini rejects it. Everything
// transient is cleared at Pacific midnight, when Google resets the free tier.
// Keys are stored only as a short hash and a masked form, never in clear.

import type { ApiUsageResult, CredentialProfile, ProjectModelLimit } from '../bridge';
import { PROFILE_MODEL_OPTIONS } from '../generationProfile';
import { STORAGE_KEYS } from '../storageKeys';
import { DEFAULT_MODEL } from '../utils';
import { GeminiHttpError, type GenerateUsage } from './pipeline/gemini';
import { errorCode, errorText, isDailyOrKeyExhausted, isQuotaRelated } from './pipeline/retry';

type OperationalStatus = NonNullable<CredentialProfile['operational_status']>;

interface StoredCredential {
  masked_key: string;
  operational_status: OperationalStatus;
  last_error_code: number | null;
  last_error_message: string | null;
  last_error_iso: string | null;
  last_used_iso: string | null;
  exhausted_models: string[];
}

interface UsageState {
  schema_version: 1;
  quota_date: string;
  credentials: Record<string, StoredCredential>;
}

// usage_service: MODEL_RPD_LIMITS / MODEL_RPM_LIMITS / DEFAULT_FLASH_TPM for the free tier.
const RPD_LIMIT = 20;
const RPM_LIMIT = 5;
const TPM_LIMIT = 250000;
export const NEXT_RESET_INFO = 'Reset quote: ore 09:00 (ora italiana / 00:00 PT)';

const SUPPORTED_MODELS = PROFILE_MODEL_OPTIONS.map(option => option.id);

/** The Pacific date Google's daily quota belongs to (usage_service.get_pacific_date_string). */
export function pacificDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Short stable id for a key (cyrb53): enough to tell keys apart, not to recover them. */
export function hashKey(apiKey: string): string {
  const cleaned = apiKey.trim();
  if (!cleaned) return 'anonymous';
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

/** usage_service.mask_key. */
export function maskKey(apiKey: string): string {
  const cleaned = apiKey.trim();
  if (!cleaned) return 'Chiave assente';
  if (cleaned.length <= 8) return `${cleaned.slice(0, 2)}...${cleaned.slice(-2)}`;
  return `${cleaned.slice(0, 6)}...${cleaned.slice(-4)}`;
}

/** gemini_errors.classify_credential_status, for the statuses that are stored. */
function credentialStatusFor(error: unknown): 'invalid' | 'permission_denied' | 'request_error' | null {
  const code = errorCode(error);
  const text = errorText(error);
  if (code === 401 || ['api key not valid', 'api_key_invalid', 'invalid api key', 'invalid_api_key', 'malformed api key', 'unauthenticated', 'not authorized', 'unauthorized'].some(marker => text.includes(marker))) return 'invalid';
  if (code === 403 || ['permission_denied', 'permission denied', 'forbidden', 'access denied', 'does not have permission'].some(marker => text.includes(marker))) return 'permission_denied';
  if (code === 400 || ['invalid_argument', 'bad request', 'request_error'].some(marker => text.includes(marker))) return 'request_error';
  return null;
}

export interface ApiUsageStore extends GenerateUsage {
  markQuotaExhausted(apiKey: string, model: string): void;
  /** get_daily_usage: the panel data for these keys, in rotation order. */
  getDailyUsage(primaryKey: string, fallbackKeys: string[], primaryModel: string): ApiUsageResult;
  /** "Verifica connessione": clears transient failures and applies the result of a models.get probe. */
  refresh(primaryKey: string, probe: 'active' | 'invalid' | 'permission_denied' | null, code?: number | null, message?: string | null): void;
}

export function createApiUsageStore(storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage, now: () => Date = () => new Date()): ApiUsageStore {
  const emptyState = (): UsageState => ({ schema_version: 1, quota_date: pacificDateString(now()), credentials: {} });

  const load = (): UsageState => {
    let state: UsageState;
    try {
      const parsed = JSON.parse(storage.getItem(STORAGE_KEYS.WEB_API_USAGE_V1) ?? 'null') as UsageState | null;
      state = parsed && parsed.schema_version === 1 && parsed.credentials ? parsed : emptyState();
    } catch {
      state = emptyState();
    }
    // _check_and_reset_unlocked: a new Pacific day clears exhaustion and transient failures.
    const today = pacificDateString(now());
    if (state.quota_date !== today) {
      state.quota_date = today;
      for (const cred of Object.values(state.credentials)) {
        cred.exhausted_models = [];
        if (cred.operational_status === 'temporarily_failing') {
          cred.operational_status = cred.last_used_iso ? 'active' : 'unused';
          cred.last_error_code = null;
          cred.last_error_message = null;
        }
      }
    }
    return state;
  };

  const save = (state: UsageState) => {
    try {
      storage.setItem(STORAGE_KEYS.WEB_API_USAGE_V1, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the panel just shows less, the run is unaffected.
    }
  };

  const credentialFor = (state: UsageState, apiKey: string): StoredCredential => {
    const id = hashKey(apiKey);
    return (state.credentials[id] ??= {
      masked_key: maskKey(apiKey),
      operational_status: 'unused',
      last_error_code: null,
      last_error_message: null,
      last_error_iso: null,
      last_used_iso: null,
      exhausted_models: [],
    });
  };

  const update = (apiKey: string, change: (cred: StoredCredential, iso: string) => void) => {
    if (!apiKey.trim()) return;
    const state = load();
    change(credentialFor(state, apiKey), now().toISOString());
    save(state);
  };

  const markQuotaExhausted = (apiKey: string, model: string) => update(apiKey, (cred, iso) => {
    if (!cred.exhausted_models.includes(model)) cred.exhausted_models.push(model);
    cred.operational_status = 'temporarily_failing';
    cred.last_error_code = 429;
    cred.last_error_message = `Quota giornaliera (RPD) esaurita per ${model}`;
    cred.last_error_iso = iso;
  });

  return {
    recordAttempt: (apiKey, _model) => update(apiKey, (cred, iso) => {
      if (cred.operational_status === 'unused' || cred.operational_status === 'temporarily_failing') cred.operational_status = 'active';
      cred.last_used_iso = iso;
    }),

    recordSuccess: (apiKey, model) => update(apiKey, (cred, iso) => {
      cred.operational_status = 'active';
      cred.last_used_iso = iso;
      cred.exhausted_models = cred.exhausted_models.filter(m => m !== model);
    }),

    recordFailure: (apiKey, model, error) => {
      const text = errorText(error);
      const code = errorCode(error);
      if (isQuotaRelated(text, code)) {
        if (isDailyOrKeyExhausted(text, code)) markQuotaExhausted(apiKey, model);
        return;
      }
      const status = credentialStatusFor(error);
      if (!status) return;
      update(apiKey, (cred, iso) => {
        cred.operational_status = status;
        cred.last_error_code = code;
        cred.last_error_message = (error instanceof GeminiHttpError ? error.apiMessage : String(error)).slice(0, 200);
        cred.last_error_iso = iso;
      });
    },

    markQuotaExhausted,

    refresh: (primaryKey, probe, code = null, message = null) => {
      const state = load();
      for (const cred of Object.values(state.credentials)) {
        if (cred.operational_status === 'temporarily_failing' && cred.exhausted_models.length === 0) {
          cred.operational_status = cred.last_used_iso ? 'active' : 'unused';
          cred.last_error_code = null;
          cred.last_error_message = null;
        }
      }
      if (primaryKey.trim() && probe) {
        const cred = credentialFor(state, primaryKey);
        if (probe === 'active' && (cred.operational_status === 'invalid' || cred.operational_status === 'permission_denied')) {
          cred.operational_status = cred.last_used_iso ? 'active' : 'unused';
          cred.last_error_code = null;
          cred.last_error_message = null;
        } else if (probe !== 'active') {
          cred.operational_status = probe;
          cred.last_error_code = code;
          cred.last_error_message = message?.slice(0, 200) ?? null;
        }
      }
      save(state);
    },

    getDailyUsage: (primaryKey, fallbackKeys, primaryModel) => {
      const state = load();
      const model = primaryModel.trim() || DEFAULT_MODEL;
      const seen = new Set<string>();
      const ordered: Array<{ key: string; isPrimary: boolean; label: string }> = [];
      const primary = primaryKey.trim();
      if (primary) {
        ordered.push({ key: primary, isPrimary: true, label: 'Chiave Principale' });
        seen.add(primary);
      }
      fallbackKeys.forEach((raw, idx) => {
        const key = raw.trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          ordered.push({ key, isPrimary: false, label: `Chiave Riserva ${idx + 1}` });
        }
      });

      const credentials: CredentialProfile[] = ordered.map(({ key, isPrimary, label }) => {
        const stored = credentialFor(state, key);
        return {
          id: hashKey(key),
          masked_key: stored.masked_key,
          label,
          is_primary: isPrimary,
          operational_status: stored.operational_status,
          key_type: 'unknown',
          project_id: null,
          last_error_code: stored.last_error_code,
          last_error_message: stored.last_error_message,
          last_error_iso: stored.last_error_iso,
          last_used_iso: stored.last_used_iso,
          exhausted_models: [...stored.exhausted_models],
        };
      });
      save(state);

      // _build_ordered_project_limits: a model is exhausted only when no usable key is left for it.
      const usable = (c: CredentialProfile, m: string) =>
        c.operational_status !== 'invalid' && c.operational_status !== 'permission_denied' && !(c.exhausted_models ?? []).includes(m);
      const project_limits: Record<string, ProjectModelLimit> = {};
      for (const m of SUPPORTED_MODELS) {
        project_limits[m] = {
          model_name: m,
          rpd_limit: RPD_LIMIT,
          rpm_limit: RPM_LIMIT,
          tpm_limit: TPM_LIMIT,
          source: 'configured',
          quota_state: credentials.length > 0 && !credentials.some(c => usable(c, m)) ? 'rpd_exhausted' : 'normal',
          updated_at: null,
        };
      }

      // _determine_primary_status.
      let primary_status: ApiUsageResult['primary_status'] = 'operational';
      let status_message = 'API Google Gemini operative.';
      let is_degraded_mode = false;
      let degraded_reason: string | null = null;
      const hasActive = credentials.some(c => c.operational_status === 'active' || c.operational_status === 'unused');
      const primaryCred = credentials.find(c => c.is_primary);
      if (credentials.length === 0) {
        primary_status = 'unknown';
        status_message = 'Nessuna chiave API configurata.';
      } else if (credentials.some(c => c.operational_status === 'invalid') && !hasActive) {
        primary_status = 'credential_error';
        status_message = 'Chiave API non valida (HTTP 401). Verifica le impostazioni.';
      } else if (credentials.some(c => c.operational_status === 'permission_denied') && !hasActive) {
        primary_status = 'credential_error';
        status_message = 'Permessi insufficienti sul progetto Google (HTTP 403).';
      } else if ((primaryCred && (primaryCred.exhausted_models ?? []).includes(model)) || project_limits[model]?.quota_state === 'rpd_exhausted') {
        if (credentials.some(c => !c.is_primary && usable(c, model))) {
          primary_status = 'degraded';
          status_message = 'Modalità riserva: elaborazione su chiave di riserva.';
          is_degraded_mode = true;
          degraded_reason = 'Chiave principale esaurita per oggi. Il lavoro prosegue automaticamente sulla chiave di riserva.';
        } else {
          primary_status = 'quota_exhausted';
          status_message = 'Quota giornaliera (RPD) esaurita. Reset alle ore 09:00 (ora italiana / 00:00 PT).';
        }
      }

      return {
        schema_version: 2,
        quota_date: state.quota_date,
        primary_status,
        status_message,
        retry_after_seconds: null,
        next_reset_info: NEXT_RESET_INFO,
        project_limits,
        credentials,
        is_degraded_mode,
        degraded_reason,
        keys: credentials.map(c => ({
          id: c.id ?? '',
          label: c.label ?? 'Chiave API',
          masked_key: c.masked_key,
          is_primary: Boolean(c.is_primary),
          operational_status: c.operational_status,
          models: {},
        })),
        estimated_sbobine_remaining: 0,
      };
    },
  };
}

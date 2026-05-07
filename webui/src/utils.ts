export const GEMINI_KEY_PATTERN = /^(AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})$/;

const _ERROR_MAP: Record<string, string> = {
  phase1_degenerate_output: 'Trascrizione interrotta: testo non valido anche dopo il retry automatico.',
  quota_daily_limit_phase1: 'Quota API giornaliera esaurita — riprova domani, oppure aggiungi una chiave di riserva nelle impostazioni.',
  quota_daily_limit_phase2: 'Quota API esaurita durante la revisione — riprova domani, oppure aggiungi una chiave di riserva nelle impostazioni.',
  bad_request_phase1: 'Richiesta non valida durante la trascrizione (errore 400).',
  autosave_failed: 'Errore critico: salvataggio sessione fallito ripetutamente. Disco pieno o directory non scrivibile?',
  html_export_failed: 'Errore durante il salvataggio del file di output.',
  html_export_missing: 'File di output non trovato dopo il salvataggio.',
  processing_failed: 'Elaborazione non completata.',
  api_key_mancante: 'API key mancante o non valida.',
  phase1_all_models_unavailable: 'Tutti i modelli AI temporaneamente non disponibili.',
};

const _RESUMABLE_ERRORS = new Set([
  'quota_daily_limit_phase1',
  'quota_daily_limit_phase2',
  'phase1_all_models_unavailable',
]);

export function isQuotaError(raw: string | undefined): boolean {
  if (!raw) return false;
  const r = raw.trim();
  return r === 'quota_daily_limit_phase1' || r === 'quota_daily_limit_phase2';
}

export function isResumableError(raw: string | undefined): boolean {
  if (!raw) return false;
  const r = raw.trim();
  return _RESUMABLE_ERRORS.has(r);
}

export function errorLabel(raw: string | undefined): string {
  if (!raw) return 'Elaborazione non completata.';
  const r = raw.trim();
  if (r in _ERROR_MAP) return _ERROR_MAP[r];
  if (r.startsWith('phase1_chunk_failed_')) {
    const chunkNum = r.replace('phase1_chunk_failed_', '');
    return `Errore critico durante l'elaborazione del blocco ${chunkNum}.`;
  }
  return r;
}

export const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
};

export const formatRelativeTime = (timestampMs: number): string => {
  const diffMs = Date.now() - timestampMs;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'adesso';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} minut${diffMin === 1 ? 'o' : 'i'} fa`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} or${diffH === 1 ? 'a' : 'e'} fa`;
  const diffDays = Math.floor(diffH / 24);
  if (diffDays === 1) return 'ieri';
  if (diffDays < 7) return `${diffDays} giorni fa`;
  return new Date(timestampMs).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
};

export function shortModelName(model: string): string {
  if (!model) return '';
  return model.replace(/^models\//, '').replace(/^gemini-/, '').trim() || model;
}

export const formatDuration = (seconds: number, fallback = ''): string => {
  if (!seconds) return fallback;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
};

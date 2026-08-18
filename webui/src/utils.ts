export const GEMINI_KEY_PATTERN = /^(AIza[0-9A-Za-z_-]{20,}|AQ\.[0-9A-Za-z_-]{20,})$/;

/** Normalise a session directory path so that Windows backslashes, trailing
 * slashes and letter-case differences are ignored when comparing paths.
 *
 * NOTE: `.toLowerCase()` is applied unconditionally on every platform.
 * This is safe for the current Windows-only target (NTFS is case-insensitive),
 * but would need revisiting if the app is ported to a case-sensitive filesystem
 * (Linux/macOS) where two paths that differ only in case are distinct. */
export function normalizeSessionPath(path?: string): string {
  return String(path || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const _ERROR_MAP: Record<string, string> = {
  phase1_degenerate_output: 'Trascrizione interrotta: testo non valido anche dopo il retry automatico.',
  quota_daily_limit_phase1: 'Quota API giornaliera esaurita — riprova domani, oppure aggiungi una chiave di riserva nelle impostazioni.',
  quota_daily_limit_phase2: 'Quota API esaurita durante la revisione — riprova domani, oppure aggiungi una chiave di riserva nelle impostazioni.',
  bad_request_phase1: 'Richiesta non valida durante la trascrizione (errore 400).',
  autosave_failed: 'Errore critico: salvataggio sessione fallito ripetutamente. Disco pieno o directory non scrivibile?',
  session_collision: 'Questo file sembra corrispondere a una sbobina già completata ma con contenuto diverso. Apri Impostazioni → Sessioni per risolvere.',
  regenerate_prompt_timeout: 'Nessuna scelta ricevuta sulla ripresa entro 120 secondi. Sessione salvata: clicca Riprendi per continuare.',
  html_export_failed: 'Errore durante il salvataggio del file di output.',
  html_export_missing: 'File di output non trovato dopo il salvataggio.',
  processing_failed: 'Elaborazione non completata.',
  api_key_mancante: 'API key mancante o non valida.',
  phase1_all_models_unavailable: 'Tutti i modelli AI temporaneamente non disponibili.',
  revision_failed_blocks: 'Alcuni blocchi sono stati inclusi non revisionati.',
};

const _RESUMABLE_ERRORS = new Set([
  'quota_daily_limit_phase1',
  'quota_daily_limit_phase2',
  'phase1_all_models_unavailable',
  'regenerate_prompt_timeout',
]);

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

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

export function errorLabel(raw: string | undefined, detail?: string): string {
  if (!raw) return 'Elaborazione non completata.';
  const r = raw.trim();
  const d = String(detail || '').trim();
  if ((r === 'quota_daily_limit_phase1' || r === 'quota_daily_limit_phase2') && d === 'api_key_prompt_timeout') {
    return 'Attesa chiave API scaduta. Sessione salvata — riprendi quando vuoi.';
  }
  if (r in _ERROR_MAP) return _ERROR_MAP[r];
  if (r.startsWith('phase1_chunk_failed_')) {
    const chunkNum = r.replace('phase1_chunk_failed_', '');
    const detailText = d ? ` Dettaglio: ${sentence(d)}` : '';
    return `Errore al blocco ${chunkNum} dopo 4 tentativi.${detailText} Clicca Riprendi per continuare dal blocco ${chunkNum}.`;
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

export interface ImageOptimizationOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'image/jpeg' | 'image/png' | 'image/webp';
}

export function calculateOptimalDimensions(
  width: number,
  height: number,
  maxWidth = 1600,
  maxHeight = 1600
): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width: Math.max(1, width), height: Math.max(1, height) };
  }
  if (width <= maxWidth && height <= maxHeight) {
    return { width, height };
  }
  const ratio = Math.min(maxWidth / width, maxHeight / height);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Lettura immagine fallita.'));
    reader.readAsDataURL(file);
  });

export const optimizeDataUrlImage = async (
  dataUrl: string,
  options: ImageOptimizationOptions = {}
): Promise<string> => {
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return dataUrl;
  }

  if (dataUrl.startsWith('data:image/svg+xml') || dataUrl.startsWith('data:image/gif')) {
    return dataUrl;
  }

  const {
    maxWidth = 1600,
    maxHeight = 1600,
    quality = 0.85,
    format = 'image/jpeg',
  } = options;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }

  return new Promise<string>((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const srcWidth = img.naturalWidth || img.width;
          const srcHeight = img.naturalHeight || img.height;

          if (!srcWidth || !srcHeight) {
            resolve(dataUrl);
            return;
          }

          const { width, height } = calculateOptimalDimensions(
            srcWidth,
            srcHeight,
            maxWidth,
            maxHeight
          );

          if (
            format === 'image/jpeg' &&
            dataUrl.startsWith('data:image/jpeg') &&
            srcWidth <= maxWidth &&
            srcHeight <= maxHeight &&
            dataUrl.length < 200_000
          ) {
            resolve(dataUrl);
            return;
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }

          if (format === 'image/jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
          }

          ctx.drawImage(img, 0, 0, width, height);

          let optimizedDataUrl = canvas.toDataURL(format, quality);

          if (format === 'image/jpeg' && !optimizedDataUrl.startsWith('data:image/jpeg')) {
            const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
            if (jpegDataUrl.startsWith('data:image/jpeg')) {
              optimizedDataUrl = jpegDataUrl;
            }
          }

          if (
            dataUrl.startsWith(format) &&
            srcWidth <= maxWidth &&
            srcHeight <= maxHeight &&
            dataUrl.length > 0 &&
            dataUrl.length < optimizedDataUrl.length
          ) {
            resolve(dataUrl);
          } else {
            resolve(optimizedDataUrl);
          }
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => {
        resolve(dataUrl);
      };
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
};

export const convertWebpImagesInHtml = async (html: string): Promise<string> => {
  if (!html || typeof html !== 'string' || !html.includes('data:image/webp')) {
    return html;
  }

  if (typeof DOMParser === 'undefined') {
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    const images = Array.from(doc.body.querySelectorAll<HTMLImageElement>('img[src^="data:image/webp"]'));

    if (!images.length) {
      return html;
    }

    await Promise.all(
      images.map(async (img) => {
        const src = img.getAttribute('src');
        if (src && src.startsWith('data:image/webp')) {
          const converted = await optimizeDataUrlImage(src, { format: 'image/jpeg' });
          if (converted) {
            img.setAttribute('src', converted);
          }
        }
      })
    );

    return doc.body.innerHTML;
  } catch {
    return html;
  }
};

export const readAndOptimizeImageAsDataUrl = async (
  file: File,
  options: ImageOptimizationOptions = {}
): Promise<string> => {
  const rawDataUrl = await readFileAsDataUrl(file);
  return optimizeDataUrlImage(rawDataUrl, options);
};

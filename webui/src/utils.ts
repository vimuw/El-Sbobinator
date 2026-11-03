import { imageWrapperCss, imageAssetCss, normalizeImageAspectRatio, normalizeImageOffsetY, normalizeImageAlignment, normalizeImageLayout, normalizeImagePosition, normalizeImageWidth } from './imageLayout';
import { EDITOR_CONTENT_WIDTH_PX, formatPortableHtml } from './documentFormatting';

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
  phase1_all_models_unavailable: 'Nessun modello disponibile durante la trascrizione. Sessione salvata: clicca Riprendi per continuare.',
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
  revision_failed_blocks: 'Alcuni blocchi sono stati inclusi non revisionati.',
};

const _RESUMABLE_ERRORS = new Set([
  'quota_daily_limit_phase1',
  'quota_daily_limit_phase2',
  'regenerate_prompt_timeout',
  'phase1_all_models_unavailable',
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

export function isPausedError(raw: string | undefined, detail?: string): boolean {
  if (!raw) return false;
  const r = raw.trim();
  const d = String(detail || '').trim();
  return r === 'regenerate_prompt_timeout' || d === 'api_key_prompt_timeout';
}

const _NETWORK_ERROR_PATTERNS = [
  'getaddrinfo',
  'connecterror',
  'connection refused',
  'connection reset',
  'connection aborted',
  'network is unreachable',
  'network unreachable',
  'connessione assente',
  'connessione di rete non disponibile',
  'nessuna connessione a internet',
  'name or service not known',
  'temporary failure in name resolution',
  'enotfound',
  'econnrefused',
  'errno 11001',
  'errno 10051',
  'errno 10054',
  'errno 10060',
  'errno 10061',
];

export function isNetworkError(detail?: string): boolean {
  if (!detail) return false;
  const d = detail.toLowerCase();
  return _NETWORK_ERROR_PATTERNS.some(marker => d.includes(marker));
}

export function errorLabel(raw: string | undefined, detail?: string): string {
  if (!raw) return 'Elaborazione non completata.';
  const r = raw.trim();
  const d = String(detail || '').trim();
  if (r === 'offline' || (r === 'processing_failed' && isNetworkError(d))) {
    return 'Nessuna connessione a Internet rilevata. Verifica la tua connessione di rete e riprova.';
  }
  if ((r === 'quota_daily_limit_phase1' || r === 'quota_daily_limit_phase2') && d === 'api_key_prompt_timeout') {
    return 'Attesa chiave API scaduta. Sessione salvata — riprendi quando vuoi.';
  }
  if (r in _ERROR_MAP) return _ERROR_MAP[r];
  if (r.startsWith('phase1_chunk_failed_')) {
    const chunkNum = r.replace('phase1_chunk_failed_', '');
    if (isNetworkError(d)) {
      return `Errore di connessione al blocco ${chunkNum}: impossibile raggiungere i server Google. Verifica la connessione a Internet e clicca Riprendi.`;
    }
    const cleanD = d.replace(/CircuitBreakerExhaustedError:\s*/gi, '').replace(/RuntimeError:\s*/gi, '').trim();
    const detailText = cleanD ? ` Dettaglio: ${sentence(cleanD)}` : '';
    return `Errore al blocco ${chunkNum} dopo 4 tentativi.${detailText} Clicca Riprendi per continuare dal blocco ${chunkNum}.`;
  }
  return r;
}

// Italian decimal comma: "2,5 MB".
export const formatSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1).replace('.', ',')} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
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

// Google Docs refuses images above 25 megapixels.
export const DOCS_MAX_IMAGE_PIXELS = 25_000_000;

/** EXIF orientation of a JPEG data URL; 1 (upright) when absent or unreadable. */
export const jpegOrientation = (dataUrl: string): number => {
  try {
    // The Exif segment sits in the first kilobytes; decode only those.
    const head = dataUrl.slice(dataUrl.indexOf(',') + 1, dataUrl.indexOf(',') + 1 + 87_384);
    const bytes = Uint8Array.from(atob(head.slice(0, head.length - (head.length % 4))), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    for (let i = 2; i + 4 < bytes.length && bytes[i] === 0xff;) {
      const marker = bytes[i + 1];
      if (marker === 0xda) break;
      const length = view.getUint16(i + 2);
      if (marker === 0xe1 && view.getUint32(i + 4) === 0x45786966) {
        const tiff = i + 10;
        const little = view.getUint16(tiff) === 0x4949;
        const ifd = tiff + view.getUint32(tiff + 4, little);
        for (let entry = 0; entry < view.getUint16(ifd, little); entry++) {
          const at = ifd + 2 + entry * 12;
          if (view.getUint16(at, little) === 0x0112) return view.getUint16(at + 8, little);
        }
        return 1;
      }
      i += 2 + length;
    }
  } catch { /* Truncated or malformed header: treat it as upright. */ }
  return 1;
};

// Header segments a JPEG needs to look the same: JFIF (APP0), the ICC colour
// profile (APP2) and Adobe's colour transform (APP14). Exif, XMP, other APPn
// and comments can carry the GPS position, the device or the author.
const keepsJpegSegment = (bytes: Uint8Array, at: number): boolean => {
  const marker = bytes[at + 1];
  const named = (id: string) => Array.from(id).every((c, k) => bytes[at + 4 + k] === c.charCodeAt(0));
  if (marker === 0xe2) return named('ICC_PROFILE\0');
  if (marker === 0xee) return named('Adobe');
  return marker === 0xe0 || (marker < 0xe0 || marker > 0xef) && marker !== 0xfe;
};

/**
 * Drop the metadata of a JPEG data URL without recompressing it: the bytes
 * from the SOS marker on are copied unchanged. Returns the input when there is
 * nothing to drop, null when the header cannot be read.
 */
export const stripJpegMetadata = (dataUrl: string): string | null => {
  const comma = dataUrl.indexOf(',');
  if (!/;base64$/i.test(dataUrl.slice(0, comma))) return null;
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(dataUrl.slice(comma + 1)), c => c.charCodeAt(0));
  } catch {
    return null;
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let removed = false;
  let i = 2;
  while (i + 1 < bytes.length && bytes[i + 1] !== 0xda) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    // Standalone markers have no length field.
    const end = marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9) ? i + 2 : i + 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    if (keepsJpegSegment(bytes, i)) kept.push(bytes.subarray(i, end));
    else removed = true;
    i = end;
  }
  if (!removed) return dataUrl;
  kept.push(bytes.subarray(i));
  let binary = '';
  for (const part of kept) {
    for (let k = 0; k < part.length; k += 0x8000) binary += String.fromCharCode(...part.subarray(k, k + 0x8000));
  }
  return `${dataUrl.slice(0, comma)},${btoa(binary)}`;
};

const hasTransparency = (img: HTMLImageElement): boolean => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx?.getImageData) return false;
  ctx.drawImage(img, 0, 0, 128, 128);
  const { data } = ctx.getImageData(0, 0, 128, 128);
  for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  return false;
};

/**
 * Keep inserted images at their source quality: Docs and the .docx export
 * receive exactly the stored pixels. PNG files and the compressed data of JPEG
 * files (without their metadata) stay byte-for-byte unless Docs would refuse
 * them (over 25 MP); photos above `maxWidth`/`maxHeight`
 * and formats Docs cannot import are re-encoded, transparency as PNG.
 */
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
    maxWidth = 4096,
    maxHeight = 4096,
    quality = 0.92,
  } = options;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return dataUrl;
  }

  const png = dataUrl.startsWith('data:image/png');
  const jpeg = dataUrl.startsWith('data:image/jpeg');

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

          // Screenshots keep every pixel; only photos get the side limit.
          let { width, height } = png
            ? { width: srcWidth, height: srcHeight }
            : calculateOptimalDimensions(srcWidth, srcHeight, maxWidth, maxHeight);
          const pixelScale = Math.sqrt(DOCS_MAX_IMAGE_PIXELS / (width * height));
          if (pixelScale < 1) {
            width = Math.max(1, Math.floor(width * pixelScale));
            height = Math.max(1, Math.floor(height * pixelScale));
          }
          const resized = width !== srcWidth || height !== srcHeight;

          // A rotated JPEG is redrawn upright: not every Docs/Word import
          // honours the EXIF orientation the editor displays. An upright one
          // keeps its compressed data but loses the Exif/GPS metadata; an
          // unreadable header is redrawn, which drops it too.
          const original = png ? dataUrl : jpeg && jpegOrientation(dataUrl) === 1 ? stripJpegMetadata(dataUrl) : null;
          if (original && !resized) {
            resolve(original);
            return;
          }

          const format = png || (!jpeg && hasTransparency(img)) ? 'image/png' : 'image/jpeg';
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
          const optimizedDataUrl = canvas.toDataURL(format, quality);
          resolve(optimizedDataUrl.startsWith(`data:${format}`) ? optimizedDataUrl : dataUrl);
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

export { EDITOR_CONTENT_WIDTH_PX } from './documentFormatting';

export const clampWidthPercent = normalizeImageWidth;

export const prepareHtmlForClipboardSync = (html: string, sourceRoot?: HTMLElement): string => {
  if (!html || typeof html !== 'string') {
    return html;
  }

  if (typeof DOMParser === 'undefined') {
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, 'text/html');
    const images = Array.from(doc.body.querySelectorAll<HTMLImageElement>('img'));

    images.forEach((img) => {
      const parentContainer = img.closest('[data-editor-image]') as HTMLElement | null;

      let widthPercent = 56;
      if (parentContainer?.hasAttribute('data-width')) {
        widthPercent = clampWidthPercent(parentContainer.getAttribute('data-width'));
      } else if (img.hasAttribute('data-width')) {
        widthPercent = clampWidthPercent(img.getAttribute('data-width'));
      } else if (img.getAttribute('width')) {
        const px = Number.parseFloat(img.getAttribute('width') || '');
        if (Number.isFinite(px) && px > 0) {
          widthPercent = clampWidthPercent(Math.round((px / EDITOR_CONTENT_WIDTH_PX) * 100));
        }
      } else if (img.style.width && img.style.width.endsWith('%')) {
        widthPercent = clampWidthPercent(img.style.width);
      }

      const targetPx = Math.round((EDITOR_CONTENT_WIDTH_PX * widthPercent) / 100);

      img.setAttribute('width', String(targetPx));
      img.setAttribute(
        'style',
        `display:block;width:${widthPercent}%;max-width:100%;height:auto;margin:0 auto;padding:0;text-align:center;`
      );
      img.setAttribute('align', 'center');

      if (parentContainer) {
        parentContainer.setAttribute(
          'style',
          'width:100%;max-width:100%;position:relative;float:none;margin:14px auto;margin-left:auto;margin-right:auto;display:block;clear:both;text-align:center;'
        );
        parentContainer.setAttribute('align', 'center');
        // New editor images carry their layout explicitly. Keep it intact when copying.
        if (parentContainer.hasAttribute('data-layout')) {
          const layout = normalizeImageLayout(parentContainer.getAttribute('data-layout'));
          const align = normalizeImageAlignment(parentContainer.getAttribute('data-align'));
          const position = normalizeImagePosition(parentContainer.getAttribute('data-position'), align);
          parentContainer.setAttribute('style', imageWrapperCss(widthPercent, layout, align, position, normalizeImageOffsetY(parentContainer.getAttribute('data-offset-x')), normalizeImageOffsetY(parentContainer.getAttribute('data-offset-y'))));
          parentContainer.setAttribute('align', align);
          const ratio = normalizeImageAspectRatio(parentContainer.getAttribute('data-aspect-ratio'));
          img.setAttribute('style', imageAssetCss(ratio));
          // Docs HTML import needs both dimensions; a width alone can leave
          // the asset at its intrinsic size. Read loaded pixels without
          // resampling them or adding a fixed aspect ratio to the document.
          const displayed = Array.from(sourceRoot?.querySelectorAll('img') ?? [])
            .find(candidate => candidate.getAttribute('src') === img.getAttribute('src'));
          const displayRatio = ratio ?? (displayed?.naturalWidth && displayed.naturalHeight
            ? displayed.naturalWidth / displayed.naturalHeight : null);
          if (displayRatio) img.setAttribute('height', String(Math.round(targetPx / displayRatio)));
          img.removeAttribute('align');
        }
      }
    });

    formatPortableHtml(doc.body);
    return doc.body.innerHTML;
  } catch {
    return html;
  }
};

export const prepareHtmlForClipboard = async (html: string, sourceRoot?: HTMLElement): Promise<string> => {
  return prepareHtmlForClipboardSync(html, sourceRoot);
};

export const convertWebpImagesInHtml = async (html: string): Promise<string> => {
  return prepareHtmlForClipboard(html);
};

export const readAndOptimizeImageAsDataUrl = async (
  file: File,
  options: ImageOptimizationOptions = {}
): Promise<string> => {
  const rawDataUrl = await readFileAsDataUrl(file);
  return optimizeDataUrlImage(rawDataUrl, options);
};

export const DEFAULT_MODEL = 'gemini-3.6-flash';

export const MODEL_ORDER: string[] = [
  'gemini-2.5-flash',
  'gemini-3.6-flash',
  'gemini-3.8-flash',
];

export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'gemini-2.5-flash': 'Gemini 2.5 Flash',
  'gemini-3.5-flash': 'Gemini 3.5 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
  'gemini-3.7-flash': 'Gemini 3.7 Flash',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
};

export function getModelDisplayName(modelId: string): string {
  const cleaned = (modelId || '').trim();
  return MODEL_DISPLAY_NAMES[cleaned] || cleaned;
}

export function sortModelsByVersion<T extends { id?: string } | string>(models: T[]): T[] {
  const getVersionKey = (item: T): string => {
    const id = typeof item === 'string' ? item : item.id || '';
    return id.toLowerCase().trim();
  };

  return [...models].sort((a, b) => {
    const keyA = getVersionKey(a);
    const keyB = getVersionKey(b);
    const idxA = MODEL_ORDER.indexOf(keyA);
    const idxB = MODEL_ORDER.indexOf(keyB);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return keyA.localeCompare(keyB, undefined, { numeric: true });
  });
}

/**
 * Compare two semver-like version strings (e.g. 'v2.6.0' and '2.5.1').
 * Returns > 0 if a > b, < 0 if a < b, 0 if equal.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => String(v || '').replace(/^v/, '').split('.').map(p => parseInt(p, 10) || 0);
  const [aMaj = 0, aMin = 0, aPatch = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPatch = 0] = parse(b);
  return aMaj !== bMaj ? aMaj - bMaj : aMin !== bMin ? aMin - bMin : aPatch - bPatch;
}

import type { Breadcrumb, Event } from '@sentry/browser';

// Every report leaves the page through these filters (sentry.ts runs them on each event, feedback
// included). The sbobine may hold health data from a lecture, so nothing written in the app goes
// out on its own: no console lines, no request or response bodies, no element text. Keys and tokens
// are masked wherever they turn up, and long texts are cut. Sentry masks the same patterns again on
// its side (docs/web/checklist-sentry.md).

export const MASK = '[nascosto]';
/** Error messages and breadcrumbs: enough to read the error, too short for a passage of a lecture. */
export const AUTOMATIC_TEXT_LIMIT = 300;
/** The user's own feedback text. */
export const FEEDBACK_TEXT_LIMIT = 5000;

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Gemini key
  /AQ\.[0-9A-Za-z_-]{20,}/g, // Gemini key, newer format
  /ya29\.[0-9A-Za-z._-]+/g, // Google access token
  /\bBearer\s+[^\s"']+/gi,
];
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// The app's own routes (#/archivio/sbobina/…): no '=' or '&', so never an OAuth answer.
const APP_ROUTE_PATTERN = /^#\/[A-Za-z0-9/_-]{0,80}$/;
// What Sentry writes of a clicked element: tag, id and classes stay, [attribute="text"] goes.
const SELECTOR_ATTRIBUTE_PATTERN = /\[[^\]]*\]/g;

export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce((result, pattern) => result.replace(pattern, MASK), text);
}

/** Text the app wrote, not the user: secrets and email addresses masked, then cut. */
export function scrubText(text: string, limit = AUTOMATIC_TEXT_LIMIT): string {
  const clean = redactSecrets(text).replace(EMAIL_PATTERN, MASK);
  return clean.length > limit ? `${clean.slice(0, limit)}…` : clean;
}

/** Origin and path only: the query and the fragment may hold a code or a token. */
export function scrubUrl(url: string): string {
  const hashAt = url.indexOf('#');
  const hash = hashAt >= 0 ? url.slice(hashAt) : '';
  const base = (hashAt >= 0 ? url.slice(0, hashAt) : url).split('?')[0];
  return redactSecrets(base) + (APP_ROUTE_PATTERN.test(hash) ? hash : '');
}

function scrubValues(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return depth > 3 ? [] : value.slice(0, 20).map(item => scrubValues(item, depth + 1));
  if (value && typeof value === 'object') {
    if (depth > 3) return {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValues(item, depth + 1)]));
  }
  return value;
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (breadcrumb.category === 'console') return null;
  const result: Breadcrumb = { ...breadcrumb };
  if (typeof result.message === 'string') {
    const message = result.category?.startsWith('ui.') ? result.message.replace(SELECTOR_ATTRIBUTE_PATTERN, '') : result.message;
    result.message = scrubText(message);
  }
  const data = breadcrumb.data;
  if (data) {
    const kept: Record<string, unknown> = {};
    // fetch/xhr: method, address and status, never a body or its size; navigation: from and to.
    for (const key of ['method', 'status_code', 'url', 'from', 'to']) {
      const item = data[key];
      if (item === undefined) continue;
      kept[key] = typeof item === 'string' ? (key === 'method' ? item.slice(0, 10) : scrubUrl(item)) : item;
    }
    result.data = kept;
  }
  return result;
}

export interface ScrubOptions {
  /** A feedback without the tech info: only the user's text and contact leave. */
  bare?: boolean;
}

export function scrubEvent<T extends Event>(event: T, options: ScrubOptions = {}): T {
  const result: T = { ...event };
  delete result.user;
  delete result.extra;
  delete result.server_name;
  if (typeof result.message === 'string') result.message = scrubText(result.message);
  if (result.exception?.values) {
    result.exception = {
      ...result.exception,
      values: result.exception.values.map(item => ({
        ...item,
        value: typeof item.value === 'string' ? scrubText(item.value) : item.value,
        stacktrace: item.stacktrace && {
          ...item.stacktrace,
          frames: item.stacktrace.frames?.map(frame => ({
            ...frame,
            filename: frame.filename && scrubUrl(frame.filename),
            abs_path: frame.abs_path && scrubUrl(frame.abs_path),
            vars: undefined,
          })),
        },
      })),
    };
  }
  if (result.request) {
    const userAgent = result.request.headers?.['User-Agent'];
    result.request = {
      url: result.request.url && scrubUrl(result.request.url),
      ...(userAgent && !options.bare ? { headers: { 'User-Agent': userAgent } } : {}),
    };
  }
  result.breadcrumbs = options.bare ? [] : result.breadcrumbs?.flatMap(item => scrubBreadcrumb(item) ?? []);
  if (result.contexts) {
    const { feedback, ...others } = result.contexts;
    result.contexts = {
      ...(options.bare ? {} : scrubValues(others) as typeof others),
      ...(feedback ? {
        feedback: {
          ...feedback,
          // The user's own words: secrets masked, nothing else changed.
          message: typeof feedback.message === 'string' ? redactSecrets(feedback.message).slice(0, FEEDBACK_TEXT_LIMIT) : feedback.message,
          url: typeof feedback.url === 'string' ? scrubUrl(feedback.url) : feedback.url,
        },
      } : {}),
    };
  }
  return result;
}

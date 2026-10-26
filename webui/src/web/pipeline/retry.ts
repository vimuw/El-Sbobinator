// Port of generation_service.retry_with_quota and the classifiers in services/gemini_errors.py,
// with the texts of phaseLabels.ts so the processing banner shows the same notices as the desktop.
//
//  - 408/500/502/503/504, timeouts, "overloaded": retry after 15/30/60 s (+ up to 10% jitter),
//    then CircuitBreakerExhaustedError.
//  - 429 per-minute / unknown: wait Retry-After or 65 s and probe once; a second 429 is final.
//  - 429 daily quota: QuotaDailyLimitError at once (withKeyRotation moves to the next key).
//  - 400 / 401 / 403: PermanentError or InvalidKeyError, no retry. 404: ModelNotFoundError.
//  - Offline: wait for the network without spending attempts.
//  - Browser only: a request that failed while the page was hidden (Safari suspends the page and
//    can kill its requests) is retried as soon as the page is visible again, without a pause.
//  - Anything else: wait `retrySleepSec` (30 s phase 1, 20 s phase 2), up to 4 attempts.

import { phaseText } from '../../phaseLabels';
import { GeminiHttpError, NetworkError, isAbortError } from './gemini';

export class QuotaDailyLimitError extends Error {
  name = 'QuotaDailyLimitError';
}
export class PermanentError extends Error {
  name = 'PermanentError';
}
export class InvalidKeyError extends Error {
  name = 'InvalidKeyError';
}
export class ModelNotFoundError extends Error {
  name = 'ModelNotFoundError';
}
export class CircuitBreakerExhaustedError extends Error {
  name = 'CircuitBreakerExhaustedError';
}
export class CancelledError extends Error {
  name = 'CancelledError';
}
export class DegenerateOutputError extends Error {
  name = 'DegenerateOutputError';
}

export const MAX_RETRY_ATTEMPTS = 4;
export const MODEL_UNAVAILABLE_RETRY_DELAYS = [15, 30, 60];
export const RATE_LIMIT_SLEEP_SEC = 65;
// Free retries for requests the browser dropped while the page was in the background.
export const MAX_HIDDEN_PAGE_RETRIES = 3;

export function errorText(error: unknown): string {
  if (error instanceof GeminiHttpError) return `${error.status} ${error.apiStatus} ${error.apiMessage} ${error.rawBody}`.toLowerCase();
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).toLowerCase();
}

export const errorCode = (error: unknown): number | null => (error instanceof GeminiHttpError ? error.status : null);

const collapse = (text: string) => text.replace(/\s+/g, ' ');

export function isQuotaRelated(text: string, code: number | null): boolean {
  return code === 429 || ['resource_exhausted', 'quota', 'rate limit', 'too many requests'].some(marker => text.includes(marker));
}

const MINUTE_ONLY = ['per minute', 'per-minute', 'per_minute', 'requests_per_minute', 'requests per minute', 'requestsperminute', 'tokens_per_minute', 'tokens per minute', 'tokensperminute', 'tpm', 'rpm', 'generatecontenttokenspermodelperminute', 'generatecontentrequestspermodelperminute'];
const DAILY_EXPLICIT = ['per day', 'per-day', 'per_day', 'perday', 'daily', 'generaterequestsperday', 'generate_content_free_tier_requests', 'requests_per_day', 'requests per day', 'exceeded your current quota'];
const HARD_LIMIT = [...DAILY_EXPLICIT, 'generatecontentfreetierrequests', 'requestsperday', 'check your plan and billing', 'plan and billing', 'insufficient_quota', 'insufficient quota', 'insufficient_balance', 'insufficient balance', 'billing', 'credit', 'balance'];

export function isDailyOrKeyExhausted(rawText: string, code: number | null): boolean {
  const text = collapse(rawText);
  if (MINUTE_ONLY.some(marker => text.includes(marker)) && !DAILY_EXPLICIT.some(marker => text.includes(marker))) return false;
  if (HARD_LIMIT.some(marker => text.includes(marker))) return true;
  if (/\btokens?\b/.test(text) && ['exhaust', 'exceeded', 'finished', 'ended', 'insufficient', 'unavailable', 'depleted'].some(marker => text.includes(marker))) return true;
  return code === 503 && text.includes('resource_exhausted');
}

export function isMinuteScopedRateLimit(text: string, code: number | null): boolean {
  if (isDailyOrKeyExhausted(text, code)) return false;
  return [...MINUTE_ONLY, 'rate limit exceeded', 'rate_limit_exceeded'].some(marker => text.includes(marker));
}

export function isTransient(text: string, code: number | null, error: unknown): boolean {
  if (error instanceof NetworkError && /timeout/i.test(error.message)) return true;
  if (code !== null && [408, 500, 502, 503, 504].includes(code)) return true;
  return ['service unavailable', 'backend error', 'model is overloaded', 'overloaded', 'temporarily unavailable', 'internal server error', 'bad gateway', 'gateway timeout', 'request timeout', 'timed out', 'timeout', 'deadline exceeded', 'unavailable'].some(marker => text.includes(marker));
}

export function isInvalidKey(text: string, code: number | null): boolean {
  return code === 401 || ['api key not valid', 'api_key_invalid', 'invalid api key', 'invalid_api_key', 'malformed api key', 'unauthenticated'].some(marker => text.includes(marker));
}

export function isDeterministicClientError(text: string, code: number | null): boolean {
  if (code !== null && [400, 401, 403].includes(code)) return true;
  return ['invalid_argument', 'bad request', 'unauthenticated', 'permission_denied', 'permission denied', 'api key not valid', 'api_key_invalid', 'invalid api key', 'forbidden', 'access denied'].some(marker => text.includes(marker));
}

export interface RetryEnv {
  /** Resolves after `seconds`, or rejects with CancelledError when the run stops. */
  sleep(seconds: number): Promise<void>;
  isOffline(): boolean;
  waitOnline(): Promise<void>;
  isHidden(): boolean;
  /** Whether the page was hidden at any moment since `since` (env.now() time). */
  wasHiddenSince(since: number): boolean;
  waitVisible(): Promise<void>;
  now(): number;
  /** Retry notice for the banner; restorePhase puts the step's own phase text back. */
  notice(text: string): void;
  restorePhase(): void;
  log(line: string): void;
  signal: AbortSignal;
}

const jitter = (base: number) => base * (1 + Math.random() * 0.1);

function throwIfCancelled(env: RetryEnv): void {
  if (env.signal.aborted) throw new CancelledError('annullato');
}

/** Runs `fn` with the desktop retry policy. */
export async function retryWithQuota<T>(fn: (call: number) => Promise<T>, env: RetryEnv, retrySleepSec: number, label: string): Promise<T> {
  let calls = 0;
  let attempts = 0;
  let busyRetries = 0;
  let hiddenRetries = 0;
  let rateLimitProbed = false;
  const pause = async (seconds: number, notice: string) => {
    env.notice(notice);
    await env.sleep(seconds);
    throwIfCancelled(env);
    env.restorePhase();
  };

  for (;;) {
    throwIfCancelled(env);
    if (env.isOffline()) {
      env.notice(phaseText.offline());
      env.log(`Rete assente (${label}): attendo la connessione.`);
      await env.waitOnline();
      throwIfCancelled(env);
      env.restorePhase();
    }
    const startedAt = env.now();
    try {
      return await fn(++calls);
    } catch (error) {
      if (env.signal.aborted || isAbortError(error)) throw new CancelledError('annullato');
      if (error instanceof DegenerateOutputError || error instanceof CancelledError) throw error;
      const text = errorText(error);
      const code = errorCode(error);

      if (error instanceof NetworkError && (env.isHidden() || env.wasHiddenSince(startedAt)) && hiddenRetries < MAX_HIDDEN_PAGE_RETRIES) {
        hiddenRetries += 1;
        env.log(`Richiesta interrotta mentre la pagina era in background (${label}): riprovo appena torni sulla pagina.`);
        await env.waitVisible();
        continue;
      }
      if (code === 404) throw new ModelNotFoundError(text);
      if (!isQuotaRelated(text, code) && isDeterministicClientError(text, code)) {
        throw isInvalidKey(text, code) ? new InvalidKeyError(text) : new PermanentError(text);
      }
      if (error instanceof NetworkError && env.isOffline()) continue;

      if (!isQuotaRelated(text, code) && isTransient(text, code, error)) {
        if (busyRetries >= MODEL_UNAVAILABLE_RETRY_DELAYS.length) throw new CircuitBreakerExhaustedError(text);
        const wait = jitter(MODEL_UNAVAILABLE_RETRY_DELAYS[busyRetries]);
        busyRetries += 1;
        await pause(wait, phaseText.serverBusy(Math.floor(wait), busyRetries + 1, MODEL_UNAVAILABLE_RETRY_DELAYS.length + 1));
        continue;
      }

      if (isQuotaRelated(text, code)) {
        if (isDailyOrKeyExhausted(text, code)) throw new QuotaDailyLimitError(text);
        if (rateLimitProbed) {
          if (isMinuteScopedRateLimit(text, code)) throw new CircuitBreakerExhaustedError(text);
          throw new QuotaDailyLimitError(text);
        }
        rateLimitProbed = true;
        const wait = error instanceof GeminiHttpError && error.retryAfterSec ? error.retryAfterSec : RATE_LIMIT_SLEEP_SEC;
        await pause(wait, phaseText.rateLimit(Math.floor(wait)));
        continue;
      }

      attempts += 1;
      if (attempts >= MAX_RETRY_ATTEMPTS) throw error;
      await pause(retrySleepSec, phaseText.genericRetry(text.includes('risposta vuota'), retrySleepSec, attempts + 1, MAX_RETRY_ATTEMPTS));
    }
  }
}

/** The keys of a run and the one in use. Only the position is ever shown ("chiave 2/3"), never the key. */
export interface KeyRing {
  keys: string[];
  index: number;
}

export type RotationReason = 'quota' | 'chiave non valida';

/**
 * Port of the rotation in retry_with_quota / try_rotate_key: when a key's daily quota is gone,
 * move to the next key and run the same unit again (same chunk, same section). A fallback key that
 * turns out invalid is skipped the same way. When every key is used up, `requestNewKey` (the
 * "Inserisci una nuova chiave" dialog) may add one; otherwise the error surfaces.
 */
export async function withKeyRotation<T>(
  ring: KeyRing,
  run: () => Promise<T>,
  onRotate: (from: number, to: number, why: RotationReason) => void,
  requestNewKey?: () => Promise<string | null>,
): Promise<T> {
  for (;;) {
    try {
      return await run();
    } catch (error) {
      const quota = error instanceof QuotaDailyLimitError;
      // An invalid main key is the user's mistake to fix; an invalid fallback key is skipped.
      const badFallback = error instanceof InvalidKeyError && ring.index > 0;
      if (!quota && !badFallback) throw error;
      if (ring.index + 1 >= ring.keys.length) {
        const added = quota && requestNewKey ? (await requestNewKey())?.trim() : null;
        if (!added) throw error;
        ring.keys.push(added);
      }
      const from = ring.index;
      ring.index += 1;
      onRotate(from, ring.index, quota ? 'quota' : 'chiave non valida');
    }
  }
}

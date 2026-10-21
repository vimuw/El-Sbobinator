import { describe, expect, it, vi } from 'vitest';
import { getPhaseStage, NOTICE_PREFIX, parseAttempt, parseWaitSecs } from '../../phaseLabels';
import { GeminiHttpError, NetworkError } from './gemini';
import {
  CancelledError,
  CircuitBreakerExhaustedError,
  DegenerateOutputError,
  InvalidKeyError,
  ModelNotFoundError,
  PermanentError,
  QuotaDailyLimitError,
  isDailyOrKeyExhausted,
  isMinuteScopedRateLimit,
  retryWithQuota,
  withKeyRotation,
  type KeyRing,
  type RetryEnv,
} from './retry';

const http = (status: number, message = '', apiStatus = '', retryAfter: number | null = null) =>
  new GeminiHttpError(status, apiStatus, message, retryAfter, JSON.stringify({ error: { message } }));
const DAILY_429 = () => http(429, 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 20', 'RESOURCE_EXHAUSTED');
const MINUTE_429 = () => http(429, 'Quota exceeded for metric: generate_content_requests_per_minute', 'RESOURCE_EXHAUSTED');

function fakeEnv(overrides: Partial<RetryEnv> = {}) {
  const sleeps: number[] = [];
  const phases: string[] = [];
  const logs: string[] = [];
  const controller = new AbortController();
  const env: RetryEnv = {
    sleep: async secs => { sleeps.push(secs); },
    isOffline: () => false,
    waitOnline: async () => {},
    isHidden: () => false,
    wasHiddenSince: () => false,
    waitVisible: async () => {},
    now: () => 0,
    notice: text => phases.push(text),
    restorePhase: () => phases.push('<restore>'),
    log: line => logs.push(line),
    signal: controller.signal,
    ...overrides,
  };
  return { env, sleeps, phases, logs, controller };
}

function failing<T = string>(...steps: Array<Error | T>) {
  let call = 0;
  return vi.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    if (step instanceof Error) throw step;
    return step;
  });
}

describe('retryWithQuota', () => {
  it('retries 503s after 15/30/60 s with the desktop banner notice', async () => {
    const { env, sleeps, phases } = fakeEnv();
    const fn = failing<string>(http(503, 'The model is overloaded.'), http(503), 'ok');
    await expect(retryWithQuota(fn, env, 30, 'blocco 1/3')).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(15);
    expect(sleeps[0]).toBeLessThanOrEqual(16.5);
    expect(sleeps[1]).toBeGreaterThanOrEqual(30);
    expect(phases[0].startsWith(NOTICE_PREFIX.serverBusy)).toBe(true);
    expect(parseAttempt(phases[0])).toEqual({ current: 2, total: 4 });
    expect(parseWaitSecs(phases[0])).toBe(Math.floor(sleeps[0]));
    expect(phases[1]).toBe('<restore>');
  });

  it('stops with CircuitBreakerExhaustedError after the third busy retry', async () => {
    const { env, sleeps } = fakeEnv();
    const fn = failing(http(503));
    await expect(retryWithQuota(fn, env, 30, 'x')).rejects.toBeInstanceOf(CircuitBreakerExhaustedError);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toHaveLength(3);
  });

  it('waits once on a per-minute 429 and probes, then gives up on a second one', async () => {
    const { env, sleeps, phases } = fakeEnv();
    await expect(retryWithQuota(failing<string>(http(429, 'rate limit exceeded', '', 7), 'ok'), env, 30, 'x')).resolves.toBe('ok');
    expect(sleeps).toEqual([7]);
    expect(phases[0].includes(`${NOTICE_PREFIX.rateLimit}: attesa 7s`)).toBe(true);

    const second = fakeEnv();
    await expect(retryWithQuota(failing(MINUTE_429()), second.env, 30, 'x')).rejects.toBeInstanceOf(CircuitBreakerExhaustedError);
    expect(second.sleeps).toEqual([65]);
  });

  it('classifies the free-tier daily quota as final', async () => {
    const { env, sleeps } = fakeEnv();
    await expect(retryWithQuota(failing(DAILY_429()), env, 30, 'x')).rejects.toBeInstanceOf(QuotaDailyLimitError);
    expect(sleeps).toEqual([]);
    expect(isDailyOrKeyExhausted('quota exceeded generate_content_free_tier_requests', 429)).toBe(true);
    expect(isMinuteScopedRateLimit('requests per minute', 429)).toBe(true);
  });

  it('fails at once on client errors and a missing model', async () => {
    await expect(retryWithQuota(failing(http(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT')), fakeEnv().env, 30, 'x')).rejects.toBeInstanceOf(InvalidKeyError);
    await expect(retryWithQuota(failing(http(403, 'Permission denied', 'PERMISSION_DENIED')), fakeEnv().env, 30, 'x')).rejects.toBeInstanceOf(PermanentError);
    await expect(retryWithQuota(failing(http(404, 'models/x is not found')), fakeEnv().env, 30, 'x')).rejects.toBeInstanceOf(ModelNotFoundError);
    await expect(retryWithQuota(failing(new DegenerateOutputError('ripetuto')), fakeEnv().env, 30, 'x')).rejects.toBeInstanceOf(DegenerateOutputError);
  });

  it('retries other errors after retrySleepSec, up to 4 attempts', async () => {
    const { env, sleeps, phases } = fakeEnv();
    const fn = failing(new Error('Risposta vuota dal modello (text=None)'));
    await expect(retryWithQuota(fn, env, 20, 'x')).rejects.toThrow(/Risposta vuota/);
    expect(fn).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([20, 20, 20]);
    expect(phases[0].startsWith(NOTICE_PREFIX.emptyResponse)).toBe(true);
    expect(parseAttempt(phases[0])).toEqual({ current: 2, total: 4 });
  });

  it('waits for the network without spending attempts when offline', async () => {
    let offline = true;
    const waitOnline = vi.fn(async () => { offline = false; });
    const { env, phases, sleeps } = fakeEnv({ isOffline: () => offline, waitOnline });
    await expect(retryWithQuota(failing('ok'), env, 30, 'x')).resolves.toBe('ok');
    expect(waitOnline).toHaveBeenCalledOnce();
    expect(phases[0].startsWith(NOTICE_PREFIX.offline)).toBe(true);
    expect(sleeps).toEqual([]);
  });

  it('retries a request dropped while the page was hidden as soon as it is visible, without a pause', async () => {
    const waitVisible = vi.fn(async () => {});
    const { env, sleeps, logs } = fakeEnv({ wasHiddenSince: () => true, waitVisible });
    const fn = failing(new NetworkError('TypeError: Load failed'), 'ok');
    await expect(retryWithQuota(fn, env, 30, 'blocco 2/4')).resolves.toBe('ok');
    expect(waitVisible).toHaveBeenCalledOnce();
    expect(sleeps).toEqual([]);
    expect(logs[0]).toMatch(/background/);
  });

  it('treats a network error on a visible page as an ordinary retry', async () => {
    const { env, sleeps } = fakeEnv();
    await expect(retryWithQuota(failing(new NetworkError('TypeError: Failed to fetch'), 'ok'), env, 30, 'x')).resolves.toBe('ok');
    expect(sleeps).toEqual([30]);
  });

  it('caps the free hidden-page retries', async () => {
    const { env, sleeps } = fakeEnv({ isHidden: () => true });
    const fn = failing(new NetworkError('Load failed'), new NetworkError('Load failed'), new NetworkError('Load failed'), new NetworkError('Load failed'), 'ok');
    await expect(retryWithQuota(fn, env, 30, 'x')).resolves.toBe('ok');
    expect(sleeps).toEqual([30]);
  });

  it('stops when the run is cancelled', async () => {
    const { env, controller } = fakeEnv();
    const fn = vi.fn(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(retryWithQuota(fn, env, 30, 'x')).rejects.toBeInstanceOf(CancelledError);
  });

  it('keeps the banner stage after a notice', () => {
    expect(getPhaseStage('Fase 1/3: trascrizione (chunk 1/2)')).toBe('transcription');
  });
});

describe('withKeyRotation', () => {
  it('moves to the next key on a daily quota and runs the same unit again', async () => {
    const ring: KeyRing = { keys: ['k1', 'k2', 'k3'], index: 0 };
    const used: string[] = [];
    const rotations: string[] = [];
    const result = await withKeyRotation(ring, async () => {
      used.push(ring.keys[ring.index]);
      if (ring.index < 2) throw new QuotaDailyLimitError('quota');
      return 'done';
    }, (from, to, why) => rotations.push(`${from}->${to} ${why}`));
    expect(result).toBe('done');
    expect(used).toEqual(['k1', 'k2', 'k3']);
    expect(rotations).toEqual(['0->1 quota', '1->2 quota']);
  });

  it('skips an invalid fallback key but not an invalid main key', async () => {
    const ring: KeyRing = { keys: ['k1', 'k2', 'k3'], index: 1 };
    await expect(withKeyRotation(ring, async () => {
      if (ring.index === 1) throw new InvalidKeyError('bad');
      return 'ok';
    }, () => {})).resolves.toBe('ok');
    const main: KeyRing = { keys: ['k1', 'k2'], index: 0 };
    await expect(withKeyRotation(main, async () => { throw new InvalidKeyError('bad'); }, () => {})).rejects.toBeInstanceOf(InvalidKeyError);
    expect(main.index).toBe(0);
  });

  it('asks for a new key when every key has run out', async () => {
    const ring: KeyRing = { keys: ['k1'], index: 0 };
    const requestNewKey = vi.fn(async () => ' k2 ');
    await expect(withKeyRotation(ring, async () => {
      if (ring.keys[ring.index] === 'k1') throw new QuotaDailyLimitError('quota');
      return 'ok';
    }, () => {}, requestNewKey)).resolves.toBe('ok');
    expect(ring.keys).toEqual(['k1', 'k2']);

    const none: KeyRing = { keys: ['k1'], index: 0 };
    await expect(withKeyRotation(none, async () => { throw new QuotaDailyLimitError('quota'); }, () => {}, async () => null)).rejects.toBeInstanceOf(QuotaDailyLimitError);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import { createApiUsageStore, hashKey, maskKey, pacificDateString } from './apiUsage';
import { GeminiClient, GeminiHttpError } from './pipeline/gemini';

const PRIMARY = 'AIzaSyPrimary1234567890123';
const RESERVE = 'AIzaSyReserve1234567890456';

function memoryStorage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value) };
}

const dailyQuota = () => new GeminiHttpError(429, 'RESOURCE_EXHAUSTED', 'You exceeded your current quota. Quota exceeded for metric: generate_content_free_tier_requests, limit: 20', null, '');

describe('web API usage (port of usage_service)', () => {
  it('masks keys and hashes them like the desktop, never storing a key in clear', () => {
    expect(maskKey(PRIMARY)).toBe('AIzaSy...0123');
    expect(maskKey('abcdefg')).toBe('ab...fg');
    expect(hashKey(PRIMARY)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashKey(PRIMARY)).not.toBe(hashKey(RESERVE));

    const storage = memoryStorage();
    const usage = createApiUsageStore(storage);
    usage.recordAttempt(PRIMARY, 'gemini-2.5-flash');
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', dailyQuota());
    const saved = storage.values.get(STORAGE_KEYS.WEB_API_USAGE_V1) ?? '';
    expect(saved).toContain('AIzaSy...0123');
    expect(saved).not.toContain(PRIMARY);
  });

  it('dates the quota on Pacific time: 09:00 in Italy starts a new day', () => {
    // 26 Oct 2026 07:30 UTC is still the 25th in California (PDT, UTC-7).
    expect(pacificDateString(new Date('2026-10-26T06:59:00Z'))).toBe('2026-10-25');
    expect(pacificDateString(new Date('2026-10-26T07:00:00Z'))).toBe('2026-10-26');
  });

  it('marks a key exhausted on one model after the daily quota error, and the reserve takes over', () => {
    const usage = createApiUsageStore(memoryStorage());
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', dailyQuota());

    const result = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash');
    const [primary, reserve] = result.credentials ?? [];
    expect(primary).toMatchObject({ label: 'Chiave Principale', is_primary: true, masked_key: 'AIzaSy...0123', operational_status: 'temporarily_failing', exhausted_models: ['gemini-2.5-flash'], last_error_code: 429 });
    expect(reserve).toMatchObject({ label: 'Chiave Riserva 1', is_primary: false, operational_status: 'unused', exhausted_models: [] });
    expect(result.primary_status).toBe('degraded');
    expect(result.is_degraded_mode).toBe(true);
    expect(result.project_limits?.['gemini-2.5-flash']).toMatchObject({ rpd_limit: 20, rpm_limit: 5, quota_state: 'normal' });
    expect(result.next_reset_info).toBe('Reset quote: ore 09:00 (ora italiana / 00:00 PT)');

    usage.recordFailure(RESERVE, 'gemini-2.5-flash', dailyQuota());
    const allGone = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash');
    expect(allGone.primary_status).toBe('quota_exhausted');
    expect(allGone.project_limits?.['gemini-2.5-flash'].quota_state).toBe('rpd_exhausted');
    // Other models are still available on both keys.
    expect(allGone.project_limits?.['gemini-3.6-flash'].quota_state).toBe('normal');
  });

  it('ignores per-minute limits and transient errors: only the daily quota marks a key', () => {
    const usage = createApiUsageStore(memoryStorage());
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', new GeminiHttpError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_minute', 30, ''));
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', new GeminiHttpError(503, 'UNAVAILABLE', 'The model is overloaded.', null, ''));

    const [primary] = usage.getDailyUsage(PRIMARY, [], 'gemini-2.5-flash').credentials ?? [];
    expect(primary.exhausted_models).toEqual([]);
    expect(primary.operational_status).toBe('unused');
  });

  it('records invalid and forbidden keys, and a success clears the model exhaustion', () => {
    const usage = createApiUsageStore(memoryStorage());
    usage.recordFailure(RESERVE, 'gemini-2.5-flash', new GeminiHttpError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.', null, ''));
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', dailyQuota());
    usage.recordSuccess(PRIMARY, 'gemini-2.5-flash');

    const [primary, reserve] = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash').credentials ?? [];
    expect(primary).toMatchObject({ operational_status: 'active', exhausted_models: [] });
    expect(reserve).toMatchObject({ operational_status: 'invalid', last_error_code: 400 });

    const only = usage.getDailyUsage(RESERVE, [], 'gemini-2.5-flash');
    expect(only.primary_status).toBe('credential_error');
  });

  it('clears exhaustion at the next Pacific day but keeps an invalid key invalid', () => {
    const storage = memoryStorage();
    let now = new Date('2026-10-26T12:00:00Z');
    const usage = createApiUsageStore(storage, () => now);
    usage.recordAttempt(PRIMARY, 'gemini-2.5-flash');
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', dailyQuota());
    usage.recordFailure(RESERVE, 'gemini-2.5-flash', new GeminiHttpError(401, 'UNAUTHENTICATED', 'API key not valid.', null, ''));

    now = new Date('2026-10-27T07:05:00Z');
    const [primary, reserve] = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash').credentials ?? [];
    expect(primary).toMatchObject({ operational_status: 'active', exhausted_models: [] });
    expect(reserve.operational_status).toBe('invalid');
  });

  it('"Verifica connessione": the probe result fixes or flags the main key without touching exhaustion', () => {
    const usage = createApiUsageStore(memoryStorage());
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', new GeminiHttpError(401, 'UNAUTHENTICATED', 'API key not valid.', null, ''));
    usage.recordFailure(RESERVE, 'gemini-2.5-flash', dailyQuota());

    usage.refresh(PRIMARY, 'active');
    const [primary, reserve] = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash').credentials ?? [];
    expect(primary.operational_status).toBe('unused');
    expect(reserve.exhausted_models).toEqual(['gemini-2.5-flash']);

    usage.refresh(PRIMARY, 'permission_denied', 403, 'Permission denied');
    const [flagged] = usage.getDailyUsage(PRIMARY, [RESERVE], 'gemini-2.5-flash').credentials ?? [];
    expect(flagged).toMatchObject({ operational_status: 'permission_denied', last_error_code: 403 });
  });

  it('survives unreadable storage', () => {
    const usage = createApiUsageStore({ getItem: () => '{not json', setItem: () => { throw new Error('full'); } });
    usage.recordFailure(PRIMARY, 'gemini-2.5-flash', dailyQuota());
    expect(usage.getDailyUsage(PRIMARY, [], 'gemini-2.5-flash').credentials).toHaveLength(1);
  });
});

describe('GeminiClient usage hooks', () => {
  const okResponse = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'testo' }] } }] }), { status: 200 });
  const request = { model: 'gemini-2.5-flash', systemInstruction: 's', parts: [{ text: 'p' }], temperature: 0.1 };

  it('reports every generate call with its key and model', async () => {
    const usage = { recordAttempt: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(okResponse()).mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED', message: 'exceeded your current quota' } }), { status: 429 })));
    try {
      const client = new GeminiClient(PRIMARY, 'https://example.invalid', usage);
      await client.generate(request);
      await expect(client.generate(request)).rejects.toBeInstanceOf(GeminiHttpError);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(usage.recordAttempt).toHaveBeenCalledTimes(2);
    expect(usage.recordAttempt).toHaveBeenCalledWith(PRIMARY, 'gemini-2.5-flash');
    expect(usage.recordSuccess).toHaveBeenCalledTimes(1);
    expect(usage.recordFailure).toHaveBeenCalledWith(PRIMARY, 'gemini-2.5-flash', expect.any(GeminiHttpError));
  });

  it('does not count a request the user stopped as a key failure', async () => {
    const usage = { recordAttempt: vi.fn(), recordSuccess: vi.fn(), recordFailure: vi.fn() };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('stopped', 'AbortError')));
    try {
      await expect(new GeminiClient(PRIMARY, 'https://example.invalid', usage).generate(request)).rejects.toThrow('stopped');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(usage.recordFailure).not.toHaveBeenCalled();
  });
});

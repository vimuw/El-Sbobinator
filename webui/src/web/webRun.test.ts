import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDescriptor } from '../appState';
import { CancelledError, CircuitBreakerExhaustedError, DegenerateOutputError, InvalidKeyError, QuotaDailyLimitError } from './pipeline/retry';
import { FileMismatchError, defaultSettings, type AudioSource } from './pipeline/run';
import { fileIdentity, newSession, sameFile, type CheckpointStore, type SessionState } from './pipeline/session';
import { failurePayload, runWebFile, type WebRunOptions } from './webRun';

type Reply = { status?: number; json: unknown };
const okText = (text: string): Reply => ({ json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } });
const chunkText = (i: number) => `## Argomento ${i}\n\n` + `Il blocco ${i} spiega la fisiologia del nefrone con molti dettagli unici numero ${i}. `.repeat(4).trim();
const quota: Reply = { status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'exceeded your current quota' } } };

function mockGemini(replies: Reply[], onCall?: () => void) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (!url.includes(':generateContent')) throw new Error(`unexpected request ${url}`);
    onCall?.();
    const next = replies.shift();
    if (!next) throw new Error('unexpected Gemini call');
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function memoryStore(initial: SessionState[]) {
  const records = new Map(initial.map(state => [state.id, structuredClone(state)]));
  const store: CheckpointStore = {
    findByFile: async file => [...records.values()].find(state => sameFile(state.file, file)) ?? null,
    findByArchive: async dir => [...records.values()].find(state => state.archiveSessionDir === dir) ?? null,
    get: async id => records.get(id) ?? null,
    save: async state => { records.set(state.id, structuredClone(state)); },
    delete: async id => { records.delete(id); },
  };
  return { store, records };
}

function fakeAudio(chunks = 1) {
  const audio = {
    disposed: 0,
    dispose() { audio.disposed += 1; },
    cut: async (chunkSec: number, stepSec: number) => ({
      plan: Array.from({ length: chunks }, (_, index) => ({ index, startSec: index * stepSec, durationSec: chunkSec })),
      durationSec: chunks * stepSec,
      cutMs: 3,
      description: 'MP3',
    }),
    prepare: async (index: number) => ({ blob: new Blob([`audio ${index}`]), mimeType: 'audio/ogg', codec: 'opus' as const, encodeMs: 5 }),
    toBase64: async (blob: Blob) => btoa(await blob.text()),
  } satisfies AudioSource & { dispose(): void; disposed: number };
  return audio;
}

const descriptor: FileDescriptor = { id: 'f1', name: 'Lezione.mp3', path: 'web-file://f1', size: 20, duration: 60 };
const file = new Blob(['x'.repeat(20)]);

function setup(overrides: Partial<WebRunOptions> = {}, initial: SessionState[] = []) {
  const events: Array<[string, unknown]> = [];
  const { store, records } = memoryStore(initial);
  const audio = fakeAudio();
  const controller = new AbortController();
  const archived: Array<Record<string, unknown>> = [];
  const options: WebRunOptions = {
    descriptor,
    file,
    keys: ['KEY-1'],
    model: 'gemini-2.5-flash',
    emit: (name, payload) => { events.push([name, payload]); },
    controller,
    store,
    createAudio: () => audio,
    page: { isOffline: () => false, waitOnline: async () => {}, isHidden: () => false, wasHiddenSince: () => false, waitVisible: async () => {} },
    askRegenerate: async () => false,
    askNewKey: async () => null,
    saveArchive: (session, body) => {
      archived.push({ ...session, body });
      return { ...session, session_dir: 'web-session://s1', html_path: 'web-session://s1/sbobina.html' };
    },
    archiveExists: () => true,
    sleep: async (_secs, signal) => { if (signal.aborted) throw new CancelledError('annullato'); },
    now: () => 0,
    wakeLock: { supported: false, start: async () => {}, stop: async () => {} },
    ...overrides,
  };
  const named = (name: string) => events.filter(([event]) => event === name).map(([, payload]) => payload);
  return { options, events, named, records, archived, audio, controller };
}

async function checkpoint(stage: SessionState['stage'], extra: Partial<SessionState> = {}): Promise<SessionState> {
  const state = newSession('old', await fileIdentity(file, descriptor.name), defaultSettings('gemini-2.5-flash'));
  state.stage = stage;
  state.plan = [{ index: 0, startSec: 0, durationSec: 900 }, { index: 1, startSec: 840, durationSec: 900 }];
  state.chunkTexts = [chunkText(1)];
  return Object.assign(state, extra);
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('failurePayload', () => {
  const base = { index: 0, id: 'f1' };
  const state = (stage: SessionState['stage'], chunks = 0) => ({ stage, chunkTexts: Array(chunks).fill('t') }) as SessionState;

  it('maps quota errors to the desktop keys by phase', () => {
    expect(failurePayload(new QuotaDailyLimitError('x'), state('phase1'), base).error).toBe('quota_daily_limit_phase1');
    expect(failurePayload(new QuotaDailyLimitError('x'), state('phase2'), base).error).toBe('quota_daily_limit_phase2');
    expect(failurePayload(new QuotaDailyLimitError('api_key_prompt_timeout'), null, base).error_detail).toBe('api_key_prompt_timeout');
  });

  it('numbers the failed chunk and marks a circuit breaker pause as retryable', () => {
    const payload = failurePayload(new CircuitBreakerExhaustedError('503'), state('phase1', 2), base, Date.UTC(2026, 0, 1));
    expect(payload).toMatchObject({ error: 'phase1_chunk_failed_3', retryable: true, retry_reason: 'circuit_breaker_paused', recommended_retry_at: '2026-01-01T00:30:00.000Z' });
    expect(failurePayload(new CircuitBreakerExhaustedError('503'), state('phase2'), base).error).toBe('processing_failed');
  });

  it('gives readable text for key, degenerate, mismatch and storage errors', () => {
    expect(failurePayload(new InvalidKeyError('bad'), null, base).error).toContain('Chiave API non valida');
    expect(failurePayload(new DegenerateOutputError('loop'), state('phase1'), base).error).toBe('phase1_degenerate_output');
    expect(failurePayload(new FileMismatchError('Non è lo stesso audio.'), state('phase1'), base).error).toBe('Non è lo stesso audio.');
    expect(failurePayload(new DOMException('full', 'QuotaExceededError'), state('phase1'), base).error).toContain('Spazio del browser esaurito');
    expect(failurePayload(new Error('boom'), state('phase2'), base)).toMatchObject({ error: 'processing_failed', error_detail: 'Error: boom' });
    expect(failurePayload(new Error('boom'), state('phase1', 1), base).error).toBe('phase1_chunk_failed_2');
  });
});

describe('runWebFile', () => {
  it('runs a file to the end and reports it like the desktop', async () => {
    mockGemini([okText(chunkText(1)), okText('## Rivisto\n\nTesto rivisto della lezione.')]);
    const { options, named, archived, audio, events, records } = setup();

    await expect(runWebFile(options)).resolves.toBe('completed');

    expect(named('setCurrentFile')).toEqual([{ index: 0, id: 'f1', total: 1 }]);
    expect(named('processingWarning')).toEqual([
      expect.objectContaining({ code: 'web_keep_page_open', message: expect.stringContaining('Tieni questa pagina aperta') }),
      { code: 'web_keep_page_open', message: null },
    ]);
    expect(named('fileDone')).toEqual([expect.objectContaining({
      id: 'f1',
      session_dir: 'web-session://s1',
      html_path: 'web-session://s1/sbobina.html',
      completion_status: 'completed',
      revision_failed_blocks: [],
    })]);
    expect(archived[0]).toMatchObject({ input_name: 'Lezione.mp3', completion_status: 'completed', body: expect.stringContaining('<h1>Lezione</h1>') });
    expect([...records.values()][0].archiveSessionDir).toBe('web-session://s1');
    expect(named('processDone')).toEqual([expect.objectContaining({ cancelled: false, completed: 1, failed: 0, total: 1 })]);
    expect(events.at(-1)![0]).toBe('processDone');
    expect(audio.disposed).toBe(1);
  });

  it('asks to resume a partial session and continues from the saved chunk', async () => {
    const fetchMock = mockGemini([okText(chunkText(2)), okText('## R\n\nTesto rivisto.')]);
    const asked: string[] = [];
    const { options, records } = setup({
      askRegenerate: async mode => { asked.push(mode); return false; },
      createAudio: () => fakeAudio(2),
    }, [await checkpoint('phase1')]);

    await expect(runWebFile(options)).resolves.toBe('completed');

    expect(asked).toEqual(['resume']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(records.get('old')!.resumes).toBe(1);
  });

  it('applies the model chosen now to a session that has no chunk yet', async () => {
    const fetchMock = mockGemini([okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    // Stopped after the cut with 3.6 Flash: two planned chunks, none transcribed.
    const stale = await checkpoint('phase1', { chunkTexts: [], settings: defaultSettings('gemini-3.6-flash') });
    const askRegenerate = vi.fn(async () => false);
    const { options, named, records } = setup({ model: 'gemini-2.5-flash', askRegenerate }, [stale]);

    await expect(runWebFile(options)).resolves.toBe('completed');

    expect(askRegenerate).not.toHaveBeenCalled();
    expect(named('updateModel')).toEqual(['gemini-2.5-flash']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models/gemini-2.5-flash:generateContent');
    const saved = records.get('old')!;
    expect(saved.settings).toEqual(defaultSettings('gemini-2.5-flash'));
    // Planned again with the new chunk length, not refused as a different file.
    expect(saved.plan).toHaveLength(1);
  });

  it('keeps the session model once a chunk is transcribed', async () => {
    const fetchMock = mockGemini([okText(chunkText(2)), okText('## R\n\nTesto rivisto.')]);
    const started = await checkpoint('phase1', { settings: defaultSettings('gemini-3.6-flash') });
    const { options, named, records } = setup({ model: 'gemini-2.5-flash', createAudio: () => fakeAudio(2) }, [started]);

    await expect(runWebFile(options)).resolves.toBe('completed');

    expect(named('updateModel')).toEqual(['gemini-3.6-flash']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models/gemini-3.6-flash:generateContent');
    expect(records.get('old')!.settings).toEqual(defaultSettings('gemini-3.6-flash'));
  });

  it('reuses an archived completed session without calling Gemini', async () => {
    const fetchMock = mockGemini([]);
    const done = await checkpoint('done', { archiveSessionDir: 'web-session://s1', body: '<h1>x</h1>' });
    const asked: string[] = [];
    const { options, named } = setup({ askRegenerate: async mode => { asked.push(mode); return false; } }, [done]);

    await expect(runWebFile(options)).resolves.toBe('completed');

    expect(asked).toEqual(['completed']);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(named('fileDone')).toEqual([expect.objectContaining({ session_dir: 'web-session://s1', html_path: 'web-session://s1/sbobina.html' })]);
  });

  it('starts over on "rigenera": the old checkpoint is deleted', async () => {
    mockGemini([okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { options, records } = setup({ askRegenerate: async () => true }, [await checkpoint('phase1')]);
    await expect(runWebFile(options)).resolves.toBe('completed');
    expect(records.has('old')).toBe(false);
    expect(records.size).toBe(1);
  });

  it('starts over without asking when the queue says not to resume', async () => {
    mockGemini([okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const askRegenerate = vi.fn(async () => false);
    const { options, records } = setup({ descriptor: { ...descriptor, resume_session: false }, askRegenerate }, [await checkpoint('phase1')]);
    await runWebFile(options);
    expect(askRegenerate).not.toHaveBeenCalled();
    expect(records.has('old')).toBe(false);
  });

  it('cancels when the dialog is dismissed', async () => {
    const fetchMock = mockGemini([]);
    const { options, named } = setup({ askRegenerate: async () => null }, [await checkpoint('phase1')]);
    await expect(runWebFile(options)).resolves.toBe('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(named('fileFailed')).toEqual([]);
    expect(named('processDone')).toEqual([expect.objectContaining({ cancelled: true, completed: 0 })]);
  });

  it('pauses with fileFailed when the dialog times out', async () => {
    mockGemini([]);
    const { options, named } = setup({ askRegenerate: async () => 'timeout' }, [await checkpoint('phase1')]);
    await expect(runWebFile(options)).resolves.toBe('failed');
    expect(named('fileFailed')).toEqual([{ index: 0, id: 'f1', error: 'regenerate_prompt_timeout' }]);
  });

  it('pauses on the daily quota when no new key comes in time, progress kept', async () => {
    mockGemini([okText(chunkText(1)), quota]);
    const { options, named, records } = setup({ askNewKey: async () => 'timeout', createAudio: () => fakeAudio(2) });
    await expect(runWebFile(options)).resolves.toBe('failed');
    expect(named('fileFailed')).toEqual([expect.objectContaining({ error: 'quota_daily_limit_phase1', error_detail: 'api_key_prompt_timeout' })]);
    expect(named('processDone')).toEqual([expect.objectContaining({ failed: 1, quota_exhausted: true })]);
    expect([...records.values()][0].chunkTexts).toEqual([chunkText(1)]);
  });

  it('continues with the key typed in the new key dialog, without saving it', async () => {
    const fetchMock = mockGemini([quota, okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { options } = setup({ askNewKey: async () => 'KEY-NEW' });
    await expect(runWebFile(options)).resolves.toBe('completed');
    const keys = fetchMock.mock.calls.map(([, init]) => (init!.headers as Record<string, string>)['x-goog-api-key']);
    expect(keys).toEqual(['KEY-1', 'KEY-NEW', 'KEY-NEW']);
    expect(options.keys).toEqual(['KEY-1']);
  });

  it('cancels when the new key dialog is closed', async () => {
    mockGemini([quota]);
    const closed = setup({ askNewKey: async () => null });
    await expect(runWebFile(closed.options)).resolves.toBe('cancelled');
    expect(closed.named('fileFailed')).toEqual([]);
  });

  it('cancels on Stop with the progress saved and no failure shown', async () => {
    const run = setup();
    mockGemini([okText(chunkText(1))], () => run.controller.abort());
    await expect(runWebFile(run.options)).resolves.toBe('cancelled');
    expect(run.named('fileFailed')).toEqual([]);
    expect(run.named('processDone')).toEqual([expect.objectContaining({ cancelled: true })]);
    expect(run.records.size).toBe(1);
  });

  it('pauses on a circuit breaker error', async () => {
    const overloaded: Reply = { status: 503, json: { error: { status: 'UNAVAILABLE', message: 'The model is overloaded.' } } };
    mockGemini(Array(40).fill(overloaded));
    const { options, named } = setup();
    await expect(runWebFile(options)).resolves.toBe('paused');
    expect(named('fileFailed')).toEqual([expect.objectContaining({ error: 'phase1_chunk_failed_1', retry_reason: 'circuit_breaker_paused' })]);
    expect(named('processDone')).toEqual([expect.objectContaining({ paused: 1, failed: 0 })]);
  });
});

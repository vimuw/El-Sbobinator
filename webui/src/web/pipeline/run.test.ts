import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_REVISIONE, PROMPT_SISTEMA } from '../../generationProfile';
import { NOTICE_PREFIX } from '../../phaseLabels';
import { CancelledError, QuotaDailyLimitError } from './retry';
import { FileMismatchError, defaultSettings, runPipeline, type AudioSource, type PipelineEnv, type PreparedAudio } from './run';
import { newSession, type CheckpointStore, type SessionState } from './session';

type GeminiBody = {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string }; fileData?: { fileUri: string } }> }>;
  generationConfig: { temperature: number; thinkingConfig?: { thinkingBudget: number } };
};
type Reply = { status?: number; json?: unknown; text?: string } | ((body: GeminiBody, key: string) => { status?: number; json?: unknown; text?: string });

const okText = (text: string) => ({ json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } });
const chunkText = (i: number) => `## Argomento ${i}\n\n` + `Il blocco ${i} spiega la fisiologia del nefrone con molti dettagli unici numero ${i}. `.repeat(4).trim();

// A scripted Gemini: each generateContent call takes the next reply; uploads are answered too.
function mockGemini(replies: Reply[]) {
  const calls: Array<{ body: GeminiBody; key: string }> = [];
  const other: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const key = (init.headers as Record<string, string>)['x-goog-api-key'] ?? '';
    if (url.includes(':generateContent')) {
      const body = JSON.parse(String(init.body)) as GeminiBody;
      calls.push({ body, key });
      const next = replies.shift();
      if (!next) throw new Error('unexpected Gemini call');
      const reply = typeof next === 'function' ? next(body, key) : next;
      return new Response(reply.text ?? JSON.stringify(reply.json ?? {}), { status: reply.status ?? 200 });
    }
    other.push(`${init.method ?? 'GET'} ${url.replace(/^https:\/\/[^/]+/, '')}`);
    if (url.endsWith('/upload/v1beta/files')) return new Response('{}', { headers: { 'x-goog-upload-url': 'https://upload.example/session-1' } });
    if (url === 'https://upload.example/session-1') return new Response(JSON.stringify({ file: { name: 'files/abc', uri: 'https://files/abc', mimeType: 'audio/aac', state: 'ACTIVE' } }));
    if (init.method === 'DELETE') return new Response('{}');
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, other };
}

function memoryStore() {
  const saved: SessionState[] = [];
  const store: CheckpointStore = {
    findByFile: async () => null,
    findByArchive: async () => null,
    get: async () => null,
    save: async state => { saved.push(structuredClone(state)); },
    delete: async () => {},
  };
  return { store, saved };
}

function fakeAudio(chunks: number, codec: PreparedAudio['codec'] = 'opus'): AudioSource & { prepared: number[] } {
  const prepared: number[] = [];
  return {
    prepared,
    cut: async (chunkSec, stepSec) => ({
      plan: Array.from({ length: chunks }, (_, index) => ({ index, startSec: index * stepSec, durationSec: chunkSec })),
      durationSec: chunks * stepSec,
      cutMs: 3,
      description: 'M4A AAC 48000 Hz mono',
    }),
    prepare: async index => {
      prepared.push(index);
      return { blob: new Blob([`audio ${index}`]), mimeType: codec === 'opus' ? 'audio/ogg' : 'audio/aac', codec, encodeMs: 5 };
    },
    toBase64: async blob => btoa(await blob.text()),
  };
}

function makeEnv(audio: AudioSource, overrides: Partial<PipelineEnv> = {}) {
  const { store, saved } = memoryStore();
  const phases: string[] = [];
  const consoleLines: string[] = [];
  const workDone: string[] = [];
  const controller = new AbortController();
  const env: PipelineEnv = {
    keys: ['KEY-1'],
    store,
    audio,
    reporter: {
      phase: text => phases.push(text),
      notice: text => phases.push(text),
      console: line => consoleLines.push(line),
      progress: () => {},
      totals: () => {},
      workDone: (kind, done, total) => workDone.push(`${kind} ${done}/${total}`),
    },
    page: { isOffline: () => false, waitOnline: async () => {}, isHidden: () => false, wasHiddenSince: () => false, waitVisible: async () => {} },
    signal: controller.signal,
    sleep: async (_secs, signal) => {
      if (signal.aborted) throw new CancelledError('annullato');
    },
    now: () => 0,
    ...overrides,
  };
  return { env, saved, phases, consoleLines, workDone, controller };
}

function session(model = 'gemini-2.5-flash', macroCharLimit = 400): SessionState {
  const state = newSession('s1', { name: 'Fisiologia L1.m4a', size: 10, headHash: 'h' }, { ...defaultSettings(model), macroCharLimit });
  return state;
}

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('runPipeline', () => {
  it('uses the desktop settings for a new session', () => {
    expect(defaultSettings('gemini-3.6-flash')).toEqual({ model: 'gemini-3.6-flash', chunkSec: 900, stepSec: 840, macroCharLimit: 22000 });
  });

  it('transcribes every chunk, revises the sections and exports the body', async () => {
    const replies: Reply[] = [okText(chunkText(1)), okText(chunkText(2)), okText(chunkText(3))];
    for (let i = 0; i < 4; i += 1) replies.push(body => okText(`## Rivisto\n\n${body.contents[0].parts[0].text!.slice(0, 40)}`));
    const { calls } = mockGemini(replies);
    const audio = fakeAudio(3);
    const { env, saved, phases, workDone } = makeEnv(audio);

    const state = await runPipeline(session(), env);

    // Phase 1: system prompt, chunk prompt with the previous tail, inline Opus, 2.5 Flash thinking budget.
    const first = calls[0].body;
    expect(first.systemInstruction.parts[0].text).toBe(PROMPT_SISTEMA);
    expect(first.generationConfig).toEqual({ temperature: 0.35, thinkingConfig: { thinkingBudget: 16384 } });
    expect(first.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/ogg', data: btoa('audio 0') });
    expect(first.contents[0].parts[0].text).not.toContain('ATTENZIONE');
    expect(calls[1].body.contents[0].parts[0].text).toContain(`"...${chunkText(1).trim().slice(-2000)}"`);
    // Phase 2 at temperature 0.1 with the revision prompt.
    const revision = calls[3].body;
    expect(revision.systemInstruction.parts[0].text).toBe(PROMPT_REVISIONE);
    expect(revision.generationConfig).toEqual({ temperature: 0.1 });

    expect(state.stage).toBe('done');
    expect(state.chunkTexts).toHaveLength(3);
    expect(state.revised!.every(text => text?.startsWith('## Rivisto'))).toBe(true);
    expect(state.body).toMatch(/^<h1>Fisiologia L1<\/h1>/);
    expect(state.body).not.toContain('revision-warning-banner');
    // A checkpoint after the cut, after each chunk and after each section.
    expect(saved.filter(entry => entry.stage === 'phase1').map(entry => entry.chunkTexts.length)).toEqual([0, 1, 2, 3]);
    expect(phases).toContain('Fase 1/3: trascrizione (chunk 3/3)');
    expect(phases).toContain(`Fase 2/3: revisione (1/${state.macroBlocks!.length})`);
    expect(phases.at(-1)).toBe('Fase: esportazione HTML');
    expect(workDone).toContain('chunks 3/3');
    expect(audio.prepared).toEqual([0, 1, 2]);
  });

  it('resumes from the first chunk without text', async () => {
    const state = session();
    state.plan = [0, 1, 2].map(index => ({ index, startSec: index * 840, durationSec: 900 }));
    state.chunkTexts = [chunkText(1)];
    state.prevMemory = chunkText(1).slice(-2000);
    const { calls } = mockGemini([okText(chunkText(2)), okText(chunkText(3)), ...Array(4).fill(okText('## R\n\nTesto rivisto.'))]);
    const audio = fakeAudio(3);
    await runPipeline(state, makeEnv(audio).env);
    expect(audio.prepared).toEqual([1, 2]);
    expect(calls[0].body.contents[0].parts[0].text).toContain('ATTENZIONE');
    expect(state.chunkTexts[1]).toBe(chunkText(2));
  });

  it('refuses a reselected file that cuts differently', async () => {
    const state = session();
    state.plan = [0, 1].map(index => ({ index, startSec: index * 840, durationSec: 900 }));
    mockGemini([]);
    await expect(runPipeline(state, makeEnv(fakeAudio(3)).env)).rejects.toBeInstanceOf(FileMismatchError);
  });

  it('regenerates a chunk once when the output is degenerate', async () => {
    const looping = Array(5).fill(`Questa frase si ripete troppo spesso nel testo generato dal modello in esame, sempre uguale.`).join('\n\n');
    mockGemini([okText(looping), okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { env, phases } = makeEnv(fakeAudio(1));
    const state = await runPipeline(session(), env);
    expect(state.chunkTexts[0]).toBe(chunkText(1));
    expect(phases.some(text => text.startsWith(NOTICE_PREFIX.invalidOutput))).toBe(true);
  });

  it('uploads the original chunk through the Files API when Opus is not available', async () => {
    const { calls, other } = mockGemini([okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    await runPipeline(session('gemini-3.6-flash'), makeEnv(fakeAudio(1, 'original')).env);
    expect(calls[0].body.contents[0].parts[1].fileData).toEqual({ mimeType: 'audio/aac', fileUri: 'https://files/abc' });
    expect(calls[0].body.generationConfig).toEqual({ temperature: 0.35 });
    expect(other).toEqual(['POST /upload/v1beta/files', 'POST /session-1', 'DELETE /v1beta/files/abc']);
  });

  it('moves to the next key on the daily quota and redoes the same chunk', async () => {
    const quota = { status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 20' } } };
    const { calls } = mockGemini([quota, okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { env, consoleLines } = makeEnv(fakeAudio(1), { keys: ['KEY-1', 'KEY-2'] });
    const state = await runPipeline(session(), env);
    expect(calls.map(call => call.key)).toEqual(['KEY-1', 'KEY-2', 'KEY-2']);
    expect(state.keyRotations).toBe(1);
    expect(consoleLines.join('\n')).toContain('continuo con la chiave 2/2');
    expect(consoleLines.join('\n')).not.toContain('KEY-');
  });

  it('stops with the quota error, progress saved, when every key is exhausted', async () => {
    const quota = { status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'exceeded your current quota' } } };
    mockGemini([okText(chunkText(1)), quota]);
    const { env, saved } = makeEnv(fakeAudio(2));
    await expect(runPipeline(session(), env)).rejects.toBeInstanceOf(QuotaDailyLimitError);
    expect(saved.at(-1)!.chunkTexts).toEqual([chunkText(1)]);
  });

  it('includes a section unrevised after the retry pass and adds the warning', async () => {
    const bad = { status: 400, json: { error: { status: 'INVALID_ARGUMENT', message: 'bad' } } };
    mockGemini([okText(chunkText(1)), bad, bad]);
    const { env, phases } = makeEnv(fakeAudio(1), {});
    const state = await runPipeline(session('gemini-2.5-flash', 22000), env);
    expect(state.failedBlocks).toEqual([0]);
    expect(state.revised![0]).toBe(state.macroBlocks![0].trim());
    expect(state.body).toContain('revision-warning-banner');
    expect(phases).toContain('Fase 2/3: retry revisione (blocco 1/1)');
  });

  it('stops when cancelled', async () => {
    const { env, controller } = makeEnv(fakeAudio(2));
    mockGemini([() => {
      controller.abort();
      return okText(chunkText(1));
    }]);
    await expect(runPipeline(session(), env)).rejects.toBeInstanceOf(CancelledError);
  });
});

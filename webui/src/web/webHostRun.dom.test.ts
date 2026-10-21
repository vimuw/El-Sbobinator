import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDescriptor } from '../appState';
import { DESKTOP_CAPABILITIES, getHostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';
import { createCheckpointStore } from './checkpointStore';
import type { BridgeEventName } from './fakePipeline';
import { CancelledError } from './pipeline/retry';
import { defaultSettings, type AudioSource } from './pipeline/run';
import { fileIdentity, newSession, type CheckpointStore } from './pipeline/session';
import { createWebPywebviewApi, initWebHost } from './webHost';

// The web host with the real pipeline: Gemini is a scripted fetch, audio work a fake source.

type Reply = { status?: number; json: unknown };
const okText = (text: string): Reply => ({ json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] } });
const chunkText = (i: number) => `## Argomento ${i}\n\n` + `Il blocco ${i} spiega la fisiologia del nefrone con molti dettagli unici numero ${i}. `.repeat(4).trim();
const quota: Reply = { status: 429, json: { error: { status: 'RESOURCE_EXHAUSTED', message: 'exceeded your current quota' } } };
const KEY = 'AIzaSyMain12345678901234567';

function mockGemini(replies: Reply[]) {
  const keys: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (!url.includes(':generateContent')) throw new Error(`unexpected request ${url}`);
    keys.push((init?.headers as Record<string, string>)['x-goog-api-key']);
    const next = replies.shift();
    if (!next) throw new Error('unexpected Gemini call');
    return new Response(JSON.stringify(next.json), { status: next.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, keys, replies };
}

function fakeAudio(chunks: number): AudioSource & { dispose(): void } {
  return {
    dispose: () => {},
    cut: async (chunkSec, stepSec) => ({
      plan: Array.from({ length: chunks }, (_, index) => ({ index, startSec: index * stepSec, durationSec: chunkSec })),
      durationSec: chunks * stepSec,
      cutMs: 3,
      description: 'MP3',
    }),
    prepare: async index => ({ blob: new Blob([`audio ${index}`]), mimeType: 'audio/ogg', codec: 'opus', encodeMs: 5 }),
    toBase64: async blob => btoa(await blob.text()),
  };
}

const page = () => ({ isOffline: () => false, waitOnline: async () => {}, isHidden: () => false, wasHiddenSince: () => false, waitVisible: async () => {}, dispose: () => {} });
const noSleep = async (_secs: number, signal: AbortSignal) => {
  if (signal.aborted) throw new CancelledError('annullato');
};

function host(store: CheckpointStore, chunks = 2) {
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  const api = createWebPywebviewApi((name, payload) => { events.push({ name, payload }); }, {
    store,
    createAudio: () => fakeAudio(chunks),
    createPage: page,
    sleep: noSleep,
  });
  const named = (name: BridgeEventName) => events.filter(event => event.name === name).map(event => event.payload);
  const finished = () => vi.waitFor(() => expect(named('processDone')).toHaveLength(1));
  return { api, events, named, finished };
}

/** Answers the next file picker the way the user would: input.click() → change with the chosen file. */
function pickNextFile(file: File) {
  const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementationOnce(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { configurable: true, value: [file] });
    this.dispatchEvent(new Event('change'));
  });
  return click;
}

let store: CheckpointStore;

beforeEach(() => {
  localStorage.clear();
  store = createCheckpointStore(new IDBFactory());
  vi.spyOn(Math, 'random').mockReturnValue(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setHostCapabilities(DESKTOP_CAPABILITIES);
  delete window.pywebview;
  window.elSbobinatorBridge = null;
  window.history.replaceState(null, '', '/');
});

describe('web host with the real pipeline', () => {
  it('declares the real pipeline; ?simulazione=1 keeps the simulated run', async () => {
    const { fetchMock } = mockGemini([]);
    window.elSbobinatorBridge = {} as Window['elSbobinatorBridge'];
    initWebHost();
    expect(getHostCapabilities().realPipeline).toBe(true);

    window.history.replaceState(null, '', '/?simulazione=1');
    initWebHost();
    vi.useFakeTimers();
    const [file] = await window.pywebview!.api.upload_browser_files!([new File(['a'], 'Demo.mp3')]);
    expect(await window.pywebview!.api.start_processing!([file], KEY, true, 'gemini-2.5-flash')).toEqual({ ok: true });
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await window.pywebview!.api.get_completed_sessions!()).toMatchObject({ total: 1 });
  });

  it('runs a file with the main key and the saved keys, archives it and opens it in the editor', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, `${KEY}\nAIzaSyBackup1234567890123456`);
    const { keys } = mockGemini([quota, okText(chunkText(1)), okText(chunkText(2)), okText('## Rivisto\n\nTesto rivisto della lezione.')]);
    const { api, named, finished } = host(store);
    const [file] = await api.upload_browser_files!([new File(['audio-a'], 'Fisiologia.mp3')]);

    expect(await api.start_processing!([file], KEY, true, 'gemini-2.5-flash')).toEqual({ ok: true });
    expect(await api.start_processing!([file], KEY, true, 'gemini-2.5-flash')).toMatchObject({ ok: false });
    await finished();

    expect(keys).toEqual([KEY, 'AIzaSyBackup1234567890123456', 'AIzaSyBackup1234567890123456', 'AIzaSyBackup1234567890123456']);
    const [done] = named('fileDone') as Array<{ html_path: string; session_dir: string; completion_status: string }>;
    expect(done.completion_status).toBe('completed');
    expect((await api.read_html_content!(done.html_path)).content).toContain('<h1>Fisiologia</h1>');
    expect(named('updateWorkDone')).toContainEqual({ kind: 'chunks', done: 2, total: 2 });
    expect((await api.is_processing_active!()).active).toBe(false);
  });

  it('after a browser restart, shows and uses the model from the settings for a checkpoint with no chunk', async () => {
    // A run stopped with 3.6 Flash before its first chunk, then the model was set to 2.5 Flash.
    const audio = new File(['audio della lezione'], 'Lezione.mp3');
    const stale = newSession('stale', await fileIdentity(audio, audio.name), defaultSettings('gemini-3.6-flash'));
    stale.plan = [{ index: 0, startSec: 0, durationSec: 900 }, { index: 1, startSec: 840, durationSec: 900 }];
    await store.save(stale);
    const { fetchMock } = mockGemini([okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { api, named, finished } = host(store, 1);
    const [file] = await api.upload_browser_files!([audio]);

    await api.start_processing!([file], KEY, true, 'gemini-2.5-flash');
    await finished();

    expect(named('updateModel')).toEqual(['gemini-2.5-flash']);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models/gemini-2.5-flash:');
    expect(named('fileDone')).toEqual([expect.objectContaining({ effective_model: 'gemini-2.5-flash' })]);
  });

  it('refuses a queued path the page no longer holds', async () => {
    mockGemini([]);
    const { api } = host(store);
    const gone: FileDescriptor = { id: 'x', name: 'a.mp3', path: 'local://gone/a.mp3', size: 1 };
    expect(await api.start_processing!([gone], KEY, true, 'gemini-2.5-flash')).toMatchObject({ ok: false, error: expect.stringContaining('selezionalo di nuovo') });
    expect((await api.is_processing_active!()).active).toBe(false);
  });

  it('after a reload, the same file picked again resumes from the checkpoint', async () => {
    // First page: chunk 1 saved, then the daily quota and no new key in time.
    const audio = new File(['stesso audio della lezione'], 'Lezione.mp3');
    mockGemini([okText(chunkText(1)), quota]);
    const first = host(store);
    const [queued] = await first.api.upload_browser_files!([audio]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await vi.waitFor(() => expect(first.named('askNewKey')).toHaveLength(1));
    await first.api.answer_new_key!('');
    await first.finished();
    expect(first.named('fileFailed')).toEqual([]);

    // Reloaded page: the restored queue path is gone, the user picks the same file again.
    const second = host(store);
    expect(await second.api.check_path_exists!('local://old-page/Lezione.mp3')).toEqual({ ok: true, exists: false });
    pickNextFile(new File(['stesso audio della lezione'], 'Lezione.mp3'));
    const relinked = await second.api.ask_media_file!();
    expect(relinked).toMatchObject({ name: 'Lezione.mp3' });

    const { fetchMock } = mockGemini([okText(chunkText(2)), okText('## R\n\nTesto rivisto.')]);
    await second.api.start_processing!([{ ...relinked!, id: queued.id }], KEY, true, 'gemini-2.5-flash');
    await vi.waitFor(() => expect(second.named('askRegenerate')).toEqual([{ filename: 'Lezione.mp3', mode: 'resume', sessionDir: '' }]));
    await second.api.answer_regenerate!(false);
    await second.finished();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second.named('appendConsole')).toContain('Ripresa dal blocco 2/2.');
    expect(second.named('fileDone')).toEqual([expect.objectContaining({ id: queued.id, completion_status: 'completed' })]);
  });

  it('a different file picked again starts a new session without asking', async () => {
    mockGemini([okText(chunkText(1)), quota]);
    const first = host(store);
    const [queued] = await first.api.upload_browser_files!([new File(['audio uno'], 'Lezione.mp3')]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await vi.waitFor(() => expect(first.named('askNewKey')).toHaveLength(1));
    await first.api.answer_new_key!('');
    await first.finished();

    const second = host(store);
    pickNextFile(new File(['un altro audio diverso'], 'Lezione.mp3'));
    const relinked = await second.api.ask_media_file!();
    const { fetchMock } = mockGemini([okText(chunkText(1)), okText(chunkText(2)), okText('## R\n\nTesto rivisto.')]);
    await second.api.start_processing!([relinked!], KEY, true, 'gemini-2.5-flash');
    await second.finished();

    expect(second.named('askRegenerate')).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('continues with a key typed in the new key dialog', async () => {
    const { keys } = mockGemini([quota, okText(chunkText(1)), okText('## R\n\nTesto rivisto.')]);
    const { api, named, finished } = host(store, 1);
    const [file] = await api.upload_browser_files!([new File(['a'], 'a.mp3')]);
    await api.start_processing!([file], KEY, true, 'gemini-2.5-flash');
    await vi.waitFor(() => expect(named('askNewKey')).toHaveLength(1));
    await api.answer_new_key!(' AIzaSyNuova123456789012345678 ');
    await finished();
    expect(keys).toEqual([KEY, 'AIzaSyNuova123456789012345678', 'AIzaSyNuova123456789012345678']);
    expect(localStorage.getItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1)).toBeNull();
  });

  it('closes a pending dialog on Stop', async () => {
    mockGemini([okText(chunkText(1)), quota]);
    const { api, named, finished } = host(store);
    const [file] = await api.upload_browser_files!([new File(['a'], 'a.mp3')]);
    await api.start_processing!([file], KEY, true, 'gemini-2.5-flash');
    await vi.waitFor(() => expect(named('askNewKey')).toHaveLength(1));
    await api.stop_processing!();
    await finished();
    expect(named('processDone')).toEqual([expect.objectContaining({ cancelled: true })]);
  });

  describe('retry_failed_revision_blocks', () => {
    const bad: Reply = { status: 400, json: { error: { status: 'INVALID_ARGUMENT', message: 'bad' } } };

    async function finishedWithWarnings() {
      localStorage.setItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, KEY);
      mockGemini([okText(chunkText(1)), bad, bad]);
      const run = host(store, 1);
      const [file] = await run.api.upload_browser_files!([new File(['a'], 'Lezione.mp3')]);
      await run.api.start_processing!([file], KEY, true, 'gemini-2.5-flash');
      await run.finished();
      const [done] = run.named('fileDone') as Array<{ session_dir: string; html_path: string; revision_failed_blocks: number[] }>;
      expect(done.revision_failed_blocks).toEqual([1]);
      return { ...run, done };
    }

    it('revises the failed section again and updates the archive', async () => {
      const { api, done } = await finishedWithWarnings();
      mockGemini([okText('## Rivisto\n\nOra rivisto.')]);
      expect(await api.retry_failed_revision_blocks!(done.session_dir)).toMatchObject({
        ok: true, retried_blocks: [1], remaining_failed_blocks: [], completion_status: 'completed', html_path: done.html_path,
      });
      const content = (await api.read_html_content!(done.html_path)).content!;
      expect(content).toContain('Ora rivisto.');
      expect(content).not.toContain('revision-warning-banner');
      expect((await api.get_completed_sessions!()).sessions![0]).toMatchObject({ completion_status: 'completed', revision_failed_blocks: [] });
    });

    it('refuses to overwrite a document edited in the editor', async () => {
      const { api, done } = await finishedWithWarnings();
      const { fetchMock } = mockGemini([]);
      await api.save_html_content!(done.html_path, '<p>Mio testo</p>', 1);
      expect(await api.retry_failed_revision_blocks!(done.session_dir)).toMatchObject({ ok: false, conflict: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('stops without touching the document when the quota runs out and no key is given', async () => {
      const { api, done, named } = await finishedWithWarnings();
      const before = (await api.read_html_content!(done.html_path)).content;
      mockGemini([quota]);
      const pending = api.retry_failed_revision_blocks!(done.session_dir);
      await vi.waitFor(() => expect(named('askNewKey')).toHaveLength(1));
      await api.answer_new_key!('');
      expect(await pending).toMatchObject({ ok: false, cancelled: true, remaining_failed_blocks: [1] });
      expect((await api.read_html_content!(done.html_path)).content).toBe(before);
    });

    it('answers for an unknown session', async () => {
      mockGemini([]);
      const { api } = host(store);
      expect(await api.retry_failed_revision_blocks!('web-session://nessuna')).toMatchObject({ ok: false, error: 'Sessione non completata.' });
    });
  });
});

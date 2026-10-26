import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import type { BridgeEventName } from './fakePipeline';
import { CancelledError } from './pipeline/retry';
import type { AudioSource } from './pipeline/run';
import { forgetWebFiles } from './webFiles';
import { createWebPywebviewApi } from './webHost';
import { createWebMediaStore, type WebMediaStore } from './webMedia';

// The lecture audio kept in this browser: the queue survives a reload and the editor's player
// finds the sbobina's audio. Gemini is a scripted fetch, audio work a fake source.

const KEY = 'AIzaSyMain12345678901234567';
const okText = (text: string) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });

function mockGemini() {
  const replies = [okText('## Argomento\n\n' + 'Il nefrone filtra il sangue e riassorbe i soluti. '.repeat(4)), okText('## Rivisto\n\nTesto rivisto della lezione.')];
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(replies.shift()), { status: 200 })));
}

function fakeAudio(): AudioSource & { dispose(): void } {
  return {
    dispose: () => {},
    cut: async chunkSec => ({ plan: [{ index: 0, startSec: 0, durationSec: chunkSec }], durationSec: 60, cutMs: 1, description: 'MP3' }),
    prepare: async () => ({ blob: new Blob(['audio']), mimeType: 'audio/ogg', codec: 'opus', encodeMs: 1 }),
    toBase64: async blob => btoa(await blob.text()),
  };
}

const page = () => ({ isOffline: () => false, waitOnline: async () => {}, isHidden: () => false, wasHiddenSince: () => false, waitVisible: async () => {}, dispose: () => {} });
const noSleep = async (_secs: number, signal: AbortSignal) => {
  if (signal.aborted) throw new CancelledError('annullato');
};

let database: IDBFactory;
let urls: Map<string, Blob>;

function host(media?: WebMediaStore) {
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  const api = createWebPywebviewApi((name, payload) => { events.push({ name, payload }); }, {
    database,
    media,
    createAudio: fakeAudio,
    createPage: page,
    sleep: noSleep,
  });
  const named = (name: BridgeEventName) => events.filter(event => event.name === name).map(event => event.payload);
  return { api, named, finished: () => vi.waitFor(() => expect(named('processDone')).toHaveLength(1)) };
}

/** A reload: the page forgets its files, the browser database stays. */
function reload(media?: WebMediaStore) {
  forgetWebFiles();
  return host(media);
}

function pickNextFile(file: File) {
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementationOnce(function (this: HTMLInputElement) {
    Object.defineProperty(this, 'files', { configurable: true, value: [file] });
    this.dispatchEvent(new Event('change'));
  });
}

const lecture = (name = 'Fisiologia.mp3', text = 'audio della lezione') => new File([text], name, { type: '' });

beforeEach(() => {
  // fake-indexeddb clones with Node's structuredClone, which keeps Node files but not jsdom's.
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  forgetWebFiles();
  database = new IDBFactory();
  urls = new Map();
  let next = 0;
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: vi.fn((blob: Blob) => {
      const url = `blob:test/${++next}`;
      urls.set(url, blob);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => { urls.delete(url); }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audio kept in the browser by the web host', () => {
  it('starts a queued file after a reload without asking for it again', async () => {
    const first = host();
    const [queued] = await first.api.upload_browser_files!([lecture()]);
    expect(await first.api.check_path_exists!(queued.path!)).toEqual({ ok: true, exists: true });

    mockGemini();
    const second = reload();
    expect(await second.api.check_path_exists!(queued.path!)).toEqual({ ok: true, exists: true });
    expect(await second.api.check_path_exists!('local://other/Fisiologia.mp3')).toEqual({ ok: true, exists: false });
    expect(await second.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash')).toEqual({ ok: true });
    await second.finished();
    expect(second.named('fileDone')).toHaveLength(1);
  });

  it('plays the sbobina audio in the editor after a reload, and lets the user replace, remove or delete it', async () => {
    mockGemini();
    const first = host();
    const [queued] = await first.api.upload_browser_files!([lecture()]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await first.finished();
    const [done] = first.named('fileDone') as Array<{ session_dir: string }>;
    const [session] = (await first.api.get_completed_sessions!()).sessions!;
    expect(session.input_path).toBe(queued.path);

    // The queue is emptied and the page reloaded: the copy now belongs to the sbobina.
    localStorage.setItem(STORAGE_KEYS.QUEUE_V1, '[]');
    const second = reload();
    const streamed = await second.api.stream_media_file!(session.input_path, done.session_dir);
    expect(streamed).toEqual({ ok: true, url: 'blob:test/1' });
    const blob = urls.get(streamed.url!)!;
    expect(blob.type).toBe('audio/mpeg');
    expect(await blob.text()).toBe('audio della lezione');

    // "Ricollega audio" with another file: it replaces the copy; the old URL is released.
    pickNextFile(lecture('Registrazione.m4a', 'nuovo audio'));
    const picked = await second.api.ask_media_file!();
    expect(await second.api.update_session_input_path!(done.session_dir, picked!.path!)).toEqual({ ok: true });
    expect((await second.api.get_completed_sessions!()).sessions![0]).toMatchObject({ input_path: picked!.path, input_name: 'Registrazione.m4a' });
    const replaced = await reload().api.stream_media_file!(picked!.path!, done.session_dir);
    expect(await urls.get(replaced.url!)!.text()).toBe('nuovo audio');
    expect(urls.get(replaced.url!)!.type).toBe('audio/mp4');

    const third = reload();
    expect(await third.api.remove_session_audio!(done.session_dir)).toEqual({ ok: true, name: session.name });
    expect((await third.api.get_completed_sessions!()).sessions![0].input_path).toBe('');
    // No audio linked: the editor offers "Aggiungi audio", not a relink.
    expect(await third.api.stream_media_file!('', done.session_dir)).toMatchObject({ ok: false, has_audio: false });
    expect(await createWebMediaStore(database).forSession(done.session_dir)).toBeNull();

    pickNextFile(lecture('Aggiunto.mp3', 'audio aggiunto'));
    const added = await third.api.ask_media_file!();
    expect(await third.api.update_session_input_path!(done.session_dir, added!.path!)).toEqual({ ok: true });
    expect(await third.api.delete_session!(done.session_dir)).toEqual({ ok: true });
    expect(await createWebMediaStore(database).has(added!.id)).toBe(false);
  });

  it('asks to relink when the sbobina points to audio this browser no longer has', async () => {
    const { api } = host();
    expect(await api.stream_media_file!('local://gone/Lezione.mp3', 'web-session://x')).toMatchObject({ ok: false, has_audio: true });
  });

  it('keeps working when the browser is out of space, and says what it means', async () => {
    const quota = new DOMException('quota', 'QuotaExceededError');
    const full = { ...createWebMediaStore(database), save: vi.fn(async () => { throw quota; }) };
    mockGemini();
    const { api, named, finished } = host(full);
    const [queued] = await api.upload_browser_files!([lecture()]);

    await vi.waitFor(() => expect(named('appendConsole')).toContainEqual(expect.stringContaining('Spazio del browser esaurito: Fisiologia.mp3 non è stato salvato')));
    expect(await api.start_processing!([queued], KEY, true, 'gemini-2.5-flash')).toEqual({ ok: true });
    await finished();
    expect(named('fileDone')).toHaveLength(1);
    // The player still works in this page; after a reload the editor will ask for the file.
    const [done] = named('fileDone') as Array<{ session_dir: string }>;
    expect(await api.stream_media_file!(queued.path!, done.session_dir)).toMatchObject({ ok: true });
    expect(await reload(full).api.stream_media_file!(queued.path!, done.session_dir)).toMatchObject({ ok: false, has_audio: true });
  });

  it('forgets copies of files no longer in the queue when the page opens', async () => {
    const media = createWebMediaStore(database);
    await media.save('kept', lecture(), 0);
    await media.save('removed', lecture(), 0);
    localStorage.setItem(STORAGE_KEYS.QUEUE_V1, JSON.stringify([{ id: 'kept', path: 'local://kept/Fisiologia.mp3' }]));

    host();
    await vi.waitFor(async () => expect(await media.has('removed')).toBe(false));
    expect(await media.has('kept')).toBe(true);
  });
});

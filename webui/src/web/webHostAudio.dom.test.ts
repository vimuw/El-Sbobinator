import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import type { BridgeEventName } from './fakePipeline';
import { CancelledError } from './pipeline/retry';
import type { AudioSource } from './pipeline/run';
import { forgetWebFiles } from './webFiles';
import { createWebPywebviewApi } from './webHost';
import { measureWebStorage } from './webDatabase';
import { createWebMediaStore, type WebMediaStore } from './webMedia';
import { createWebArchive } from './webSessions';

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

  it('drops the temporary copy when the sbobina is done: the editor plays the file in this page, after a reload it asks for it', async () => {
    mockGemini();
    const first = host();
    const [queued] = await first.api.upload_browser_files!([lecture()]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await first.finished();
    const [done] = first.named('fileDone') as Array<{ session_dir: string }>;
    const [session] = (await first.api.get_completed_sessions!()).sessions!;
    expect(session.input_path).toBe(queued.path);
    const media = createWebMediaStore(database);
    expect(await media.has(queued.id)).toBe(false);
    expect(await media.forSession(done.session_dir)).toBeNull();

    const streamed = await first.api.stream_media_file!(session.input_path, done.session_dir);
    expect(streamed).toMatchObject({ ok: true, url: 'blob:test/1' });
    expect(urls.get(streamed.url!)!.type).toBe('audio/mpeg');
    expect(await urls.get(streamed.url!)!.text()).toBe('audio della lezione');

    expect(await reload().api.stream_media_file!(session.input_path, done.session_dir)).toMatchObject({ ok: false, has_audio: true });
  });

  it('plays a file chosen in the editor without copying it, and warns when it is not the lecture', async () => {
    mockGemini();
    const first = host();
    const [queued] = await first.api.upload_browser_files!([lecture()]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await first.finished();
    const [done] = first.named('fileDone') as Array<{ session_dir: string }>;
    const [session] = (await first.api.get_completed_sessions!()).sessions!;
    localStorage.setItem(STORAGE_KEYS.QUEUE_V1, '[]');
    const second = reload();
    expect(await second.api.stream_media_file!(session.input_path, done.session_dir)).toMatchObject({ ok: false, has_audio: true });
    const media = createWebMediaStore(database);

    // The same lecture, renamed on this device: no warning, no copy in the browser.
    pickNextFile(lecture('Fisiologia lezione 3.mp3'));
    const same = await second.api.ask_editor_media_file!();
    expect(await second.api.update_session_input_path!(done.session_dir, same!.path!)).toEqual({ ok: true });
    expect(await media.has(same!.id)).toBe(false);
    expect((await second.api.get_completed_sessions!()).sessions![0]).toMatchObject({ input_path: same!.path, input_name: 'Fisiologia lezione 3.mp3', input_identity: session.input_identity });
    const streamed = await second.api.stream_media_file!(same!.path!, done.session_dir);
    expect(await urls.get(streamed.url!)!.text()).toBe('audio della lezione');

    // Another file is still used, with a warning; the lecture identity stays the original one.
    pickNextFile(lecture('Registrazione.m4a', 'nuovo audio'));
    const other = await second.api.ask_editor_media_file!();
    expect(await second.api.update_session_input_path!(done.session_dir, other!.path!)).toEqual({
      ok: true,
      warning: 'Sembra un file diverso dalla lezione originale: i tempi dell’audio potrebbero non corrispondere.',
    });
    const replaced = await second.api.stream_media_file!(other!.path!, done.session_dir);
    expect(await urls.get(replaced.url!)!.text()).toBe('nuovo audio');
    expect(urls.get(replaced.url!)!.type).toBe('audio/mp4');
    expect((await second.api.get_completed_sessions!()).sessions![0].input_identity).toEqual(session.input_identity);

    // Nothing was kept: after a reload the editor asks again.
    expect(await reload().api.stream_media_file!(other!.path!, done.session_dir)).toMatchObject({ ok: false, has_audio: true });
    expect(await second.api.update_session_input_path!(done.session_dir, 'local://gone/Lezione.mp3')).toMatchObject({ ok: false });
  });

  it('keeps the audio in this browser on request, replaces it with a new file and lets it go', async () => {
    mockGemini();
    const first = host();
    const [queued] = await first.api.upload_browser_files!([lecture()]);
    await first.api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await first.finished();
    const [done] = first.named('fileDone') as Array<{ session_dir: string }>;
    const [session] = (await first.api.get_completed_sessions!()).sessions!;
    const media = createWebMediaStore(database);
    expect(await first.api.stream_media_file!(session.input_path, done.session_dir)).toMatchObject({ ok: true, audio_kept: false, audio_size: 19 });

    expect(await first.api.set_session_audio_kept!(done.session_dir, true)).toEqual({ ok: true, audio_kept: true });
    expect(await first.api.set_session_audio_kept!(done.session_dir, true)).toEqual({ ok: true, audio_kept: true });
    expect(await (await media.forSession(done.session_dir))!.text()).toBe('audio della lezione');
    localStorage.setItem(STORAGE_KEYS.QUEUE_V1, '[]');

    // After a reload the kept copy plays; a new file replaces it instead of adding a second one.
    const second = reload();
    expect(await second.api.stream_media_file!(session.input_path, done.session_dir)).toMatchObject({ ok: true, audio_kept: true, audio_size: 19 });
    pickNextFile(lecture('Registrazione.m4a', 'nuovo audio'));
    const other = await second.api.ask_editor_media_file!();
    expect(await second.api.update_session_input_path!(done.session_dir, other!.path!)).toMatchObject({ ok: true, warning: expect.any(String) });
    const third = reload();
    const replaced = await third.api.stream_media_file!(other!.path!, done.session_dir);
    expect(replaced).toMatchObject({ ok: true, audio_kept: true });
    expect(await urls.get(replaced.url!)!.text()).toBe('nuovo audio');
    expect(await measureWebStorage(database)).toMatchObject({ audio: 11, queueAudio: 0 });

    // Off: the copy goes, the lecture's name and identity stay for the next file picked.
    expect(await third.api.set_session_audio_kept!(done.session_dir, false)).toEqual({ ok: true, audio_kept: false });
    expect(await media.forSession(done.session_dir)).toBeNull();
    expect((await third.api.get_completed_sessions!()).sessions![0]).toMatchObject({ input_name: 'Registrazione.m4a', input_identity: session.input_identity });
    expect(await reload().api.stream_media_file!(other!.path!, done.session_dir)).toMatchObject({ ok: false, has_audio: true });
    // Nothing to copy without the file in this page.
    expect(await reload().api.set_session_audio_kept!(done.session_dir, true)).toEqual({ ok: false, error: 'Scegli prima il file audio della lezione.' });
    expect(await third.api.set_session_audio_kept!('web-session://gone', true)).toEqual({ ok: false, error: 'Sbobina non trovata.' });
  });

  it('says when the browser has no space to keep the audio', async () => {
    mockGemini();
    const quota = new DOMException('quota', 'QuotaExceededError');
    const store = createWebMediaStore(database);
    let full = false;
    const media = { ...store, save: vi.fn(async (id: string, file: File) => { if (full) throw quota; await store.save(id, file); }) };
    const { api, finished, named } = host(media);
    const [queued] = await api.upload_browser_files!([lecture()]);
    await api.start_processing!([queued], KEY, true, 'gemini-2.5-flash');
    await finished();
    const [done] = named('fileDone') as Array<{ session_dir: string }>;
    full = true;
    const result = await api.set_session_audio_kept!(done.session_dir, true);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Spazio') });
    expect(await store.forSession(done.session_dir)).toBeNull();
  });

  it('keeps the audio web-v1.0.0 linked to a sbobina, shown as kept', async () => {
    const archive = createWebArchive(database);
    const media = createWebMediaStore(database);
    const old = await archive.create({ name: 'Vecchia', completed_at_iso: '2026-10-26T10:00:00Z', effective_model: 'gemini-2.5-flash', input_path: 'local://v1/Vecchia.mp3', input_name: 'Vecchia.mp3' }, '<p>x</p>');
    await media.save('v1', lecture('Vecchia.mp3', 'audio v1'), 0);
    await media.link('v1', old.session_dir);
    localStorage.setItem(STORAGE_KEYS.QUEUE_V1, '[]');

    // Opening the page prunes the queue copies, never this one.
    const { api } = host();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(await api.stream_media_file!(old.input_path, old.session_dir)).toMatchObject({ ok: true, audio_kept: true, audio_size: 8 });
    // With no recorded identity, any file picked is used without a warning.
    pickNextFile(lecture('Altro.mp3', 'altro'));
    const picked = await api.ask_editor_media_file!();
    expect(await api.update_session_input_path!(old.session_dir, picked!.path!)).toEqual({ ok: true });
    expect(await (await media.forSession(old.session_dir))!.text()).toBe('altro');
  });

  it('refuses an unsupported file for the editor', async () => {
    const { api, named } = host();
    pickNextFile(lecture('Lezione.wav'));
    expect(await api.ask_editor_media_file!()).toBeNull();
    await vi.waitFor(() => expect(named('appendConsole')).toContainEqual(expect.stringContaining('Formato non supportato nella versione web: Lezione.wav')));
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

    await vi.waitFor(() => expect(named('appendConsole')).toContainEqual(expect.stringContaining('Spazio del browser esaurito: non è stato possibile tenere una copia temporanea di Fisiologia.mp3')));
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

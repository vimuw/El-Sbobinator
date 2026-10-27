import { IDBFactory } from 'fake-indexeddb';
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, getHostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { STORAGE_KEYS } from '../storageKeys';
import type { BridgeEventName } from './fakePipeline';
import { createApiUsageStore } from './apiUsage';
import { createBridgeEmitter, createWebPywebviewApi, initWebHost } from './webHost';

function recorder() {
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  return { events, emit: (name: BridgeEventName, payload?: unknown) => { events.push({ name, payload }); } };
}

beforeEach(() => {
  // The host copies picked files into fake-indexeddb, whose structuredClone keeps Node files, not jsdom's.
  vi.stubGlobal('File', NodeFile);
  vi.stubGlobal('Blob', NodeBlob);
  localStorage.clear();
  vi.stubGlobal('indexedDB', new IDBFactory());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setHostCapabilities(DESKTOP_CAPABILITIES);
  delete window.pywebview;
  window.elSbobinatorBridge = null;
  delete document.documentElement.dataset.host;
});

describe('web host', () => {
  it('get_api_usage: the desktop panel data from this browser, probing the main key only on Verifica connessione', async () => {
    const values = new Map<string, string>();
    const usage = createApiUsageStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { status: 'UNAUTHENTICATED', message: 'API key not valid.' } }), { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    localStorage.setItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, 'AIzaSyPrimary1234567890123\nAIzaSyReserve1234567890456');
    const api = createWebPywebviewApi(() => {}, { database: new IDBFactory(), usage });

    const plain = await api.get_api_usage!();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(plain.result?.credentials?.map(c => [c.label, c.masked_key, c.operational_status])).toEqual([
      ['Chiave Principale', 'AIzaSy...0123', 'unused'],
      ['Chiave Riserva 1', 'AIzaSy...0456', 'unused'],
    ]);

    const checked = await api.get_api_usage!('AIzaSyPrimary1234567890123', ['AIzaSyReserve1234567890456'], 'gemini-3.6-flash', true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash');
    expect(url).not.toContain('AIza');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaSyPrimary1234567890123');
    expect(checked.result?.credentials?.[0]).toMatchObject({ operational_status: 'invalid', last_error_code: 401 });
    expect(checked.result?.credentials?.[1].operational_status).toBe('unused');
  });

  it('installs the in-page API with web capabilities and announces it', () => {
    const onReady = vi.fn();
    window.addEventListener('pywebviewready', onReady, { once: true });

    initWebHost();

    expect(onReady).toHaveBeenCalledTimes(1);
    // The touch sizing in index.css applies to the web build only.
    expect(document.documentElement.dataset.host).toBe('web');
    const capabilities = getHostCapabilities();
    expect(capabilities).toMatchObject({
      kind: 'web', keyStorage: 'browser', openLocalPath: false, nativeFolderPicker: false,
      updateInstallation: false, osNotifications: false, editorAudio: true, sessionKeepsAudio: false, sbobinaPackages: false, environmentCheck: false,
    });
    const api = window.pywebview?.api;
    expect(api?.start_processing).toBeTypeOf('function');
    // Hidden features have no method, so the UI never offers them.
    expect(api?.open_file).toBeUndefined();
    expect(api?.stream_media_file).toBeTypeOf('function');
    expect(api?.export_sbobina_package).toBeUndefined();
    expect(api?.download_and_install_update).toBeUndefined();
    expect(api?.export_diagnostics).toBeUndefined();
  });

  it('keeps keys one per line in localStorage and never validates them online', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const api = createWebPywebviewApi(recorder().emit);

    await api.save_settings!(' AIzaSyMain12345678901234567 ', ['AIzaSyBackup1234567890123456', ''], 'gemini-2.5-flash');
    expect(localStorage.getItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1)).toBe('AIzaSyMain12345678901234567\nAIzaSyBackup1234567890123456');
    expect(await api.load_settings!()).toMatchObject({
      api_key: 'AIzaSyMain12345678901234567',
      fallback_keys: ['AIzaSyBackup1234567890123456'],
      preferred_model: 'gemini-2.5-flash',
      has_protected_key: false,
    });

    // null keeps what is saved, like the desktop contract.
    await api.save_settings!(null, null, 'gemini-3.8-flash');
    expect((await api.load_settings!()).fallback_keys).toEqual(['AIzaSyBackup1234567890123456']);

    expect((await api.validate_environment!('not-a-key')).result?.ok).toBe(false);
    expect((await api.validate_environment!('AIzaSyMain12345678901234567')).result?.ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();

    await api.save_settings!('', [], 'gemini-3.8-flash');
    expect(localStorage.getItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1)).toBeNull();
    fetchSpy.mockRestore();
  });

  it('accepts only MP3, M4A and MP4 and keeps the file in the page', async () => {
    const { events, emit } = recorder();
    const api = createWebPywebviewApi(emit);

    const accepted = await api.upload_browser_files!([
      new File(['a'], 'lezione.mp3'), new File(['b'], 'note.wav'), new File(['c'], 'video.MP4'),
    ]);

    expect(accepted.map(file => file.name)).toEqual(['lezione.mp3', 'video.MP4']);
    expect(accepted[0].path).toMatch(/^local:\/\/[^/]+\/lezione\.mp3$/);
    expect(events).toEqual([{ name: 'appendConsole', payload: expect.stringContaining('note.wav') }]);
    expect(await api.check_path_exists!(accepted[0].path!)).toEqual({ ok: true, exists: true });
    // After a reload the queue still points at the old path: the UI asks for the file again.
    expect(await api.check_path_exists!('local://gone/lezione.mp3')).toEqual({ ok: true, exists: false });
  });

  it("counts the space from what it stored, since Safari's estimate leaves out the audio", async () => {
    const { emit } = recorder();
    // iPad Safari: 27 MB of audio in IndexedDB, estimate() said 1.1 MB.
    const storage = { persisted: async () => false, estimate: async () => ({ usage: 1024 }) } as unknown as StorageManager;
    const api = createWebPywebviewApi(emit, { storage });
    const [file] = await api.upload_browser_files!([new File([new Uint8Array(3 * 1024 * 1024)], 'Lezione.mp3')]);
    await vi.waitFor(async () => expect((await api.check_path_exists!(file.path!)).exists).toBe(true));

    const info = await api.get_session_storage_info!();
    expect(info.total_bytes).toBeGreaterThanOrEqual(3 * 1024 * 1024);
    // A picked file not yet sbobinato is a queue copy: the backup would not include it.
    expect(info.usage_detail).toBe('Testi delle sbobine 0 KB · audio delle sbobine 0 KB · audio in coda 3,0 MB · avanzamento elaborazioni 0 KB · stima del browser 1 KB');
    const { report } = await api.get_diagnostic_report!();
    expect(report).toContain('- Spazio usato: Testi delle sbobine 0 KB · audio delle sbobine 0 KB · audio in coda 3,0 MB · avanzamento elaborazioni 0 KB · stima del browser 1 KB');
  });

  it('runs the simulated pipeline into an archived document the editor can open and save', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { events, emit } = recorder();
    const persist = vi.fn(async () => true);
    const storage = { persist, persisted: async () => persist.mock.calls.length > 0, estimate: async () => ({ usage: 4096 }) } as unknown as StorageManager;
    const api = createWebPywebviewApi(emit, { simulation: true, storage });
    expect(await api.get_session_storage_info!()).toEqual({
      ok: true, total_bytes: 0, total_sessions: 0, session_root: expect.stringContaining('il browser può svuotarla'),
      usage_detail: 'Testi delle sbobine 0 KB · audio delle sbobine 0 KB · avanzamento elaborazioni 0 KB · stima del browser 4 KB', persisted: false,
    });
    const [file] = await api.upload_browser_files!([new File(['a'], 'Anatomia.m4a')]);

    expect(await api.start_processing!([file], '', true, 'gemini-3.6-flash')).toMatchObject({ ok: false });
    expect(await api.start_processing!([file], 'AIzaSyMain12345678901234567', true, 'gemini-3.6-flash')).toEqual({ ok: true });
    expect(await api.start_processing!([file], 'AIzaSyMain12345678901234567', true, 'gemini-3.6-flash')).toMatchObject({ ok: false });
    expect((await api.is_processing_active!()).active).toBe(true);
    await vi.runAllTimersAsync();

    await vi.waitFor(async () => expect((await api.is_processing_active!()).active).toBe(false));
    // The first saved sbobina asks the browser to keep the site's data.
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await api.get_session_storage_info!()).toMatchObject({ total_sessions: 1, session_root: expect.stringContaining('protetta'), persisted: true });
    expect(await api.get_storage_protection!()).toEqual({ ok: true, persisted: true });
    const done = events.find(event => event.name === 'fileDone')?.payload as { html_path: string; session_dir: string };
    const { sessions } = await api.get_completed_sessions!();
    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({ name: 'Anatomia', input_name: 'Anatomia.m4a', session_dir: done.session_dir });

    const read = await api.read_html_content!(done.html_path);
    expect(read.content).toMatch(/^<!doctype html>.*<body><h1>Anatomia<\/h1>/s);

    expect(await api.save_html_content!(done.html_path, '<p>Modificato</p>', 2)).toEqual({ ok: true, saved: true });
    expect(await api.save_html_content!(done.html_path, '<p>Vecchio</p>', 1)).toEqual({ ok: true, saved: false });
    expect((await api.read_html_content!(done.html_path)).content).toContain('<p>Modificato</p>');
    expect((await api.search_sessions!('modificato')).results?.[0]).toMatchObject({ session_dir: done.session_dir, match_count: 1 });

    expect((await api.rename_session!(done.session_dir, ' Anatomia 1 ')).name).toBe('Anatomia 1');
    expect(await api.delete_session!(done.session_dir)).toEqual({ ok: true });
    expect((await api.get_completed_sessions!()).sessions).toEqual([]);
  });

  it('stops the simulated run on request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { events, emit } = recorder();
    const api = createWebPywebviewApi(emit, { simulation: true });
    const [file] = await api.upload_browser_files!([new File(['a'], 'a.mp3')]);
    await api.start_processing!([file], 'AIzaSyMain12345678901234567', true, 'gemini-3.6-flash');
    await vi.advanceTimersByTimeAsync(700);

    await api.stop_processing!();
    await vi.runAllTimersAsync();

    expect(events.at(-1)).toEqual({ name: 'processDone', payload: expect.objectContaining({ cancelled: true }) });
    expect((await api.get_completed_sessions!()).sessions).toEqual([]);
  });

  it('delivers events in order once the UI has registered its callbacks', async () => {
    vi.useFakeTimers();
    const received: string[] = [];
    let bridge: Window['elSbobinatorBridge'] = null;
    const emit = createBridgeEmitter(() => bridge);

    emit('updatePhase', 'uno');
    emit('updatePhase', 'due');
    await vi.advanceTimersByTimeAsync(30);
    expect(received).toEqual([]);

    bridge = { updatePhase: (text: string) => received.push(text) } as unknown as Window['elSbobinatorBridge'];
    await vi.advanceTimersByTimeAsync(30);
    expect(received).toEqual(['uno', 'due']);
  });
});

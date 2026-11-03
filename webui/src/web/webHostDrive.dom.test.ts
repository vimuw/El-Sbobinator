import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEventName } from './fakePipeline';
import { createDriveApi } from './drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './drive/fakeDrive';
import { readRecords } from './drive/syncState';
import { createBackup } from './webBackup';
import { createWebPywebviewApi } from './webHost';
import { createWebArchive, webSessionHtmlPath } from './webSessions';

// The web host with the Drive sync of previews: two "devices" on the same fake Drive, and the host
// without it (the released site), which must not change at all.

const input = { name: 'Fisiologia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' };

function host(drive: FakeDrive | null, device = 'pc', tab: { factory?: IDBFactory; token?: boolean } = {}) {
  const factory = tab.factory ?? new IDBFactory();
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  const emit = (name: BridgeEventName, payload?: unknown) => { events.push({ name, payload }); };
  const login = createFakeAuth(device, { token: tab.token ?? true, email: 'studente@example.com' });
  const connection = drive && { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} }) };
  const api = createWebPywebviewApi(emit, { database: factory, drive: connection, driveDelayMs: 20 });
  const body = async (sessionDir: string) => (await api.read_html_content!(webSessionHtmlPath(sessionDir))).content?.match(/<body>([\s\S]*)<\/body>/)?.[1];
  const named = (name: BridgeEventName) => events.filter(event => event.name === name);
  return { factory, api, events, named, body };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('web host with Drive sync', () => {
  it('has no Drive methods and leaves no sync marks in builds without a client ID', async () => {
    const plain = host(null);
    const session = await createWebArchive(plain.factory).create(input, '<p>uno</p>');
    await plain.api.rename_session!(session.session_dir, 'Fisiologia 2');
    await plain.api.save_html_content!(session.html_path, '<p>due</p>', 1);
    expect(plain.api.get_drive_status).toBeUndefined();
    expect(plain.api.connect_drive).toBeUndefined();
    expect(plain.api.release_html_content).toBeUndefined();
    expect((await readRecords(plain.factory)).size).toBe(0);
  });

  it('brings a change from another device, holding it back while the editor has the sbobina open', async () => {
    const drive = createFakeDrive();
    const pc = host(drive, 'pc');
    const ipad = host(drive, 'ipad');
    const session = await createWebArchive(pc.factory).create(input, '<p>uno</p>');
    expect(await pc.api.sync_drive_now!()).toMatchObject({ connected: true, error: null });
    await ipad.api.sync_drive_now!();
    expect(await ipad.body(session.session_dir)).toBe('<p>uno</p>');
    expect(ipad.named('archiveChangedRemotely')).toHaveLength(1);

    // The iPad opens the editor (read_html_content), then the PC edits and syncs.
    expect(await ipad.body(session.session_dir)).toBe('<p>uno</p>');
    await pc.api.save_html_content!(session.html_path, '<p>due</p>', 1);
    await pc.api.sync_drive_now!();
    await ipad.api.sync_drive_now!();
    expect(ipad.named('documentChangedElsewhere').map(event => event.payload)).toEqual([{ session_dir: session.session_dir }]);
    expect(await ipad.body(session.session_dir)).toBe('<p>uno</p>');

    // Closing the editor lets it in, a moment later.
    await ipad.api.release_html_content!(session.html_path);
    await vi.waitFor(() => expect(ipad.named('archiveChangedRemotely')).toHaveLength(2));
    expect(await ipad.body(session.session_dir)).toBe('<p>due</p>');
  });

  it('sends an edit made in the editor a few moments after it is saved', async () => {
    const drive = createFakeDrive();
    const pc = host(drive);
    const session = await createWebArchive(pc.factory).create(input, '<p>uno</p>');
    await pc.api.sync_drive_now!();
    await pc.api.save_html_content!(session.html_path, '<p>modificato</p>', 1);
    await vi.waitFor(() => expect(drive.files()[0].content).toMatchObject({ body: '<p>modificato</p>' }));
  });
});

describe('web host editor saves after the stored text changed', () => {
  const stored = async (factory: IDBFactory, htmlPath: string) => (await createWebArchive(factory).readHtml(htmlPath))?.match(/<body>([\s\S]*)<\/body>/)?.[1];

  it('keeps a change from Drive written just as the editor opened, and saves the editor text as a conflict copy', async () => {
    // Regression: the round checks the editor before writing; one opened in between read the old
    // text, and its next autosave overwrote Drive's change everywhere, without a conflict copy.
    const drive = createFakeDrive();
    const ipad = host(drive, 'ipad');
    const session = await createWebArchive(ipad.factory).create(input, '<p>uno</p>');
    await ipad.api.sync_drive_now!();
    expect(await ipad.body(session.session_dir)).toBe('<p>uno</p>');
    // Drive's text lands after the editor read the old one (the sync writes IndexedDB directly).
    await createWebArchive(ipad.factory).saveHtml(session.html_path, '<p>due dal PC</p>');

    expect(await ipad.api.save_html_content!(session.html_path, '<p>uno!</p>', Date.now())).toEqual({ ok: true, saved: true });
    expect(await stored(ipad.factory, session.html_path)).toBe('<p>due dal PC</p>');
    const copies = (await ipad.api.get_completed_sessions!()).sessions!.filter(item => item.session_dir !== session.session_dir);
    expect(copies.map(item => item.name)).toEqual(['Fisiologia (conflitto)']);
    expect(await stored(ipad.factory, copies[0].html_path)).toBe('<p>uno!</p>');
    expect(ipad.named('documentChangedElsewhere').map(event => event.payload)).toEqual([{ session_dir: session.session_dir }]);

    // The editor's next saves go to the copy too, until the sbobina is opened again.
    await ipad.api.save_html_content!(session.html_path, '<p>uno!!</p>', Date.now() + 1);
    expect(await stored(ipad.factory, session.html_path)).toBe('<p>due dal PC</p>');
    expect(await stored(ipad.factory, copies[0].html_path)).toBe('<p>uno!!</p>');
    expect(await ipad.body(session.session_dir)).toBe('<p>due dal PC</p>');
    await ipad.api.save_html_content!(session.html_path, '<p>tre</p>', Date.now() + 2);
    expect(await stored(ipad.factory, session.html_path)).toBe('<p>tre</p>');
    expect((await ipad.api.get_completed_sessions!()).sessions).toHaveLength(2);
  });

  it('takes the editor own saves in flight for its text, without conflict copies', async () => {
    const plain = host(null);
    const session = await createWebArchive(plain.factory).create(input, '<p>uno</p>');
    await plain.body(session.session_dir);
    const at = Date.now();
    await Promise.all([
      plain.api.save_html_content!(session.html_path, '<p>a</p>', at),
      plain.api.save_html_content!(session.html_path, '<p>ab</p>', at + 1),
    ]);
    await plain.api.save_html_content!(session.html_path, '<p>abc</p>', at + 2);
    expect(await stored(plain.factory, session.html_path)).toBe('<p>abc</p>');
    expect((await plain.api.get_completed_sessions!()).sessions).toHaveLength(1);
    expect(plain.named('documentChangedElsewhere')).toEqual([]);
  });

  it('keeps the text of a backup imported while the editor has the sbobina open', async () => {
    // Regression: the import replaced the text, the editor's next autosave wrote its older one back.
    const source = new IDBFactory();
    const session = await createWebArchive(source).create(input, '<p>uno</p>');
    const plain = host(null);
    const first = await createBackup(source, { includeAudio: false, appVersion: 'test' });
    await plain.api.import_web_backup!(new File([first.blob], first.filename));
    expect(await plain.body(session.session_dir)).toBe('<p>uno</p>');
    await createWebArchive(source).saveHtml(session.html_path, '<p>dal backup</p>', Date.now());
    const newer = await createBackup(source, { includeAudio: false, appVersion: 'test' });
    expect(await plain.api.import_web_backup!(new File([newer.blob], newer.filename))).toMatchObject({ ok: true, summary: expect.stringContaining('sostituita') });

    await plain.api.save_html_content!(session.html_path, '<p>uno, modificata</p>', Date.now() + 1000);
    expect(await stored(plain.factory, session.html_path)).toBe('<p>dal backup</p>');
    const names = (await plain.api.get_completed_sessions!()).sessions!.map(item => item.name).sort();
    expect(names).toEqual(['Fisiologia', 'Fisiologia (conflitto)']);
  });
});

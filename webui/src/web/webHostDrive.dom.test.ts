import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BridgeEventName } from './fakePipeline';
import { createDriveApi } from './drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './drive/fakeDrive';
import { readRecords } from './drive/syncState';
import { createWebPywebviewApi } from './webHost';
import { createWebArchive, webSessionHtmlPath } from './webSessions';

// The web host with the Drive sync of previews: two "devices" on the same fake Drive, and the host
// without it (the released site), which must not change at all.

const input = { name: 'Fisiologia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' };

function host(drive: FakeDrive | null, device = 'pc') {
  const factory = new IDBFactory();
  const events: Array<{ name: BridgeEventName; payload: unknown }> = [];
  const emit = (name: BridgeEventName, payload?: unknown) => { events.push({ name, payload }); };
  const login = createFakeAuth(device, { token: true, email: 'studente@example.com' });
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

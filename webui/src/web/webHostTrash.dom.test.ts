import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createDriveApi } from './drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './drive/fakeDrive';
import { syncOnce } from './drive/sync';
import { toSessionFile } from './drive/syncFormat';
import { readMeta, readRecords, trackArchive, writeMeta } from './drive/syncState';
import { createBackup } from './webBackup';
import { createWebPywebviewApi } from './webHost';
import { createWebArchive } from './webSessions';

// The trash in the web host: on in the builds with the Drive sync (connected or not), off in the
// released site, where deleting stays permanent.

const input = { name: 'Fisiologia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' };
const DAY_MS = 24 * 60 * 60 * 1000;

const driveApiFor = (drive: FakeDrive, token: string) => createDriveApi({ getToken: () => token, fetchImpl: drive.fetch, sleep: async () => {} });

function host(options: { trash?: boolean; drive?: boolean; factory?: IDBFactory; fake?: FakeDrive } = {}) {
  const factory = options.factory ?? new IDBFactory();
  const drive = options.fake ?? createFakeDrive();
  const login = createFakeAuth('pc');
  const connection = options.drive ? { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} }) } : null;
  const api = createWebPywebviewApi(() => {}, { database: factory, drive: connection, trash: options.trash, driveDelayMs: 60_000 });
  return { factory, api, archive: createWebArchive(factory) };
}

describe('web host trash', () => {
  it('deletes for good and offers no trash in the released site', async () => {
    const plain = host();
    const session = await plain.archive.create(input, '<p>uno</p>');
    expect(plain.api.list_trash).toBeUndefined();
    expect(plain.api.restore_session).toBeUndefined();
    expect(await plain.api.delete_session!(session.session_dir)).toEqual({ ok: true });
    expect(await plain.archive.get(session.session_dir)).toBeNull();
  });

  it('moves a deleted sbobina to the trash, restores it and empties the trash', async () => {
    const web = host({ trash: true });
    const first = await web.archive.create(input, '<p>uno</p>');
    const second = await web.archive.create({ ...input, name: 'Anatomia' }, '<p>due</p>');
    await web.api.delete_session!(first.session_dir);
    await web.api.delete_session!(second.session_dir);

    expect((await web.api.get_completed_sessions!()).sessions).toEqual([]);
    expect((await web.api.search_sessions!('uno')).results).toEqual([]);
    expect((await web.api.list_trash!()).sessions?.map(session => session.name).sort()).toEqual(['Anatomia', 'Fisiologia']);
    // The settings name the trash apart: the backup leaves it out.
    const { usage_breakdown: parts } = await web.api.get_session_storage_info!();
    expect(parts?.find(part => part.label === 'Testi delle sbobine')?.bytes).toBe(0);
    expect(parts?.find(part => part.label === 'Sbobine nel cestino')?.bytes).toBeGreaterThan(0);

    expect(await web.api.restore_session!(first.session_dir)).toEqual({ ok: true });
    expect((await web.api.get_completed_sessions!()).sessions?.map(session => session.name)).toEqual(['Fisiologia']);
    expect(await web.api.restore_session!('web-session://assente')).toMatchObject({ ok: false });

    expect(await web.api.empty_trash!()).toEqual({ ok: true, removed: 1 });
    expect(await web.archive.get(second.session_dir)).toBeNull();
    expect((await web.api.list_trash!()).sessions).toEqual([]);
  });

  it('deletes for good what has been in the trash for more than 30 days', async () => {
    const factory = new IDBFactory();
    const archive = createWebArchive(factory);
    const old = await archive.create(input, '<p>vecchia</p>');
    await archive.trash(old.session_dir, new Date(Date.now() - 31 * DAY_MS).toISOString());
    const web = host({ trash: true, factory });
    expect((await web.api.list_trash!()).sessions).toEqual([]);
    expect(await archive.get(old.session_dir)).toBeNull();
  });

  it('lets a sbobina on Drive expire only after a round, so a restore on another device wins', async () => {
    // Regression: the expiry ran at startup, before any round, and its deletion (newer than the
    // restore) removed on the iPad the sbobina restored there, with its audio.
    const fake = createFakeDrive();
    const pcFactory = new IDBFactory();
    const pc = trackArchive(createWebArchive(pcFactory), pcFactory, () => {});
    const syncPc = () => syncOnce({ factory: pcFactory, api: driveApiFor(fake, 'pc') });
    const ipadFactory = new IDBFactory();
    const ipad = trackArchive(createWebArchive(ipadFactory), ipadFactory, () => {});
    const syncIpad = () => syncOnce({ factory: ipadFactory, api: driveApiFor(fake, 'ipad') });
    const restored = await pc.create(input, '<p>uno</p>');
    await syncPc();
    await syncIpad();
    await pc.trash(restored.session_dir, new Date(Date.now() - 31 * DAY_MS).toISOString());
    await syncPc();
    await syncIpad();
    await ipad.restore(restored.session_dir);
    await syncIpad();
    // Never on Drive: nothing to wait for.
    const local = createWebArchive(pcFactory);
    const unsynced = await local.create({ ...input, name: 'Mai sincronizzata' }, '<p>due</p>');
    await local.trash(unsynced.session_dir, new Date(Date.now() - 31 * DAY_MS).toISOString());

    // The PC opens the app again: Drive linked, a token in this tab.
    const login = createFakeAuth('pc', { token: true, email: 'studente@example.com' });
    const api = createWebPywebviewApi(() => {}, {
      database: pcFactory,
      drive: { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: fake.fetch, sleep: async () => {} }) },
      driveDelayMs: 60_000,
    });
    // Before or after the startup round, the restored sbobina is never deleted here.
    await api.list_trash!();
    expect(await local.get(restored.session_dir)).not.toBeNull();
    await api.sync_drive_now!();
    expect((await api.list_trash!()).sessions).toEqual([]);
    expect((await api.get_completed_sessions!()).sessions?.map(session => session.session_dir)).toEqual([restored.session_dir]);

    expect(await syncIpad()).toMatchObject({ removed: 0, conflicts: 0 });
    expect((await ipad.list()).map(session => session.session_dir)).toEqual([restored.session_dir]);
  });

  it('expires the trash without a token too, and a restore made since on another device still wins', async () => {
    // Regression: with the account remembered but no token in the tab (every new visit) no round
    // ran, and the sbobine on Drive stayed in the trash, with their audio, past the 30 days.
    const fake = createFakeDrive();
    const trashedAt = Date.now() - 31 * DAY_MS;
    let clock = trashedAt;
    const pcFactory = new IDBFactory();
    const pc = trackArchive(createWebArchive(pcFactory), pcFactory, () => {}, () => new Date(clock));
    const syncPc = () => syncOnce({ factory: pcFactory, api: driveApiFor(fake, 'pc') });
    const ipadFactory = new IDBFactory();
    const ipad = trackArchive(createWebArchive(ipadFactory), ipadFactory, () => {}, () => new Date(clock));
    const syncIpad = () => syncOnce({ factory: ipadFactory, api: driveApiFor(fake, 'ipad') });
    const restored = await pc.create(input, '<p>uno</p>');
    const expired = await pc.create({ ...input, name: 'Scaduta' }, '<p>due</p>');
    await syncPc();
    await syncIpad();
    await pc.trash(restored.session_dir, new Date(trashedAt).toISOString());
    await pc.trash(expired.session_dir, new Date(trashedAt).toISOString());
    await syncPc();
    await syncIpad();
    // A day later the iPad restores one; the PC does not know it yet.
    clock = trashedAt + DAY_MS;
    await ipad.restore(restored.session_dir);
    await syncIpad();

    // The PC opens the app again: the account is remembered, the tab has no token.
    const login = createFakeAuth('pc', { email: 'studente@example.com' });
    const api = createWebPywebviewApi(() => {}, {
      database: pcFactory,
      drive: { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: fake.fetch, sleep: async () => {} }) },
      driveDelayMs: 60_000,
    });
    expect((await api.get_drive_status!()).needs_reconnect).toBe(true);
    expect((await api.list_trash!()).sessions).toEqual([]);

    // Once linked again, the restore made on the iPad after the trash wins over the expiry.
    await syncPc();
    expect((await api.get_completed_sessions!()).sessions?.map(session => session.session_dir)).toEqual([restored.session_dir]);
    expect(await syncIpad()).toMatchObject({ removed: 1, conflicts: 0 });
    expect((await ipad.list()).map(session => session.session_dir)).toEqual([restored.session_dir]);
    expect(await ipad.listTrash()).toEqual([]);
  });

  it('is on in the builds with Drive even when the browser is not linked', async () => {
    const web = host({ drive: true });
    const session = await web.archive.create(input, '<p>uno</p>');
    await web.api.delete_session!(session.session_dir);
    expect((await web.api.list_trash!()).sessions).toHaveLength(1);
  });

  it('leaves the trash out of the backup, and an import brings a trashed sbobina back and marks it for Drive', async () => {
    const web = host({ drive: true });
    const session = await web.archive.create(input, '<p>uno</p>');
    const backup = await createBackup(web.factory, { includeAudio: false, appVersion: 'test' });
    expect(backup.sessions).toBe(1);

    await web.api.delete_session!(session.session_dir);
    expect((await createBackup(web.factory, { includeAudio: false, appVersion: 'test' })).sessions).toBe(0);
    const before = (await readRecords(web.factory)).get(session.session_dir)?.updated_at;

    const result = await web.api.import_web_backup!(new File([backup.blob], backup.filename));
    expect(result).toEqual({ ok: true, summary: '1 ripresa dal cestino.' });
    expect((await web.api.get_completed_sessions!()).sessions?.map(item => item.session_dir)).toEqual([session.session_dir]);
    const record = (await readRecords(web.factory)).get(session.session_dir);
    expect(record?.dirty).toBe(true);
    expect(record?.updated_at > (before ?? '')).toBe(true);
  });

  it('marks for Drive the collections an import adds or fills', async () => {
    const web = host({ drive: true });
    const session = await web.archive.create(input, '<p>uno</p>');
    await web.archive.saveFolders([{ id: 'raccolta', name: 'Primo anno', color: '', parent_id: null, session_dirs: [session.session_dir] }]);
    const backup = await createBackup(web.factory, { includeAudio: false, appVersion: 'test' });
    // As if Drive had already synced the collection without the sbobina in it.
    await web.archive.saveFolders([{ id: 'raccolta', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] }]);
    await writeMeta(web.factory, meta => ({ ...meta, folders: { ...meta.folders, file_id: 'raccolte', dirty: false, times: { raccolta: '2026-10-27T08:00:00.000Z' } } }));

    expect(await web.api.import_web_backup!(new File([backup.blob], backup.filename))).toMatchObject({ ok: true });
    const { folders } = await readMeta(web.factory);
    expect(folders.dirty).toBe(true);
    expect(folders.times.raccolta > '2026-10-27T08:00:00.000Z').toBe(true);
  });

  it('does not replace text synced from Drive with an older backup of another device', async () => {
    const pcFactory = new IDBFactory();
    const pcArchive = createWebArchive(pcFactory);
    const session = await pcArchive.create(input, '<p>v0</p>');
    const fake = createFakeDrive();
    const web = host({ drive: true, fake });
    const first = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    await web.api.import_web_backup!(new File([first.blob], first.filename));
    const sync = () => syncOnce({ factory: web.factory, api: driveApiFor(fake, 'web') });
    expect(await sync()).toMatchObject({ uploaded: 1 });
    // Drive then brings a later edit of the iPad: the text changes, the generation here does not.
    const [file] = fake.files();
    await driveApiFor(fake, 'ipad').updateJson(file.id, toSessionFile((await web.archive.get(session.session_dir))!, '<p>v2 da Drive</p>', Date.parse('2026-10-27T10:00:00.000Z'), { updated_at: '2026-10-27T10:00:00.000Z', device_id: 'ipad' }));
    expect(await sync()).toMatchObject({ downloaded: 1, conflicts: 0 });
    const body = async () => (await web.archive.readHtml(session.html_path))?.match(/<body>([\s\S]*)<\/body>/)?.[1];
    expect(await body()).toBe('<p>v2 da Drive</p>');

    await pcArchive.saveHtml(session.html_path, '<p>v1 vecchia</p>', Date.parse('2026-10-26T10:00:00.000Z'));
    const older = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    expect(await web.api.import_web_backup!(new File([older.blob], older.filename))).toMatchObject({ ok: true });
    expect(await body()).toBe('<p>v2 da Drive</p>');
    expect((await readRecords(web.factory)).get(session.session_dir)?.dirty).toBe(false);

    await pcArchive.saveHtml(session.html_path, '<p>v3 nuova</p>', Date.parse('2026-10-28T10:00:00.000Z'));
    const newer = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    await web.api.import_web_backup!(new File([newer.blob], newer.filename));
    expect(await body()).toBe('<p>v3 nuova</p>');
    expect((await readRecords(web.factory)).get(session.session_dir)?.dirty).toBe(true);
  });

  it('imports a later text even after a rename or a move to the trash made here', async () => {
    // Regression: the import compared the backup with the sync mark, which a rename or the trash
    // also moves on, and kept the older text.
    const pcFactory = new IDBFactory();
    const pcArchive = createWebArchive(pcFactory);
    const renamed = await pcArchive.create(input, '<p>v0</p>');
    const trashed = await pcArchive.create({ ...input, name: 'Anatomia' }, '<p>a0</p>');
    const web = host({ drive: true });
    const first = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    await web.api.import_web_backup!(new File([first.blob], first.filename));
    // The other browser (without Drive) edits both texts; this one renames and trashes afterwards.
    const editedAt = Date.now() - 60_000;
    await pcArchive.saveHtml(renamed.html_path, '<p>v1 testo nuovo</p>', editedAt);
    await pcArchive.saveHtml(trashed.html_path, '<p>a1 testo nuovo</p>', editedAt);
    const newer = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    expect(await web.api.rename_session!(renamed.session_dir, 'Fisiologia rinominata')).toMatchObject({ ok: true });
    expect(await web.api.delete_session!(trashed.session_dir)).toEqual({ ok: true });

    await web.api.import_web_backup!(new File([newer.blob], newer.filename));
    const body = async (path: string) => (await web.archive.readHtml(path))?.match(/<body>([\s\S]*)<\/body>/)?.[1];
    expect(await body(renamed.html_path)).toBe('<p>v1 testo nuovo</p>');
    expect(await body(trashed.html_path)).toBe('<p>a1 testo nuovo</p>');
    expect((await web.archive.list()).map(session => session.session_dir).sort()).toEqual([renamed.session_dir, trashed.session_dir].sort());
  });

  it('runs no Drive round during an import, so the imported text and Drive\'s both survive', async () => {
    // Regression: a round between the import's writes and its marks took the imported text for an
    // unchanged copy and wrote Drive's over it, with no conflict copy; the summary said "sostituita".
    const fake = createFakeDrive();
    const pcFactory = new IDBFactory();
    const pc = trackArchive(createWebArchive(pcFactory), pcFactory, () => {});
    const syncPc = () => syncOnce({ factory: pcFactory, api: driveApiFor(fake, 'pc') });
    const session = await pc.create(input, '<p>uno</p>');
    await syncPc();
    const login = createFakeAuth('ipad', { token: true, email: 'studente@example.com' });
    const api = createWebPywebviewApi(() => {}, {
      database: new IDBFactory(),
      drive: { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: fake.fetch, sleep: async () => {} }) },
      driveDelayMs: 60_000,
    });
    await api.sync_drive_now!();
    // The PC makes a backup, then edits again and syncs: Drive has a change the iPad has not merged.
    await pc.saveHtml(session.html_path, '<p>dal backup</p>', 100);
    const backup = await createBackup(pcFactory, { includeAudio: false, appVersion: 'test' });
    await pc.saveHtml(session.html_path, '<p>dopo</p>', 200);
    await syncPc();

    // The import is held while reading the file; a round asked for meanwhile must wait for it.
    const file = new File([backup.blob], backup.filename);
    const slice = file.slice.bind(file);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reading = false;
    file.slice = ((...args: Parameters<Blob['slice']>) => {
      const part = slice(...args);
      if (reading) return part;
      reading = true;
      const read = part.arrayBuffer.bind(part);
      part.arrayBuffer = async () => { await gate; return read(); };
      return part;
    }) as Blob['slice'];
    const lists = () => fake.requests.filter(request => request.method === 'GET' && /\/files\?/.test(request.url)).length;
    const importing = api.import_web_backup!(file);
    await vi.waitFor(() => expect(reading).toBe(true));
    const listed = lists();
    void api.sync_drive_now!();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(lists()).toBe(listed);
    release();
    expect(await importing).toMatchObject({ ok: true, summary: '1 sostituita con la versione più recente del backup.' });

    await api.sync_drive_now!();
    const sessions = (await api.get_completed_sessions!()).sessions ?? [];
    const bodies = await Promise.all(sessions.map(async item => (await api.read_html_content!(item.html_path)).content?.match(/<body>([\s\S]*)<\/body>/)?.[1]));
    expect(bodies.sort()).toEqual(['<p>dal backup</p>', '<p>dopo</p>']);
  });

  it('gives a backup the time of a text synced from Drive, so a browser with an older edit takes it', async () => {
    // Regression: the backup wrote this browser's generation (0 for a text only downloaded) and the
    // other browser, with an older edit of its own, kept that one.
    const synced = new IDBFactory();
    const syncedArchive = createWebArchive(synced);
    const session = await syncedArchive.create(input, '<p>v0</p>');
    const other = host();
    const first = await createBackup(synced, { includeAudio: false, appVersion: 'test' });
    await other.api.import_web_backup!(new File([first.blob], first.filename));
    await other.archive.saveHtml(session.html_path, '<p>v1 su un altro browser</p>', Date.parse('2026-10-27T09:00:00.000Z'));

    const fake = createFakeDrive();
    const sync = () => syncOnce({ factory: synced, api: driveApiFor(fake, 'web') });
    await sync();
    const [file] = fake.files();
    await driveApiFor(fake, 'ipad').updateJson(file.id, toSessionFile(session, '<p>v2 da Drive</p>', Date.parse('2026-10-27T10:00:00.000Z'), { updated_at: '2026-10-27T10:00:00.000Z', device_id: 'ipad' }));
    expect(await sync()).toMatchObject({ downloaded: 1, conflicts: 0 });

    const backup = await createBackup(synced, { includeAudio: false, appVersion: 'test' });
    await other.api.import_web_backup!(new File([backup.blob], backup.filename));
    expect((await other.archive.readHtml(session.html_path))?.match(/<body>([\s\S]*)<\/body>/)?.[1]).toBe('<p>v2 da Drive</p>');
  });

});

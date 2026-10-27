import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createDriveApi } from './drive/driveApi';
import { createFakeAuth, createFakeDrive } from './drive/fakeDrive';
import { readRecords } from './drive/syncState';
import { createBackup } from './webBackup';
import { createWebPywebviewApi } from './webHost';
import { createWebArchive } from './webSessions';

// The trash in the web host: on in the builds with the Drive sync (connected or not), off in the
// released site, where deleting stays permanent.

const input = { name: 'Fisiologia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' };
const DAY_MS = 24 * 60 * 60 * 1000;

function host(options: { trash?: boolean; drive?: boolean; factory?: IDBFactory } = {}) {
  const factory = options.factory ?? new IDBFactory();
  const drive = createFakeDrive();
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

});

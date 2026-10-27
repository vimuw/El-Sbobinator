import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createWebArchive, purgeExpiredTrash, TRASH_DAYS, webSessionHtmlPath, type NewArchiveSession } from '../webSessions';
import { createDriveApi } from './driveApi';
import { createFakeDrive, type FakeDrive } from './fakeDrive';
import { CONFLICT_SUFFIX, syncOnce } from './sync';
import { readRecord, trackArchive } from './syncState';

// The trash across two "devices" (two IndexedDB factories) on the same in-memory Drive: deleted_at
// moves a sbobina to every trash with its text, a restore comes back, and once deleted for good
// Drive keeps a mark without text that no offline device can undo.

let clock = Date.parse('2026-10-27T09:00:00.000Z');
const now = () => new Date((clock += 60_000));
const DAY_MS = 24 * 60 * 60 * 1000;

function device(drive: FakeDrive, token: string) {
  const factory = new IDBFactory();
  const raw = createWebArchive(factory);
  const archive = trackArchive(raw, factory, () => {}, now);
  const api = createDriveApi({ getToken: () => token, fetchImpl: drive.fetch, sleep: async () => {}, random: () => 0 });
  const sync = () => syncOnce({ factory, api, now });
  const body = async (dir: string) => (await raw.readHtml(webSessionHtmlPath(dir)))?.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? null;
  return { factory, raw, archive, sync, body };
}

const input = (name: string): NewArchiveSession => ({
  name,
  completed_at_iso: '2026-10-27T08:00:00.000Z',
  effective_model: 'gemini-2.5-flash',
  input_path: '',
});

async function twoDevices(text = '<p>il nefrone</p>') {
  const drive = createFakeDrive();
  const pc = device(drive, 'pc');
  const ipad = device(drive, 'ipad');
  const session = await pc.archive.create(input('Fisiologia'), text);
  await pc.sync();
  await ipad.sync();
  return { drive, pc, ipad, dir: session.session_dir };
}

describe('Trash in the web archive', () => {
  it('hides a trashed sbobina from the archive and the search, and brings it back on restore', async () => {
    const archive = createWebArchive(new IDBFactory());
    const kept = await archive.create(input('Anatomia'), '<p>il cuore batte</p>');
    const trashed = await archive.create(input('Fisiologia'), '<p>il cuore pompa</p>');
    expect(await archive.trash(trashed.session_dir, '2026-10-27T10:00:00.000Z')).toBe(true);

    expect((await archive.list()).map(session => session.name)).toEqual(['Anatomia']);
    expect((await archive.search('cuore')).map(result => result.session_dir)).toEqual([kept.session_dir]);
    expect(await archive.listTrash()).toMatchObject([{ session_dir: trashed.session_dir, trashed_at: '2026-10-27T10:00:00.000Z' }]);
    // The text stays, ready for a restore.
    expect(await archive.readHtml(trashed.html_path)).toContain('il cuore pompa');

    const restored = await archive.restore(trashed.session_dir);
    expect(restored).not.toHaveProperty('trashed_at');
    expect(await archive.listTrash()).toEqual([]);
    expect(await archive.search('pompa')).toHaveLength(1);
    expect(await archive.trash('web-session://assente', '2026-10-27T10:00:00.000Z')).toBe(false);
  });

  it(`deletes for good only what stayed in the trash more than ${TRASH_DAYS} days`, async () => {
    const archive = createWebArchive(new IDBFactory());
    const old = await archive.create(input('Vecchia'), '<p>a</p>');
    const recent = await archive.create(input('Recente'), '<p>b</p>');
    await archive.trash(old.session_dir, '2026-09-01T10:00:00.000Z');
    await archive.trash(recent.session_dir, '2026-10-20T10:00:00.000Z');

    expect(await purgeExpiredTrash(archive, new Date('2026-10-01T10:00:00.000Z'))).toBe(1);
    expect((await archive.listTrash()).map(session => session.name)).toEqual(['Recente']);
    expect(await archive.get(old.session_dir)).toBeNull();
  });
});

describe('Trash synced through Drive', () => {
  it('moves a sbobina to the other device’s trash with its text, and a restore comes back', async () => {
    const { drive, pc, ipad, dir } = await twoDevices();

    await pc.archive.trash(dir, now().toISOString());
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    const [file] = drive.files();
    expect(file.content).toMatchObject({ deleted_at: expect.any(String), body: '<p>il nefrone</p>' });
    expect(file.content).not.toHaveProperty('purged_at');

    expect(await ipad.sync()).toMatchObject({ downloaded: 1, removed: 0 });
    expect(await ipad.raw.list()).toEqual([]);
    expect(await ipad.raw.listTrash()).toMatchObject([{ session_dir: dir, name: 'Fisiologia' }]);
    expect(await ipad.body(dir)).toBe('<p>il nefrone</p>');

    await ipad.archive.restore(dir);
    expect(await ipad.sync()).toMatchObject({ uploaded: 1 });
    expect(drive.files()[0].content).not.toHaveProperty('deleted_at');
    expect(await pc.sync()).toMatchObject({ downloaded: 1, conflicts: 0 });
    expect((await pc.raw.list()).map(session => session.session_dir)).toEqual([dir]);
    expect(await pc.raw.listTrash()).toEqual([]);
  });

  it('after 30 days leaves on Drive a mark without text, and every device deletes the sbobina', async () => {
    const { drive, pc, ipad, dir } = await twoDevices('<p>dati sensibili</p>');
    await pc.archive.trash(dir, now().toISOString());
    await pc.sync();
    await ipad.sync();

    expect(await purgeExpiredTrash(pc.archive, new Date(clock + (TRASH_DAYS + 1) * DAY_MS))).toBe(1);
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    const [mark] = drive.files();
    expect(mark.content).toMatchObject({ body: '', purged_at: expect.any(String), session: { name: '' } });
    expect(JSON.stringify(mark.content)).not.toContain('Fisiologia');
    expect(JSON.stringify(mark.content)).not.toContain('sensibili');

    expect(await ipad.sync()).toMatchObject({ removed: 1 });
    expect(await ipad.raw.listTrash()).toEqual([]);
    expect(await ipad.raw.get(dir)).toBeNull();
  });

  it('does not let a device offline for the whole month bring a sbobina deleted for good back', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const offline = device(drive, 'tablet');
    const session = await pc.archive.create(input('Biochimica'), '<p>enzimi</p>');
    await pc.sync();
    await offline.sync();
    // The tablet stays offline while the PC trashes the sbobina and, a month later, empties it.
    await pc.archive.trash(session.session_dir, now().toISOString());
    await pc.sync();
    await purgeExpiredTrash(pc.archive, new Date(clock + (TRASH_DAYS + 1) * DAY_MS));
    await pc.sync();

    // Back online with its untouched copy: Drive's mark wins, nothing is uploaded again.
    expect(await offline.sync()).toMatchObject({ removed: 1, uploaded: 0, conflicts: 0 });
    expect(await offline.raw.get(session.session_dir)).toBeNull();
    expect(drive.files()[0].content).toMatchObject({ body: '' });
    expect(await pc.sync()).toMatchObject({ downloaded: 0, uploaded: 0 });
    expect(await pc.raw.get(session.session_dir)).toBeNull();
  });

  it('keeps the edit when a device edits a sbobina another trashed: the older side becomes a copy', async () => {
    const { pc, ipad, dir } = await twoDevices('<p>prima</p>');
    // The PC trashes it, then the iPad (not synced yet) edits it: the edit is newer.
    await pc.archive.trash(dir, now().toISOString());
    await ipad.archive.saveHtml(webSessionHtmlPath(dir), '<p>prima, poi rivista</p>', Date.now());
    await pc.sync();

    expect(await ipad.sync()).toMatchObject({ conflicts: 1 });
    // The edit stays in the archive; the trashed version is a copy in the trash.
    expect((await ipad.raw.list()).map(session => session.session_dir)).toEqual([dir]);
    expect(await ipad.body(dir)).toBe('<p>prima, poi rivista</p>');
    const [copy] = await ipad.raw.listTrash();
    expect(copy.name).toBe(`Fisiologia${CONFLICT_SUFFIX}`);
    expect(await ipad.body(copy.session_dir)).toBe('<p>prima</p>');

    // The PC gets the edit back out of its trash, and the copy in its trash.
    await pc.sync();
    expect((await pc.raw.list()).map(session => session.session_dir)).toEqual([dir]);
    expect((await pc.raw.listTrash()).map(session => session.name)).toEqual([`Fisiologia${CONFLICT_SUFFIX}`]);
  });

  it('keeps the other device’s edit as a copy when the trashing is newer', async () => {
    const { pc, ipad, dir } = await twoDevices('<p>prima</p>');
    await ipad.archive.saveHtml(webSessionHtmlPath(dir), '<p>rivista su iPad</p>', Date.now());
    await pc.archive.trash(dir, now().toISOString());
    await ipad.sync();

    expect(await pc.sync()).toMatchObject({ conflicts: 1 });
    expect((await pc.raw.listTrash()).map(session => session.session_dir)).toEqual([dir]);
    // No text lost: the iPad's edit is a new sbobina in the archive.
    const [copy] = await pc.raw.list();
    expect(copy.name).toBe(`Fisiologia${CONFLICT_SUFFIX}`);
    expect(await pc.body(copy.session_dir)).toBe('<p>rivista su iPad</p>');

    await ipad.sync();
    expect((await ipad.raw.listTrash()).map(session => session.session_dir)).toEqual([dir]);
    expect((await ipad.raw.list()).map(session => session.name)).toEqual([`Fisiologia${CONFLICT_SUFFIX}`]);
  });

  it('sends a sbobina already in the trash when Drive is connected later', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const session = await pc.raw.create(input('Prima del collegamento'), '<p>x</p>');
    await pc.raw.trash(session.session_dir, '2026-10-26T10:00:00.000Z');

    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    expect(drive.files()[0].content).toMatchObject({ deleted_at: '2026-10-26T10:00:00.000Z', body: '<p>x</p>' });
    expect(await readRecord(pc.factory, session.session_dir)).toMatchObject({ dirty: false });
  });
});

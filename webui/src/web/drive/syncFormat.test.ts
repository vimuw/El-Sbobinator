import { describe, expect, it } from 'vitest';
import type { ArchiveSession } from '../../bridge';
import {
  FOLDERS_FORMAT,
  isPurged,
  mergeFolders,
  parseFoldersFile,
  parseSessionFile,
  sameFolderState,
  sessionDirFromFileName,
  sessionFileName,
  toSessionFile,
  type SyncedFolder,
} from './syncFormat';

const uuid = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const dir = `web-session://${uuid}`;
const session: ArchiveSession = {
  session_dir: dir,
  html_path: `${dir}/sbobina.html`,
  name: 'Anatomia 1',
  input_name: 'anatomia.mp3',
  input_path: 'web-file://abc',
  last_opened_at_iso: '2026-10-27T09:00:00.000Z',
  completed_at_iso: '2026-10-27T08:00:00.000Z',
  effective_model: 'gemini-2.5-flash',
  completion_status: 'completed',
  input_identity: { name: 'anatomia.mp3', size: 10, headHash: 'ab' },
};
const meta = { updated_at: '2026-10-27T10:00:00.000Z', device_id: 'pc' };

describe('Drive sync format', () => {
  it('names one file per sbobina after its uuid', () => {
    expect(sessionFileName(dir)).toBe(`sbobina-${uuid}.json`);
    expect(sessionDirFromFileName(`sbobina-${uuid}.json`)).toBe(dir);
    expect(sessionDirFromFileName('raccolte.json')).toBeNull();
    expect(sessionDirFromFileName('sbobina-../../x.json')).toBeNull();
  });

  it('writes the sbobina without the device-local file path and last-opened time', () => {
    const file = toSessionFile(session, '<p>testo</p>', 7, meta);
    expect(file).toEqual({
      format: 'el-sbobinator-sync',
      version: 1,
      session: {
        session_dir: dir,
        name: 'Anatomia 1',
        input_name: 'anatomia.mp3',
        completed_at_iso: '2026-10-27T08:00:00.000Z',
        effective_model: 'gemini-2.5-flash',
        completion_status: 'completed',
        input_identity: { name: 'anatomia.mp3', size: 10, headHash: 'ab' },
      },
      body: '<p>testo</p>',
      generation: 7,
      updated_at: meta.updated_at,
      device_id: 'pc',
    });
    expect(JSON.stringify(file)).not.toContain('web-file://');
    // In the trash the text stays, so the other devices can restore it.
    expect(toSessionFile(session, '<p>testo</p>', 7, { ...meta, deleted_at: meta.updated_at })).toMatchObject({ body: '<p>testo</p>', deleted_at: meta.updated_at });
    // Deleted for good: a mark without text and without the name.
    const purged = toSessionFile(session, '<p>testo</p>', 7, { ...meta, deleted_at: '2026-09-01T10:00:00.000Z', purged_at: meta.updated_at });
    expect(purged).toMatchObject({ body: '', deleted_at: '2026-09-01T10:00:00.000Z', purged_at: meta.updated_at, session: { session_dir: session.session_dir, name: '' } });
    expect(JSON.stringify(purged)).not.toContain(session.name);
    expect(isPurged(purged)).toBe(true);
    expect(isPurged(toSessionFile(session, '<p>testo</p>', 7, { ...meta, deleted_at: meta.updated_at }))).toBe(false);
    // B1–B3 previews marked a deletion with deleted_at and an empty body.
    expect(isPurged({ deleted_at: meta.updated_at, body: '' })).toBe(true);
    expect(parseSessionFile({ ...purged, purged_at: 'mai' }, sessionFileName(session.session_dir))).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSessionFile(purged, sessionFileName(session.session_dir))).toMatchObject({ ok: true, file: { purged_at: meta.updated_at } });
  });

  it('reads back only well-formed files that match their name', () => {
    const file = toSessionFile(session, '<p>testo</p>', 7, meta);
    const name = sessionFileName(dir);
    expect(parseSessionFile(JSON.parse(JSON.stringify(file)), name)).toEqual({ ok: true, file });
    expect(parseSessionFile(file, `sbobina-${'1'.repeat(8)}-1111-1111-1111-${'1'.repeat(12)}.json`)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSessionFile({ ...file, version: 2 }, name)).toEqual({ ok: false, reason: 'newer' });
    expect(parseSessionFile({ ...file, body: 5 }, name)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSessionFile({ ...file, updated_at: 'ieri' }, name)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSessionFile({ ...file, deleted_at: 'mai' }, name)).toEqual({ ok: false, reason: 'invalid' });
    expect(parseSessionFile(null, name)).toEqual({ ok: false, reason: 'invalid' });
    // Unknown fields and wrong types inside the session are dropped.
    const odd = parseSessionFile({ ...file, session: { ...file.session, input_path: 'C:\\x', duration_sec: 'tanto', extra: 1 } }, name);
    expect(odd.ok && odd.file.session).toEqual(file.session);
  });

  it('reads the folder file with its deletion marks', () => {
    const folder: SyncedFolder = { id: 'f1', name: 'Anatomia', color: '', parent_id: null, session_dirs: [dir], updated_at: meta.updated_at };
    const parsed = parseFoldersFile({ format: FOLDERS_FORMAT, version: 1, folders: [folder, { id: 3 }], deleted: { f2: meta.updated_at, f3: 'no' }, updated_at: meta.updated_at, device_id: 'pc' });
    expect(parsed).toEqual({ ok: true, file: { format: FOLDERS_FORMAT, version: 1, folders: [folder], deleted: { f2: meta.updated_at }, updated_at: meta.updated_at, device_id: 'pc' } });
    expect(parseFoldersFile({ format: FOLDERS_FORMAT, version: 3, folders: [] })).toEqual({ ok: false, reason: 'newer' });
    expect(parseFoldersFile({ format: 'x' })).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('folder merge', () => {
  const at = (minute: number) => `2026-10-27T10:${String(minute).padStart(2, '0')}:00.000Z`;
  const folder = (id: string, minute: number, dirs: string[] = [], name = id): SyncedFolder => ({ id, name, color: '', parent_id: null, session_dirs: dirs, updated_at: at(minute) });

  it('keeps the latest edit of each folder and the folders of both sides, local order first', () => {
    const merged = mergeFolders(
      { folders: [folder('b', 5, [], 'B locale'), folder('a', 1)], deleted: {} },
      { folders: [folder('a', 2, [], 'A remota'), folder('b', 3), folder('c', 1)], deleted: {} },
    );
    expect(merged.folders.map(item => [item.id, item.name])).toEqual([['b', 'B locale'], ['a', 'A remota'], ['c', 'c']]);
  });

  it('removes a folder deleted after its last edit, and brings back one edited after its removal', () => {
    const merged = mergeFolders(
      { folders: [folder('a', 1), folder('b', 9)], deleted: {} },
      { folders: [], deleted: { a: at(2), b: at(4) } },
    );
    expect(merged.folders.map(item => item.id)).toEqual(['b']);
    expect(merged.deleted).toEqual({ a: at(2) });
  });

  it('files a sbobina only in the folder changed last', () => {
    const merged = mergeFolders(
      { folders: [folder('a', 1, ['x', 'y'])], deleted: {} },
      { folders: [folder('b', 2, ['x'])], deleted: {} },
    );
    expect(merged.folders.map(item => [item.id, item.session_dirs])).toEqual([['a', ['y']], ['b', ['x']]]);
  });

  it('compares trees regardless of order', () => {
    const one = { folders: [folder('a', 1), folder('b', 1)], deleted: { c: at(1), d: at(2) } };
    const two = { folders: [folder('b', 1), folder('a', 1)], deleted: { d: at(2), c: at(1) } };
    expect(sameFolderState(one, two)).toBe(true);
    expect(sameFolderState(one, { ...two, deleted: {} })).toBe(false);
  });
});

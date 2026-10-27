import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createWebArchive, webSessionHtmlPath, type NewArchiveSession } from '../webSessions';
import { createDriveApi } from './driveApi';
import { createFakeDrive, type FakeDrive } from './fakeDrive';
import { CONFLICT_SUFFIX, syncOnce } from './sync';
import { FOLDERS_FILE, sessionFileName, toSessionFile } from './syncFormat';
import { readMeta, trackArchive } from './syncState';

// Two "devices" (two IndexedDB factories) syncing through the same in-memory Drive.

let clock = Date.parse('2026-10-27T09:00:00.000Z');
const now = () => new Date((clock += 60_000));

function device(drive: FakeDrive, token: string, openInEditor: Set<string> = new Set()) {
  const factory = new IDBFactory();
  const raw = createWebArchive(factory);
  const archive = trackArchive(raw, factory, () => {}, now);
  const api = createDriveApi({ getToken: () => token, fetchImpl: drive.fetch, sleep: async () => {}, random: () => 0 });
  const sync = () => syncOnce({ factory, api, now, isOpenInEditor: dir => openInEditor.has(dir) });
  const body = async (dir: string) => (await raw.readHtml(webSessionHtmlPath(dir)))?.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? null;
  return { factory, raw, archive, sync, body, openInEditor };
}

const input = (name: string): NewArchiveSession => ({
  name,
  input_name: `${name}.mp3`,
  completed_at_iso: '2026-10-27T08:00:00.000Z',
  effective_model: 'gemini-2.5-flash',
  input_path: 'web-file://locale',
  completion_status: 'completed',
});

describe('Drive sync between two devices', () => {
  it('brings a new sbobina to the other device, without the local lecture path', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Anatomia'), '<h1>Anatomia</h1><p>ossa</p>');

    expect(await pc.sync()).toMatchObject({ uploaded: 1, downloaded: 0 });
    expect(drive.files().map(file => file.name)).toEqual([sessionFileName(session.session_dir)]);
    expect(await ipad.sync()).toMatchObject({ downloaded: 1, uploaded: 0 });
    const [copy] = await ipad.raw.list();
    expect(copy).toMatchObject({ session_dir: session.session_dir, name: 'Anatomia', input_path: '' });
    expect(await ipad.body(session.session_dir)).toBe('<h1>Anatomia</h1><p>ossa</p>');

    // Nothing changed: the next rounds list, download and upload nothing.
    const before = drive.requests.length;
    expect(await pc.sync()).toMatchObject({ uploaded: 0, downloaded: 0 });
    expect(await ipad.sync()).toMatchObject({ uploaded: 0, downloaded: 0 });
    expect(drive.requests.slice(before).map(request => request.method)).toEqual(['GET', 'GET']);
  });

  it('carries edits and renames both ways, and only the marked sbobine go up', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const first = await pc.archive.create(input('Fisiologia'), '<p>uno</p>');
    const second = await pc.archive.create(input('Chimica'), '<p>due</p>');
    await pc.sync();
    await ipad.sync();

    await ipad.archive.saveHtml(webSessionHtmlPath(first.session_dir), '<p>uno, rivisto su iPad</p>', Date.now());
    await ipad.archive.update(first.session_dir, { name: 'Fisiologia 1' });
    // Opening a sbobina is not a change to sync.
    await ipad.archive.update(second.session_dir, { last_opened_at_iso: now().toISOString() });
    expect(await ipad.sync()).toMatchObject({ uploaded: 1 });
    expect(await pc.sync()).toMatchObject({ downloaded: 1, conflicts: 0 });
    expect(await pc.body(first.session_dir)).toBe('<p>uno, rivisto su iPad</p>');
    expect((await pc.raw.get(first.session_dir))?.name).toBe('Fisiologia 1');
    // The PC keeps its own lecture path.
    expect((await pc.raw.get(first.session_dir))?.input_path).toBe('web-file://locale');
  });

  it('removes a sbobina deleted on the other device, leaving a mark without text on Drive', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Istologia'), '<p>segreto</p>');
    await pc.sync();
    await ipad.sync();

    await pc.archive.delete(session.session_dir);
    await pc.sync();
    const [mark] = drive.files();
    expect(mark.content).toMatchObject({ body: '', deleted_at: expect.any(String) });
    expect(await ipad.sync()).toMatchObject({ removed: 1 });
    expect(await ipad.raw.list()).toEqual([]);
  });

  it('keeps both versions of a sbobina changed on both devices: the newer wins, the other is a copy', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Biochimica'), '<p>base</p>');
    await pc.sync();
    await ipad.sync();

    await pc.archive.saveHtml(session.html_path, '<p>versione PC</p>', Date.now());
    await ipad.archive.saveHtml(session.html_path, '<p>versione iPad</p>', Date.now());
    await pc.sync();
    expect(await ipad.sync()).toMatchObject({ conflicts: 1 });
    await pc.sync();

    for (const side of [pc, ipad]) {
      const sessions = await side.raw.list();
      expect(sessions.map(item => item.name).sort()).toEqual(['Biochimica', `Biochimica${CONFLICT_SUFFIX}`]);
      const original = sessions.find(item => item.session_dir === session.session_dir)!;
      const copy = sessions.find(item => item !== original)!;
      expect(await side.body(original.session_dir)).toBe('<p>versione iPad</p>');
      expect(await side.body(copy.session_dir)).toBe('<p>versione PC</p>');
    }
    expect(drive.files()).toHaveLength(2);
  });

  it('sends the changes made offline once the connection is back', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    drive.setOffline(true);
    const session = await pc.archive.create(input('Genetica'), '<p>in treno</p>');
    await expect(pc.sync()).rejects.toMatchObject({ offline: true });
    drive.setOffline(false);
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    await ipad.sync();
    expect(await ipad.body(session.session_dir)).toBe('<p>in treno</p>');
  });

  it('cleans a malicious body from Drive before it reaches IndexedDB', async () => {
    const drive = createFakeDrive();
    const ipad = device(drive, 'ipad');
    const dir = 'web-session://0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    drive.put(sessionFileName(dir), toSessionFile(
      { session_dir: dir, html_path: '', name: 'Trappola', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: '', input_path: '' },
      '<p onclick="steal()">testo</p><script>alert(1)</script><img src="x" onerror="alert(1)">',
      1,
      { updated_at: '2026-10-27T08:00:00.000Z', device_id: 'altro' },
    ));
    drive.put('sbobina-rotto.json', { format: 'el-sbobinator-sync' });
    expect(await ipad.sync()).toMatchObject({ downloaded: 1 });
    expect(await ipad.body(dir)).toBe('<p>testo</p><img src="x">');
  });

  it('waits and retries when Drive answers 429', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.archive.create(input('Patologia'), '<p>x</p>');
    drive.failNext({ status: 429 }, { status: 429 });
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
  });

  it('syncs the folders, newest change of each winning', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Anatomia'), '<p>x</p>');
    await pc.archive.saveFolders([{ id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [session.session_dir] }]);
    await pc.sync();
    expect(drive.files().map(file => file.name)).toContain(FOLDERS_FILE);
    expect(await ipad.sync()).toMatchObject({ foldersChanged: true });
    expect(await ipad.raw.loadFolders()).toEqual([{ id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [session.session_dir] }]);

    // Both devices change the tree: the iPad renames f1, the PC adds f2 and later renames f1 too.
    await ipad.archive.saveFolders([{ id: 'f1', name: 'Anno 1', color: '', parent_id: null, session_dirs: [session.session_dir] }]);
    await pc.archive.saveFolders([{ id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [session.session_dir] }, { id: 'f2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [] }]);
    await pc.archive.saveFolders([{ id: 'f1', name: 'Anno primo', color: '', parent_id: null, session_dirs: [session.session_dir] }, { id: 'f2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [] }]);
    await ipad.sync();
    await pc.sync();
    await ipad.sync();
    for (const side of [pc, ipad]) {
      expect((await side.raw.loadFolders()).map(folder => folder.name).sort()).toEqual(['Anno primo', 'Secondo anno']);
    }
    expect((await readMeta(pc.factory)).folders.dirty).toBe(false);

    await pc.archive.saveFolders([{ id: 'f2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [] }]);
    await pc.sync();
    await ipad.sync();
    expect((await ipad.raw.loadFolders()).map(folder => folder.id)).toEqual(['f2']);
  });

  it('does not overwrite a sbobina open in the editor: the change waits until it closes', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Farmacologia'), '<p>prima</p>');
    await pc.sync();
    await ipad.sync();

    await pc.archive.saveHtml(session.html_path, '<p>dopo</p>', Date.now());
    await pc.sync();
    ipad.openInEditor.add(session.session_dir);
    expect(await ipad.sync()).toMatchObject({ deferred: [session.session_dir], downloaded: 0 });
    expect(await ipad.body(session.session_dir)).toBe('<p>prima</p>');
    // Still waiting on the next round, although Drive lists nothing new any more.
    expect(await ipad.sync()).toMatchObject({ deferred: [session.session_dir] });

    ipad.openInEditor.clear();
    expect(await ipad.sync()).toMatchObject({ downloaded: 1, deferred: [] });
    expect(await ipad.body(session.session_dir)).toBe('<p>dopo</p>');
  });

  it('uploads the sbobine made before Drive was connected', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.raw.create(input('Vecchia'), '<p>di prima</p>');
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    expect(drive.files()[0].content).toMatchObject({ body: '<p>di prima</p>', session: { name: 'Vecchia' } });
  });
});

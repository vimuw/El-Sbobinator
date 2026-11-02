import { IDBFactory } from 'fake-indexeddb';
import katex from 'katex';
import { describe, expect, it, vi } from 'vitest';
import { DOCUMENTS, inTransaction, requestValue } from '../webDatabase';
import { createWebArchive, webSessionHtmlPath, type NewArchiveSession } from '../webSessions';
import { createDriveApi } from './driveApi';
import { createFakeDrive, type FakeDrive } from './fakeDrive';
import { CONFLICT_SUFFIX, syncOnce } from './sync';
import { FOLDERS_FILE, sessionFileName, toSessionFile } from './syncFormat';
import { bindAccount, readMeta, trackArchive } from './syncState';

// Two "devices" (two IndexedDB factories) syncing through the same in-memory Drive.

let clock = Date.parse('2026-10-27T09:00:00.000Z');
const now = () => new Date((clock += 60_000));

function device(drive: FakeDrive, token: string, openInEditor: Set<string> = new Set(), fetchImpl: typeof fetch = drive.fetch) {
  const factory = new IDBFactory();
  const raw = createWebArchive(factory);
  const archive = trackArchive(raw, factory, () => {}, now);
  const api = createDriveApi({ getToken: () => token, fetchImpl, sleep: async () => {}, random: () => 0 });
  const sync = () => syncOnce({ factory, api, now, isOpenInEditor: dir => openInEditor.has(dir) });
  const body = async (dir: string) => (await raw.readHtml(webSessionHtmlPath(dir)))?.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? null;
  return { factory, raw, archive, sync, body, openInEditor, api };
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

  it('keeps the time a text was written through a download and a rename on another device', async () => {
    // A backup import compares with it: the generation here stays the local one.
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Biochimica'), '<p>uno</p>');
    const writtenAt = Date.parse('2026-10-27T12:00:00.000Z');
    await pc.archive.saveHtml(session.html_path, '<p>uno, rivisto</p>', writtenAt);
    await pc.sync();
    await ipad.sync();
    const stored = await inTransaction(ipad.factory, DOCUMENTS, 'readonly', transaction => requestValue(transaction.objectStore(DOCUMENTS).get(session.session_dir)));
    expect(stored).toMatchObject({ generation: 0, text_at: writtenAt });

    await ipad.archive.update(session.session_dir, { name: 'Biochimica 1' });
    expect(await ipad.sync()).toMatchObject({ uploaded: 1 });
    expect(drive.files()[0].content).toMatchObject({ generation: writtenAt });
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

  it('does not make a conflict copy of a sbobina with formulas that is the same on Drive', async () => {
    const driveW = createFakeDrive();
    const driveX = createFakeDrive();
    const pc = device(driveW, 'pc');
    const apiOf = (drive: FakeDrive) => createDriveApi({ getToken: () => 'pc', fetchImpl: drive.fetch, sleep: async () => {}, random: () => 0 });
    // As the editor saves a formula: its LaTeX plus KaTeX's markup, MathML and SVG included.
    const formula = (latex: string) => `<span data-math="${latex}" class="math-node-inline" title="${latex}"><span class="math-rendered-html">${katex.renderToString(latex, { throwOnError: false, trust: false })}</span></span>`;
    const body = new DOMParser().parseFromString(`<body><p>Radice ${formula('\\sqrt{x}')}</p></body>`, 'text/html').body.innerHTML;
    expect(body).toContain('<math');
    expect(body).toContain('<svg');

    await bindAccount(pc.factory, 'w@example.com');
    await pc.archive.create(input('Analisi'), body);
    await pc.sync();
    // Another account and back: the state starts over and finds the same sbobina on Drive.
    await bindAccount(pc.factory, 'x@example.com');
    await syncOnce({ factory: pc.factory, api: apiOf(driveX), now });
    await bindAccount(pc.factory, 'w@example.com');
    expect(await pc.sync()).toMatchObject({ conflicts: 0 });
    expect((await pc.raw.list()).map(item => item.name)).toEqual(['Analisi']);
  });

  it('does not bring back a sbobina deleted for good while its first upload was on its way', async () => {
    const drive = createFakeDrive();
    let uploading = () => {};
    let release = () => {};
    const started = new Promise<void>(resolve => { uploading = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetchWithPause: typeof fetch = async (request, init) => {
      if (init?.method === 'POST') {
        uploading();
        await gate;
      }
      return drive.fetch(request, init);
    };
    const pc = device(drive, 'pc', new Set(), fetchWithPause);
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Privata'), '<p>segreto</p>');
    await pc.archive.trash(session.session_dir, now().toISOString());

    const round = pc.sync();
    await started;
    // The trash emptied while Drive receives the text.
    await pc.archive.delete(session.session_dir);
    release();
    await round;
    expect(await ipad.sync()).toMatchObject({ downloaded: 1 });
    expect(await pc.sync()).toMatchObject({ uploaded: 1, downloaded: 0 });

    // Drive keeps a mark without text, and no device has the sbobina any more.
    expect(drive.files().map(file => file.content)).toEqual([expect.objectContaining({ body: '', session: expect.objectContaining({ name: '' }) })]);
    expect(await ipad.sync()).toMatchObject({ removed: 1 });
    for (const side of [pc, ipad]) expect([...await side.raw.list(), ...await side.raw.listTrash()]).toEqual([]);
    expect(await pc.sync()).toMatchObject({ uploaded: 0, downloaded: 0 });
  });

  it('sends the deletion for good made while a conflict won here is resolved', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Privata'), '<p>uno</p>');
    await pc.sync();
    await ipad.sync();
    await ipad.archive.saveHtml(webSessionHtmlPath(session.session_dir), '<p>da iPad</p>', Date.now());
    await ipad.sync();
    // Changed here later too: this side wins the conflict.
    await pc.archive.saveHtml(webSessionHtmlPath(session.session_dir), '<p>dal PC</p>', Date.now() + 1000);

    // The trash emptied (or its 30 days over) while the copy of iPad's version is being saved.
    let deleting: Promise<boolean> | null = null;
    const round = syncOnce({
      factory: pc.factory,
      api: pc.api,
      now: () => {
        deleting ??= pc.archive.delete(session.session_dir);
        return now();
      },
    });
    expect(await round).toMatchObject({ conflicts: 1 });
    expect(await deleting).toBe(true);

    // Drive keeps a mark without text; iPad's version survives only as the copy.
    const file = drive.files().find(item => item.name === sessionFileName(session.session_dir));
    expect(file?.content).toMatchObject({ body: '', purged_at: expect.any(String), session: expect.objectContaining({ name: '' }) });
    expect(await ipad.sync()).toMatchObject({ removed: 1 });
    expect((await ipad.raw.list()).map(item => item.name)).toEqual([`Privata${CONFLICT_SUFFIX}`]);
    expect(await pc.sync()).toMatchObject({ uploaded: 0, downloaded: 0 });
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

  it('keeps a folder saved while the round downloads the other device\'s folders', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const first = { id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] };
    const second = { id: 'f2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [] };
    await pc.archive.saveFolders([first]);
    await pc.sync();
    await ipad.sync();
    await ipad.archive.saveFolders([{ ...first, name: 'Anno 1' }]);
    await ipad.sync();

    // On the PC f2 is created while the round downloads the iPad's rename.
    const read = pc.api.readJson.bind(pc.api);
    const download = vi.spyOn(pc.api, 'readJson').mockImplementation(async id => {
      const value = await read(id);
      if (drive.files().find(file => file.id === id)?.name === FOLDERS_FILE) await pc.archive.saveFolders([first, second]);
      return value;
    });
    await pc.sync();
    download.mockRestore();
    expect((await pc.raw.loadFolders()).map(folder => folder.id).sort()).toEqual(['f1', 'f2']);

    await pc.sync();
    await ipad.sync();
    for (const side of [pc, ipad]) {
      expect((await side.raw.loadFolders()).map(folder => folder.name).sort()).toEqual(['Anno 1', 'Secondo anno']);
    }
  });

  it('keeps a folder renamed here while the round downloads a sbobina, after the other device renamed it', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    const folder = { id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] };
    await pc.archive.saveFolders([folder]);
    await pc.sync();
    await ipad.sync();
    await ipad.archive.saveFolders([{ ...folder, name: 'Anno 1 (iPad)' }]);
    await ipad.archive.saveHtml(webSessionHtmlPath(session.session_dir), '<p>ossa, rivisto</p>', Date.now());
    await ipad.sync();

    // The PC's rename comes later than the iPad's, while the round downloads the sbobina: it wins.
    const read = pc.api.readJson.bind(pc.api);
    const download = vi.spyOn(pc.api, 'readJson').mockImplementation(async id => {
      const value = await read(id);
      if (drive.files().find(file => file.id === id)?.name === sessionFileName(session.session_dir)) {
        await pc.archive.saveFolders([{ ...folder, name: 'Anno primo' }]);
      }
      return value;
    });
    await pc.sync();
    download.mockRestore();
    expect((await pc.raw.loadFolders()).map(item => item.name)).toEqual(['Anno primo']);

    await pc.sync();
    await ipad.sync();
    for (const side of [pc, ipad]) expect((await side.raw.loadFolders()).map(item => item.name)).toEqual(['Anno primo']);
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

  it('keeps the other device’s edit as a copy when the sbobina is edited in the editor here meanwhile', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Farmacologia'), '<p>prima</p>');
    await pc.sync();
    await ipad.sync();

    await pc.archive.saveHtml(session.html_path, '<p>modifica PC</p>', Date.now());
    await pc.sync();
    ipad.openInEditor.add(session.session_dir);
    await ipad.archive.saveHtml(session.html_path, '<p>modifica iPad</p>', Date.now());
    // The edit made in the editor waits with Drive's change: no upload over the PC's version.
    expect(await ipad.sync()).toMatchObject({ deferred: [session.session_dir], uploaded: 0 });
    expect(drive.files()).toHaveLength(1);
    expect(drive.files()[0].content).toMatchObject({ body: '<p>modifica PC</p>' });

    ipad.openInEditor.clear();
    expect(await ipad.sync()).toMatchObject({ conflicts: 1 });
    await pc.sync();
    for (const side of [ipad, pc]) {
      const bodies = await Promise.all((await side.raw.list()).map(item => side.body(item.session_dir)));
      expect(bodies.sort()).toEqual(['<p>modifica PC</p>', '<p>modifica iPad</p>']);
    }
  });

  it('keeps a rename made here while the round downloads the other device’s edit', async () => {
    const drive = createFakeDrive();
    let duringDownload: (() => Promise<unknown>) | null = null;
    const fetchWithPause: typeof fetch = async (request, init) => {
      if (duringDownload && String(request).includes('alt=media')) {
        const step = duringDownload;
        duringDownload = null;
        await step();
      }
      return drive.fetch(request, init);
    };
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad', new Set(), fetchWithPause);
    const session = await pc.archive.create(input('Chimica'), '<p>a</p>');
    await pc.sync();
    await ipad.sync();

    await pc.archive.saveHtml(session.html_path, '<p>b dal PC</p>', Date.now());
    await pc.sync();
    duringDownload = () => ipad.archive.update(session.session_dir, { name: 'Chimica rinominata' });
    expect(await ipad.sync()).toMatchObject({ conflicts: 1 });
    await pc.sync();
    for (const side of [ipad, pc]) {
      const items = await side.raw.list();
      expect(items.map(item => item.name)).toContain('Chimica rinominata');
      expect(await Promise.all(items.map(item => side.body(item.session_dir)))).toContain('<p>b dal PC</p>');
    }
  });

  it('does not take its own upload for a change from Drive when the editor saves during it', async () => {
    const drive = createFakeDrive();
    let duringUpload: (() => Promise<unknown>) | null = null;
    const fetchWithPause: typeof fetch = async (request, init) => {
      const answer = drive.fetch(request, init);
      if (duringUpload && init?.method === 'PATCH') {
        const step = duringUpload;
        duringUpload = null;
        await step();
      }
      return answer;
    };
    const pc = device(drive, 'pc', new Set(), fetchWithPause);
    const session = await pc.archive.create(input('Fisiologia'), '<p>uno</p>');
    await pc.sync();

    pc.openInEditor.add(session.session_dir);
    await pc.archive.saveHtml(session.html_path, '<p>due</p>', Date.now());
    duringUpload = () => pc.archive.saveHtml(session.html_path, '<p>tre</p>', Date.now() + 1);
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    // The save made during the upload goes next, with the editor still open and no "changed elsewhere".
    expect(await pc.sync()).toMatchObject({ uploaded: 1, downloaded: 0, conflicts: 0, deferred: [] });
    expect(drive.files()[0].content).toMatchObject({ body: '<p>tre</p>' });

    pc.openInEditor.clear();
    expect(await pc.sync()).toMatchObject({ uploaded: 0, downloaded: 0, conflicts: 0 });
    expect((await pc.raw.list()).map(item => item.name)).toEqual(['Fisiologia']);
  });

  it('goes on when a change held back for the editor was removed from Drive meanwhile', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Istologia'), '<p>prima</p>');
    await pc.sync();
    await ipad.sync();
    await pc.archive.saveHtml(session.html_path, '<p>modifica PC</p>', Date.now());
    await pc.sync();
    ipad.openInEditor.add(session.session_dir);
    await ipad.archive.saveHtml(session.html_path, '<p>modifica iPad</p>', Date.now());
    expect(await ipad.sync()).toMatchObject({ deferred: [session.session_dir] });

    // "Elimina tutti i miei dati da Drive" on the PC.
    for (const file of drive.files()) await pc.api.remove(file.id);
    ipad.openInEditor.clear();
    expect(await ipad.sync()).toMatchObject({ uploaded: 1, deferred: [] });
    expect(drive.files().map(file => file.content)).toEqual([expect.objectContaining({ body: '<p>modifica iPad</p>' })]);
    expect((await readMeta(ipad.factory)).deferred).toEqual([]);
    expect(await ipad.sync()).toMatchObject({ uploaded: 0, downloaded: 0 });
  });

  it('never overwrites a sbobina written by a newer version of the app, even with a local change', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    const session = await pc.archive.create(input('Genetica'), '<p>uno</p>');
    await pc.sync();
    await ipad.sync();
    const [file] = drive.files();
    // A newer version of the app rewrites it in its own format; the iPad edits it before its round.
    await pc.api.updateJson(file.id, { ...(file.content as object), version: 2, body: '<p>formato nuovo</p>' });
    await ipad.archive.saveHtml(session.html_path, '<p>modifica iPad</p>', Date.now());

    for (let round = 0; round < 2; round++) {
      expect(await ipad.sync()).toMatchObject({ uploaded: 0, skipped: [file.name] });
      expect(drive.files()[0].content).toMatchObject({ version: 2, body: '<p>formato nuovo</p>' });
    }
    expect(await ipad.body(session.session_dir)).toBe('<p>modifica iPad</p>');

    // Back in a format it reads: the change on both sides keeps both texts.
    await pc.api.updateJson(file.id, { ...(file.content as object), body: '<p>di nuovo leggibile</p>' });
    expect(await ipad.sync()).toMatchObject({ conflicts: 1, uploaded: 2 });
    expect(drive.files().map(item => (item.content as { body: string }).body).sort()).toEqual(['<p>di nuovo leggibile</p>', '<p>modifica iPad</p>']);
  });

  it('never overwrites the collections written by a newer version of the app', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const ipad = device(drive, 'ipad');
    await pc.archive.saveFolders([{ id: 'r1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] }]);
    await pc.sync();
    await ipad.sync();
    const folders = drive.files().find(item => item.name === FOLDERS_FILE)!;
    await pc.api.updateJson(folders.id, { ...(folders.content as object), version: 2 });
    await ipad.archive.saveFolders([{ id: 'r1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] }, { id: 'r2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [] }]);
    // Later writes on Drive: the second round's listing no longer reaches the collections file.
    for (let write = 0; write < 70; write++) drive.put('altro.json', {});

    for (let round = 0; round < 2; round++) {
      expect(await ipad.sync()).toMatchObject({ skipped: [FOLDERS_FILE] });
      expect(drive.files().find(item => item.name === FOLDERS_FILE)?.content).toMatchObject({ version: 2 });
    }
  });

  it('uploads the sbobine made before Drive was connected', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.raw.create(input('Vecchia'), '<p>di prima</p>');
    expect(await pc.sync()).toMatchObject({ uploaded: 1 });
    expect(drive.files()[0].content).toMatchObject({ body: '<p>di prima</p>', session: { name: 'Vecchia' } });
  });
});

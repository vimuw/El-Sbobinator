import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { BACKUP_FORMAT, BACKUP_MANIFEST, BACKUP_VERSION, backupFileName, createBackup, describeBackup, describeImport, importBackup, loadLastBackupAt, saveLastBackupAt, type BackupManifest } from './webBackup';
import { measureWebStorage } from './webDatabase';
import { createWebMediaStore } from './webMedia';
import { createWebArchive, webSessionHtmlPath } from './webSessions';
import { createZip, readZip } from './zipArchive';

const KEY = 'AIzaSyBackupKey12345678901234';
const lecture = (name: string, bytes: number) => new File([new Uint8Array(bytes).fill(5)], name, { type: 'audio/mp4', lastModified: 1_700_000_000_000 });

const IDENTITY = { name: 'Fisiologia.m4a', size: 3_000, headHash: 'ab'.repeat(32) };

function sessionInput(name: string, completed: string) {
  return { name, completed_at_iso: completed, effective_model: 'gemini-2.5-flash', input_path: `local://${name}`, input_name: `${name}.m4a` };
}

/** An archive with two sbobine (one with audio and an edit), one collection. */
async function seed(factory: IDBFactory) {
  const archive = createWebArchive(factory);
  const media = createWebMediaStore(factory);
  const first = await archive.create({ ...sessionInput('Fisiologia', '2026-10-20T10:00:00.000Z'), input_identity: IDENTITY }, '<h1>Rene</h1><p>Il nefrone</p>');
  const second = await archive.create(sessionInput('Anatomia', '2026-10-21T10:00:00.000Z'), '<p>Il cuore</p>');
  await archive.saveHtml(first.html_path, '<h1>Rene</h1><p>Il nefrone filtra</p>', 1_000);
  await media.save('audio-1', lecture('Fisiologia.m4a', 3_000));
  await media.link('audio-1', first.session_dir);
  await archive.saveFolders([{ id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [first.session_dir] }]);
  return { archive, media, first, second };
}

async function manifestOf(blob: Blob): Promise<BackupManifest> {
  const entries = await readZip(blob);
  return JSON.parse(await (await entries.get(BACKUP_MANIFEST)!.blob()).text()) as BackupManifest;
}

async function backupWith(manifest: Partial<BackupManifest>, extra: Array<{ name: string; data: Blob }> = []): Promise<Blob> {
  const full = { format: BACKUP_FORMAT, version: BACKUP_VERSION, created_at: '', app_version: 'v1', sessions: [], folders: [], ...manifest };
  return createZip([{ name: BACKUP_MANIFEST, data: new Blob([JSON.stringify(full)]) }, ...extra]);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('web backup', () => {
  it('describes sizes before downloading', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const info = await describeBackup(factory);
    expect(info).toMatchObject({ sessions: 2, audioBytes: 3_000, audioFiles: 1 });
    expect(info.textBytes).toBeGreaterThan(100);
  });

  it("agrees with the settings' space figures for texts and lecture audio", async () => {
    // Regression: settings showed 1.1 MB for three sbobine while the backup estimate said 202 KB.
    const factory = new IDBFactory();
    const { media } = await seed(factory);
    await media.save('queued', lecture('In coda.m4a', 5_000));
    const [info, usage] = await Promise.all([describeBackup(factory), measureWebStorage(factory)]);
    expect(usage.audio).toBe(info.audioBytes);
    expect(usage.queueAudio).toBe(5_000);
    // The manifest adds only its own header to the same sessions and folders.
    expect(info.textBytes - usage.documents).toBeGreaterThanOrEqual(0);
    expect(info.textBytes - usage.documents).toBeLessThan(200);
    expect(usage.total).toBe(usage.audio + usage.queueAudio + usage.documents + usage.checkpoints);
  });

  it('writes a versioned manifest, the audio as it is and never the API keys', async () => {
    const values = new Map([[STORAGE_KEYS.WEB_GEMINI_KEYS_V1, KEY]]);
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key as never) ?? null, setItem: vi.fn() } });
    const factory = new IDBFactory();
    const { first } = await seed(factory);

    const backup = await createBackup(factory, { includeAudio: true, appVersion: 'v9.9.9', now: new Date(2026, 9, 22, 12) });
    expect(backup.filename).toBe('El-Sbobinator-backup-2026-10-22.zip');
    expect(backup).toMatchObject({ sessions: 2, audioFiles: 1 });
    const manifest = await manifestOf(backup.blob);
    expect(manifest).toMatchObject({ format: BACKUP_FORMAT, version: 1, app_version: 'v9.9.9' });
    expect(manifest.sessions.map(item => item.session.name)).toEqual(['Anatomia', 'Fisiologia']);
    const withAudio = manifest.sessions.find(item => item.session.session_dir === first.session_dir)!;
    expect(withAudio).toMatchObject({ body: '<h1>Rene</h1><p>Il nefrone filtra</p>', generation: 1_000, audio: { file: 'audio/002-Fisiologia.m4a', name: 'Fisiologia.m4a', size: 3_000 } });
    expect(manifest.folders).toEqual([expect.objectContaining({ id: 'f1', session_dirs: [first.session_dir] })]);
    const entries = await readZip(backup.blob);
    expect((await entries.get('audio/002-Fisiologia.m4a')!.blob()).size).toBe(3_000);
    expect(await backup.blob.text()).not.toContain(KEY);
  });

  it('leaves the audio out when asked', async () => {
    const factory = new IDBFactory();
    await seed(factory);
    const backup = await createBackup(factory, { includeAudio: false, appVersion: 'v1' });
    expect(backup.audioFiles).toBe(0);
    expect([...(await readZip(backup.blob)).keys()]).toEqual([BACKUP_MANIFEST]);
    expect((await manifestOf(backup.blob)).sessions.every(item => !item.audio)).toBe(true);
  });

  it('restores sbobine, edits, collections and audio in an empty browser', async () => {
    const source = new IDBFactory();
    const { first, second } = await seed(source);
    const backup = await createBackup(source, { includeAudio: true, appVersion: 'v1' });

    const target = new IDBFactory();
    const progress: number[] = [];
    const summary = await importBackup(target, new File([backup.blob], backup.filename), { onProgress: done => progress.push(done) });
    expect(summary).toEqual({ added: 2, replaced: 0, skipped: 0, restored: 0, audioFiles: 1, folders: 1, changed: [second.session_dir, first.session_dir] });
    expect(progress).toEqual([1, 2]);

    const archive = createWebArchive(target);
    expect((await archive.list()).map(session => session.name)).toEqual(['Anatomia', 'Fisiologia']);
    // The lecture's identity comes along: the editor checks a file picked on this device against it.
    expect((await archive.list()).find(session => session.name === 'Fisiologia')?.input_identity).toEqual(IDENTITY);
    expect(await archive.readHtml(first.html_path)).toContain('Il nefrone filtra');
    expect(await archive.generation(first.html_path)).toBe(1_000);
    expect(await archive.generation(second.html_path)).toBe(0);
    expect(await archive.loadFolders()).toEqual([expect.objectContaining({ id: 'f1', name: 'Primo anno', session_dirs: [first.session_dir] })]);
    const audio = await createWebMediaStore(target).forSession(first.session_dir);
    expect(audio).toMatchObject({ name: 'Fisiologia.m4a', size: 3_000, type: 'audio/mp4' });
    expect(await createWebMediaStore(target).forSession(second.session_dir)).toBeNull();
  });

  it('keeps sbobine already here unless the backup has a later edit, and never deletes', async () => {
    const factory = new IDBFactory();
    const { archive, first, second } = await seed(factory);
    const older = await createBackup(factory, { includeAudio: true, appVersion: 'v1' });
    // After the backup: a later edit here, and the second sbobina loses its (absent) audio twin.
    await archive.saveHtml(first.html_path, '<p>Modifica più recente qui</p>', 2_000);
    const extra = await archive.create(sessionInput('Solo qui', '2026-10-22T10:00:00.000Z'), '<p>Locale</p>');

    const summary = await importBackup(factory, older.blob);
    expect(summary).toEqual({ added: 0, replaced: 0, skipped: 2, restored: 0, audioFiles: 0, folders: 0, changed: [] });
    expect(await archive.readHtml(first.html_path)).toContain('Modifica più recente qui');
    expect(await archive.readHtml(extra.html_path)).toContain('Locale');

    // A backup with a later edit of the second sbobina replaces it (text and name).
    const newer = await backupWith({ sessions: [{ session: { ...second, name: 'Anatomia rivista' }, body: '<p>Il cuore pompa</p>', generation: 5_000 }] });
    expect(await importBackup(factory, newer)).toMatchObject({ replaced: 1, skipped: 0 });
    expect(await archive.readHtml(second.html_path)).toContain('Il cuore pompa');
    expect((await archive.list()).find(session => session.session_dir === second.session_dir)?.name).toBe('Anatomia rivista');
    expect(await archive.generation(second.html_path)).toBe(5_000);
  });

  it('adds the backup audio to a sbobina kept here without one', async () => {
    const factory = new IDBFactory();
    const { second } = await seed(factory);
    const backup = await backupWith(
      { sessions: [{ session: second, body: '<p>vecchio</p>', generation: 0, audio: { file: 'audio/001-a.mp3', name: 'a.mp3', type: 'audio/mpeg', size: 4, lastModified: 1 } }] },
      [{ name: 'audio/001-a.mp3', data: new Blob([new Uint8Array(4)]) }],
    );
    expect(await importBackup(factory, backup)).toMatchObject({ skipped: 1, audioFiles: 1 });
    expect(await createWebArchive(factory).readHtml(second.html_path)).toContain('Il cuore');
    expect(await createWebMediaStore(factory).forSession(second.session_dir)).toMatchObject({ name: 'a.mp3', size: 4 });
  });

  it('merges collections: new ones added, a sbobina stays where it already is', async () => {
    const factory = new IDBFactory();
    const { first, second } = await seed(factory);
    const backup = await backupWith({
      folders: [
        { id: 'f1', name: 'Rinominata altrove', color: '', parent_id: null, session_dirs: [second.session_dir, 'web-session://assente'] },
        { id: 'f2', name: 'Secondo anno', color: '', parent_id: null, session_dirs: [first.session_dir] },
      ],
    });
    expect(await importBackup(factory, backup)).toMatchObject({ folders: 1 });
    const folders = await createWebArchive(factory).loadFolders();
    expect(folders.find(folder => folder.id === 'f1')).toMatchObject({ name: 'Primo anno', session_dirs: [first.session_dir, second.session_dir] });
    expect(folders.find(folder => folder.id === 'f2')).toMatchObject({ name: 'Secondo anno', session_dirs: [] });
  });

  it('refuses other files, newer formats and entries that are not web sbobine', async () => {
    const factory = new IDBFactory();
    await expect(importBackup(factory, new Blob(['ciao']))).rejects.toThrow('non è un backup di El Sbobinator');
    await expect(importBackup(factory, await createZip([{ name: 'altro.json', data: new Blob(['{}']) }]))).rejects.toThrow('non è un backup');
    await expect(importBackup(factory, await backupWith({ format: 'altro' as never }))).rejects.toThrow('non è un backup');
    await expect(importBackup(factory, await backupWith({ version: BACKUP_VERSION + 1 }))).rejects.toThrow('versione più recente');

    const desktop = { name: 'Desktop', completed_at_iso: '', effective_model: '', input_path: '', session_dir: 'C:/sessioni/abc', html_path: '' } as ArchiveSession;
    expect(await importBackup(factory, await backupWith({ sessions: [{ session: desktop, body: '', generation: 0 }] }))).toMatchObject({ added: 0 });
    expect(await createWebArchive(factory).list()).toEqual([]);
  });

  it('describes the import in Italian', () => {
    expect(describeImport({ added: 2, replaced: 1, skipped: 1, restored: 1, audioFiles: 1, folders: 0, changed: [] }))
      .toBe('2 sbobine aggiunte, 1 sostituita con la versione più recente del backup, 1 ripresa dal cestino, 1 già presente e lasciata com’era, 1 audio importato.');
    expect(describeImport({ added: 0, replaced: 0, skipped: 0, restored: 0, audioFiles: 0, folders: 0, changed: [] })).toBe('Il backup non contiene sbobine.');
  });

  it('remembers the last download in this browser', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });
    expect(loadLastBackupAt()).toBeNull();
    saveLastBackupAt('2026-10-22T10:00:00.000Z');
    expect(loadLastBackupAt()).toBe('2026-10-22T10:00:00.000Z');
    expect(backupFileName(new Date(2026, 0, 5))).toBe('El-Sbobinator-backup-2026-01-05.zip');
  });

  it('gives the imported sbobina its web document path', async () => {
    const factory = new IDBFactory();
    const session = { name: 'X', completed_at_iso: '', effective_model: '', input_path: '', session_dir: 'web-session://abc', html_path: 'sbagliato' } as ArchiveSession;
    await importBackup(factory, await backupWith({ sessions: [{ session, body: '<p>x</p>', generation: 0 }] }));
    expect((await createWebArchive(factory).list())[0].html_path).toBe(webSessionHtmlPath('web-session://abc'));
  });
});

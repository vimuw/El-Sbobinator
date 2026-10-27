import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createWebArchive, type NewArchiveSession, type WebArchive } from '../webSessions';
import { DriveAuthError } from './auth';
import { FOLDER_MIME, createDriveApi } from './driveApi';
import { createDriveService } from './driveService';
import { exportDocument, exportFolderName } from './exportDrive';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './fakeDrive';
import { DRIVE_FILE_SCOPE } from './oauth';
import { readMeta, readRecords, trackArchive } from './syncState';

// "Elimina tutti i miei dati da Drive" and "Esporta tutte le sbobine nel mio Drive", on the
// in-memory Drive: the first empties the hidden folder and forgets the sync, the second writes a
// visible folder the sync never reads.

const input = (name: string): NewArchiveSession => ({
  name,
  completed_at_iso: '2026-10-27T08:00:00.000Z',
  effective_model: 'gemini-2.5-flash',
  input_path: '',
});

function device(drive: FakeDrive, name: string, initial: { token?: boolean; email?: string | null } = {}) {
  const factory = new IDBFactory();
  const login = createFakeAuth(name, initial);
  // drive.fetch read at each call: a test may wrap it.
  const client = (getToken: () => string | null) => createDriveApi({ getToken, fetchImpl: (url, init) => drive.fetch(url, init), sleep: async () => {}, random: () => 0 });
  let archive: WebArchive | null = null;
  const service = createDriveService({
    factory,
    auth: login.auth,
    api: client(() => login.auth.token()),
    isBusy: () => false,
    delayMs: 10_000,
    now: () => new Date('2026-10-27T10:00:00.000Z'),
    archive: () => archive!,
    exportApi: token => client(() => token),
  });
  archive = trackArchive(createWebArchive(factory), factory, () => service.schedule());
  return { factory, service, archive, login };
}

describe('Elimina tutti i miei dati da Drive', () => {
  it('removes every file of the hidden folder and the sync state, keeps the sbobine here and disconnects', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.service.connect();
    await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    await pc.archive.create(input('Fisiologia'), '<p>rene</p>');
    await pc.archive.saveFolders([{ id: 'f1', name: 'Primo anno', color: '', parent_id: null, session_dirs: [] }]);
    await pc.service.syncNow();
    expect(drive.files()).toHaveLength(3);
    const deviceId = (await readMeta(pc.factory)).device_id;

    const status = await pc.service.erase();
    expect(status).toMatchObject({ removed: 3, connected: false, error: null });
    expect(drive.files()).toEqual([]);
    expect(await readRecords(pc.factory)).toEqual(new Map());
    expect(await readMeta(pc.factory)).toMatchObject({ device_id: deviceId, folders: { times: {} } });
    expect(await readMeta(pc.factory)).not.toHaveProperty('last_sync_at');
    expect(pc.login.disconnects).toHaveLength(1);
    expect((await pc.archive.list()).map(session => session.name).sort()).toEqual(['Anatomia', 'Fisiologia']);

    // Nothing goes back up on its own: the browser is no longer linked.
    await pc.archive.update((await pc.archive.list())[0].session_dir, { name: 'Anatomia 2' });
    await pc.service.syncNow();
    expect(drive.files()).toEqual([]);
  });

  it('needs a valid login and says so, removing nothing', async () => {
    const drive = createFakeDrive();
    drive.put('raccolte.json', { format: 'el-sbobinator-sync-folders' });
    const pc = device(drive, 'pc', { email: 'studente@example.com' });
    const status = await pc.service.erase();
    expect(status).toMatchObject({ removed: 0, connected: true, needs_reconnect: true });
    expect(status.error).toContain('tocca per riconnettere');
    expect(drive.files()).toHaveLength(1);
  });

  it('stops at a Drive error and keeps the link, so a new tap can finish', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.service.connect();
    await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    await pc.service.syncNow();
    drive.failNext({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, { status: 500 });
    const status = await pc.service.erase();
    expect(status).toMatchObject({ connected: true, removed: 0 });
    expect(status.error).toContain('500');
    expect(drive.files()).toHaveLength(1);
    expect(await pc.service.erase()).toMatchObject({ removed: 1, connected: false });
  });
});

describe('Esporta tutte le sbobine nel mio Drive', () => {
  it('asks for drive.file only then, and writes one HTML file per sbobina with the raccolte as subfolders', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    const loose = await pc.archive.create(input('Lezione libera'), '<p>senza raccolta</p>');
    const first = await pc.archive.create(input('Rene'), '<h1>Rene</h1><p>nefrone</p>');
    const second = await pc.archive.create(input('Cuore'), '<p>valvole</p>');
    const twin = await pc.archive.create(input('Rene'), '<p>seconda lezione</p>');
    const trashed = await pc.archive.create(input('Cestinata'), '<p>no</p>');
    await pc.archive.trash(trashed.session_dir, '2026-10-26T10:00:00.000Z');
    await pc.archive.saveFolders([
      { id: 'anno', name: 'Primo anno', color: '', parent_id: null, session_dirs: [second.session_dir] },
      { id: 'fisio', name: 'Fisiologia: rene', color: '', parent_id: 'anno', session_dirs: [first.session_dir, twin.session_dir] },
    ]);
    const progress: string[] = [];

    const result = await pc.service.exportAll((done, total) => progress.push(`${done}/${total}`));
    expect(pc.login.calls).toEqual([{ silent: false, scope: DRIVE_FILE_SCOPE }]);
    // The export's token is not the tab's: the sync stays unlinked.
    expect(pc.service.status()).toMatchObject({ connected: false });
    expect(result).toMatchObject({ ok: true, exported: 4, total: 4, folder_name: 'El Sbobinator – esportazione 2026-10-27' });
    expect(result.folder_url).toContain('drive.google.com');
    expect(progress.at(-1)).toBe('4/4');

    const files = drive.visibleFiles();
    const byName = (name: string) => files.find(file => file.name === name)!;
    const root = byName(exportFolderName(new Date('2026-10-27T10:00:00.000Z')));
    const year = byName('Primo anno');
    const physiology = byName('Fisiologia_ rene');
    expect([root.mimeType, year.mimeType, physiology.mimeType]).toEqual([FOLDER_MIME, FOLDER_MIME, FOLDER_MIME]);
    expect(year.parents).toEqual([root.id]);
    expect(physiology.parents).toEqual([year.id]);
    expect(byName('Lezione libera.html').parents).toEqual([root.id]);
    expect(byName('Cuore.html').parents).toEqual([year.id]);
    expect(files.filter(file => file.parents[0] === physiology.id).map(file => file.name).sort()).toEqual(['Rene (2).html', 'Rene.html']);
    expect(files.some(file => file.name.startsWith('Cestinata'))).toBe(false);
    const document = byName('Lezione libera.html');
    expect(document.mimeType).toBe('text/html');
    expect(document.content).toContain('<title>Lezione libera</title>');
    expect(document.content).toContain('<style>');
    expect(document.content).toContain('<p>senza raccolta</p>');
    expect(loose.name).toBe('Lezione libera');

    // The hidden folder is untouched and the sync never lists the export.
    expect(drive.files()).toEqual([]);
  });

  it('explains a missing or refused permission and writes nothing', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.archive.create(input('Rene'), '<p>x</p>');
    pc.login.failures.push(new DriveAuthError('file_scope_missing'));
    const missing = await pc.service.exportAll();
    expect(missing).toMatchObject({ ok: false, exported: 0 });
    expect(missing.error).toContain('permesso di creare file');

    pc.login.failures.push(new DriveAuthError('access_denied'));
    expect((await pc.service.exportAll()).error).toContain('non concesso');
    expect(drive.visibleFiles()).toEqual([]);
  });

  it('stops when Drive is full and tells how many sbobine made it', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await pc.archive.create(input('Uno'), '<p>1</p>');
    await pc.archive.create(input('Due'), '<p>2</p>');
    // The folder and the first file pass, then the quota ends.
    const base = drive.fetch;
    let uploads = 0;
    drive.fetch = async (url, init) => {
      if (String(url).includes('/upload/') && ++uploads === 2) drive.failNext({ status: 403, reason: 'storageQuotaExceeded' });
      return base(url, init);
    };
    const result = await pc.service.exportAll();
    expect(result).toMatchObject({ ok: false, exported: 1, total: 2, folder_name: 'El Sbobinator – esportazione 2026-10-27' });
    expect(result.error).toContain('Spazio su Google Drive esaurito');
  });

  it('adds a plain style to the full document', () => {
    expect(exportDocument('<html><head><title>T</title></head><body><p>x</p></body></html>')).toMatch(/<title>T<\/title><meta name="viewport"[^>]*><style>.*<\/style><\/head>/);
  });
});

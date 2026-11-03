import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { createCheckpointStore } from './checkpointStore';
import { defaultSettings } from './pipeline/run';
import { newSession } from './pipeline/session';
import { SYNC, WEB_DB_NAME, WEB_DB_VERSION, openWebDatabase } from './webDatabase';
import { TRASH_DAYS, createWebArchive, emptyTrash, purgeExpiredTrash, requestPersistentStorage, webSessionHtmlPath, type NewArchiveSession, type WebArchive } from './webSessions';

const identity = { name: 'Lezione.mp3', size: 10, headHash: 'ab' };

function input(name: string, completedAt: string): NewArchiveSession {
  return { name, input_name: `${name}.mp3`, completed_at_iso: completedAt, effective_model: 'gemini-2.5-flash', input_path: '', completion_status: 'completed' };
}

/** The database as M1 created it: version 1 with the checkpoint store only. */
function openV1(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WEB_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('checkpoints', { keyPath: 'id' }).createIndex('byFile', 'fileKey');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('web archive in IndexedDB', () => {
  it('upgrades the M1 database keeping its checkpoints and copies the old localStorage archive once', async () => {
    const factory = new IDBFactory();
    const v1 = await openV1(factory);
    await new Promise<void>((resolve, reject) => {
      const transaction = v1.transaction('checkpoints', 'readwrite');
      transaction.objectStore('checkpoints').put({ ...newSession('cp', identity, defaultSettings('gemini-2.5-flash')), archiveSessionDir: 'web-session://old', fileKey: 'k' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v1.close();
    const legacy: ArchiveSession = { ...input('Vecchia', '2026-10-20T10:00:00Z'), session_dir: 'web-session://old', html_path: 'web-session://old/sbobina.html' };
    localStorage.setItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1, JSON.stringify({
      sessions: [{ session: legacy, body: '<p>Testo salvato</p>', generation: 3 }],
      folders: [{ id: 'f1', name: 'Fisiologia', color: '', session_dirs: ['web-session://old'] }],
    }));

    const archive = createWebArchive(factory);
    expect(await archive.list()).toEqual([legacy]);
    expect((await openWebDatabase(factory)).version).toBe(WEB_DB_VERSION);
    expect((await openWebDatabase(factory)).objectStoreNames.contains('sync')).toBe(true);
    expect(await archive.readHtml(legacy.html_path)).toContain('<body><p>Testo salvato</p></body>');
    expect(await archive.generation(legacy.session_dir)).toBe(3);
    expect(await archive.loadFolders()).toEqual([{ id: 'f1', name: 'Fisiologia', color: '', session_dirs: ['web-session://old'] }]);
    expect(localStorage.getItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1)).toBeNull();
    expect((await createCheckpointStore(factory).get('cp'))?.archiveSessionDir).toBe('web-session://old');
  });

  it('creates, lists newest first, renames and saves with a monotonic generation', async () => {
    const archive = createWebArchive(new IDBFactory());
    const older = await archive.create(input('Prima', '2026-10-20T10:00:00Z'), '<h1>Prima</h1>');
    const newer = await archive.create(input('Seconda <b>', '2026-10-21T10:00:00Z'), '<h1>Seconda</h1>');
    expect(older.session_dir).toMatch(/^web-session:\/\/[0-9a-f-]{36}$/);
    expect(older.html_path).toBe(webSessionHtmlPath(older.session_dir));
    expect((await archive.list()).map(session => session.name)).toEqual(['Seconda <b>', 'Prima']);
    expect(await archive.readHtml(newer.html_path)).toBe(
      '<!doctype html><html lang="it"><head><meta charset="utf-8"><title>Seconda &lt;b&gt;</title></head><body><h1>Seconda</h1></body></html>',
    );

    expect(await archive.generation(older.html_path)).toBe(0);
    expect(await archive.saveHtml(older.html_path, '<p>v2</p>', 2)).toEqual({ ok: true, saved: true });
    expect(await archive.saveHtml(older.html_path, '<p>v1 in ritardo</p>', 1)).toEqual({ ok: true, saved: false });
    expect(await archive.readHtml(older.html_path)).toContain('<p>v2</p>');
    // A save without generation (the retry of unrevised sections) keeps the counter.
    expect(await archive.saveHtml(older.html_path, '<p>rivista</p>')).toEqual({ ok: true, saved: true });
    expect(await archive.generation(older.session_dir)).toBe(2);
    expect(await archive.saveHtml('web-session://nessuna/sbobina.html', '<p>x</p>', 1)).toMatchObject({ ok: false });

    const renamed = await archive.update(older.session_dir, { name: 'Prima lezione', session_dir: 'web-session://altro' });
    expect(renamed).toMatchObject({ name: 'Prima lezione', session_dir: older.session_dir, html_path: older.html_path });
    expect(await archive.update('web-session://nessuna', { name: 'x' })).toBeNull();
  });

  it('deletes the sbobina with its document, its checkpoint and its folder entries', async () => {
    const factory = new IDBFactory();
    const archive = createWebArchive(factory);
    const checkpoints = createCheckpointStore(factory);
    const kept = await archive.create(input('Resta', '2026-10-20T10:00:00Z'), '<p>a</p>');
    const gone = await archive.create(input('Via', '2026-10-21T10:00:00Z'), '<p>b</p>');
    await checkpoints.save({ ...newSession('kept', identity, defaultSettings('gemini-2.5-flash')), archiveSessionDir: kept.session_dir });
    await checkpoints.save({ ...newSession('gone', identity, defaultSettings('gemini-2.5-flash')), archiveSessionDir: gone.session_dir });
    await archive.saveFolders([{ id: 'f', name: 'Corso', color: '', session_dirs: [kept.session_dir, gone.session_dir] }]);

    expect(await archive.delete(gone.session_dir)).toBe(true);
    expect(await archive.delete(gone.session_dir)).toBe(false);
    expect((await archive.list()).map(session => session.session_dir)).toEqual([kept.session_dir]);
    expect(await archive.readHtml(gone.html_path)).toBeNull();
    expect(await archive.generation(gone.html_path)).toBeNull();
    expect(await checkpoints.get('gone')).toBeNull();
    expect(await checkpoints.get('kept')).not.toBeNull();
    expect(await archive.loadFolders()).toEqual([{ id: 'f', name: 'Corso', color: '', session_dirs: [kept.session_dir] }]);

    // The UI sends the whole tree: folders it left out are gone.
    await archive.saveFolders([{ id: 'g', name: 'Altro', color: '#fff', session_dirs: [] }]);
    expect((await archive.loadFolders()).map(folder => folder.id)).toEqual(['g']);
  });

  it('keeps a sbobina restored while "Svuota cestino" or the trash expiry runs', async () => {
    // Regression: both listed the trash first and then deleted each listed sbobina, also one that a
    // Drive round had restored in the meantime (a restore made on another device): it was lost here
    // and its deletion went to Drive.
    const factory = new IDBFactory();
    const archive = createWebArchive(factory);
    const trashedAt = new Date(Date.parse('2026-10-01T10:00:00Z')).toISOString();
    const now = new Date(Date.parse(trashedAt) + (TRASH_DAYS + 1) * 24 * 60 * 60 * 1000);
    const trashed = async (name: string) => {
      const session = await archive.create(input(name, '2026-09-20T10:00:00Z'), `<p>${name}</p>`);
      await archive.trash(session.session_dir, trashedAt);
      return session;
    };
    // The first deletion of the loop gives the round its moment to restore the other sbobina.
    const restoringDuring = (first: string, restored: string): WebArchive => ({
      ...archive,
      delete: async (sessionDir, changedAt, since) => {
        if (sessionDir === first) await archive.restore(restored);
        return archive.delete(sessionDir, changedAt, since);
      },
    });

    for (const run of [
      (target: WebArchive) => emptyTrash(target),
      (target: WebArchive) => purgeExpiredTrash(target, now),
    ]) {
      const one = await trashed('Uno');
      const two = await trashed('Due');
      const [first, other] = (await archive.listTrash()).map(session => session.session_dir);
      const restored = other === one.session_dir ? one : two;
      expect(await run(restoringDuring(first, restored.session_dir))).toBe(1);
      expect(await archive.listTrash()).toEqual([]);
      expect((await archive.list()).map(session => session.session_dir)).toEqual([restored.session_dir]);
      expect(await archive.readHtml(restored.html_path)).toContain(`<p>${restored.name}</p>`);
      await archive.delete(restored.session_dir);
    }
  });

  it('writes each change and its sync mark in one transaction: a mark that fails leaves the change undone', async () => {
    // A Drive round reads the archive between any two transactions: a change it finds without its
    // mark it takes for an old text and overwrites with Drive's.
    const factory = new IDBFactory();
    const plain = createWebArchive(factory);
    const session = await plain.create(input('Lezione', '2026-10-20T10:00:00Z'), '<p>prima</p>');
    await plain.saveFolders([{ id: 'f', name: 'Corso', color: '', session_dirs: [] }]);
    const failing = createWebArchive(factory, {
      store: SYNC,
      session: async () => { throw new Error('segno non scritto'); },
      folders: async () => { throw new Error('segno non scritto'); },
    });

    await expect(failing.create(input('Nuova', '2026-10-21T10:00:00Z'), '<p>x</p>')).rejects.toThrow();
    expect(await failing.saveHtml(session.html_path, '<p>dopo</p>', 5)).toMatchObject({ ok: false });
    await expect(failing.update(session.session_dir, { name: 'Rinominata' })).rejects.toThrow();
    await expect(failing.trash(session.session_dir, '2026-10-22T10:00:00Z')).rejects.toThrow();
    await expect(failing.delete(session.session_dir)).rejects.toThrow();
    await expect(failing.saveFolders([])).rejects.toThrow();

    expect((await plain.list()).map(item => item.name)).toEqual(['Lezione']);
    expect(await plain.readHtml(session.html_path)).toContain('<p>prima</p>');
    expect(await plain.loadFolders()).toEqual([{ id: 'f', name: 'Corso', color: '', session_dirs: [] }]);

    await plain.trash(session.session_dir, '2026-10-22T10:00:00Z');
    await expect(failing.restore(session.session_dir)).rejects.toThrow();
    expect((await plain.listTrash()).map(item => item.name)).toEqual(['Lezione']);
  });

  it('searches the plain text of the documents', async () => {
    const archive = createWebArchive(new IDBFactory());
    const one = await archive.create(input('Nefrone', '2026-10-20T10:00:00Z'), '<h1>Il nefrone</h1><p>Il <b>nefrone</b> filtra. Nefrone ancora.</p>');
    await archive.create(input('Cuore', '2026-10-21T10:00:00Z'), '<p>Il cuore pompa.</p>');

    const [result, ...rest] = await archive.search('  NEFRONE ');
    expect(rest).toEqual([]);
    expect(result).toMatchObject({ session_dir: one.session_dir, name: 'Nefrone', html_path: one.html_path, match_count: 3 });
    expect(result.snippets[1]).toEqual({ before: 'Il nefrone Il ', match: 'nefrone', after: ' filtra. Nefrone ancora.' });
    expect(await archive.search('   ')).toEqual([]);
    expect(await archive.search('il', 1)).toHaveLength(1);
  });

  it('asks for persistent storage only when the site is not persisted yet', async () => {
    let persisted = false;
    const calls: string[] = [];
    const storage = {
      persisted: async () => persisted,
      persist: async () => { calls.push('persist'); persisted = true; return true; },
    } as unknown as StorageManager;
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(calls).toEqual(['persist']);
    expect(await requestPersistentStorage(undefined)).toBe(false);
    expect(await requestPersistentStorage({ persist: async () => { throw new Error('no'); } } as unknown as StorageManager)).toBe(false);
  });
});

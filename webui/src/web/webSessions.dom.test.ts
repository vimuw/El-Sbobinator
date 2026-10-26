import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ArchiveSession } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';
import { createCheckpointStore } from './checkpointStore';
import { defaultSettings } from './pipeline/run';
import { newSession } from './pipeline/session';
import { WEB_DB_NAME, openWebDatabase } from './webDatabase';
import { createWebArchive, requestPersistentStorage, webSessionHtmlPath, type NewArchiveSession } from './webSessions';

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
    expect((await openWebDatabase(factory)).version).toBe(3);
    expect((await openWebDatabase(factory)).objectStoreNames.contains('media')).toBe(true);
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

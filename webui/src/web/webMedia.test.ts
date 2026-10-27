import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { WEB_DB_NAME, openWebDatabase } from './webDatabase';
import { createWebMediaStore, mediaType } from './webMedia';
import { createWebArchive } from './webSessions';

const lecture = (name = 'Lezione.m4a', bytes = 4) => new File([new Uint8Array(bytes).fill(7)], name, { type: '', lastModified: 1_700_000_000_000 });

/** The database as M2 created it: version 2, before the media store. */
function openV2(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WEB_DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('checkpoints', { keyPath: 'id' }).createIndex('byFile', 'fileKey');
      db.createObjectStore('sessions', { keyPath: 'session_dir' });
      db.createObjectStore('documents', { keyPath: 'session_dir' });
      db.createObjectStore('folders', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('audio kept in the browser', () => {
  it('adds the media store to an M2 database, keeping the archive', async () => {
    const factory = new IDBFactory();
    const v2 = await openV2(factory);
    await new Promise<void>((resolve, reject) => {
      const transaction = v2.transaction('sessions', 'readwrite');
      transaction.objectStore('sessions').put({ session_dir: 'web-session://a', name: 'A', html_path: 'web-session://a/sbobina.html', completed_at_iso: '', effective_model: '', input_path: '' });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    v2.close();

    const db = await openWebDatabase(factory);
    expect(db.version).toBe(3);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(['checkpoints', 'documents', 'folders', 'media', 'sessions']);
    expect((await createWebArchive(factory).list()).map(session => session.name)).toEqual(['A']);
  });

  it('gives back the file with its name, date and a playable type after a reload', async () => {
    const factory = new IDBFactory();
    await createWebMediaStore(factory).save('q1', lecture());

    const again = createWebMediaStore(factory);
    expect(await again.has('q1')).toBe(true);
    expect(await again.has('other')).toBe(false);
    const file = await again.get('q1');
    expect(file).toMatchObject({ name: 'Lezione.m4a', size: 4, type: 'audio/mp4', lastModified: 1_700_000_000_000 });
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(new Uint8Array(4).fill(7));
    expect(await again.get('other')).toBeNull();
  });

  it('links one audio per sbobina and removes it with the sbobina', async () => {
    const factory = new IDBFactory();
    const media = createWebMediaStore(factory);
    const archive = createWebArchive(factory);
    const session = await archive.create({ name: 'Fisiologia', completed_at_iso: '2026-10-22T10:00:00Z', effective_model: 'gemini-2.5-flash', input_path: 'local://q1/Lezione.m4a' }, '<p>x</p>');
    await media.save('q1', lecture());
    await media.save('q2', lecture('Nuova.mp3'));

    expect(await media.link('missing', session.session_dir)).toBe(false);
    expect(await media.link('q1', session.session_dir)).toBe(true);
    expect((await media.forSession(session.session_dir))?.name).toBe('Lezione.m4a');
    // A new audio replaces the old copy instead of keeping both.
    expect(await media.link('q2', session.session_dir)).toBe(true);
    expect((await media.forSession(session.session_dir))?.name).toBe('Nuova.mp3');
    expect(await media.has('q1')).toBe(false);

    expect(await archive.delete(session.session_dir)).toBe(true);
    expect(await media.has('q2')).toBe(false);
    expect(await media.forSession(session.session_dir)).toBeNull();
  });

  it('removes the audio of a sbobina on request', async () => {
    const media = createWebMediaStore(new IDBFactory());
    await media.save('q1', lecture());
    await media.link('q1', 'web-session://a');
    await media.unlinkSession('web-session://a');
    expect(await media.has('q1')).toBe(false);
  });

  it('removes a queue copy at once but never the audio a sbobina keeps', async () => {
    const media = createWebMediaStore(new IDBFactory());
    await media.save('queued', lecture());
    await media.save('kept', lecture());
    await media.link('kept', 'web-session://a');

    await media.remove('queued');
    await media.remove('kept');
    await media.remove('missing');
    expect(await media.has('queued')).toBe(false);
    expect((await media.forSession('web-session://a'))?.name).toBe('Lezione.m4a');
  });

  it('prunes only old queue copies the queue no longer lists', async () => {
    const media = createWebMediaStore(new IDBFactory());
    await media.save('gone', lecture(), 1_000);
    await media.save('queued', lecture(), 1_000);
    await media.save('linked', lecture(), 1_000);
    await media.save('recent', lecture(), 5_000);
    await media.link('linked', 'web-session://a');

    expect(await media.prune(new Set(['queued']), 2_000)).toBe(1);
    expect(await media.has('gone')).toBe(false);
    expect(await media.has('queued')).toBe(true);
    expect(await media.has('linked')).toBe(true);
    expect(await media.has('recent')).toBe(true);
  });

  it('names a type the media element accepts when the browser left it empty', () => {
    expect(mediaType('a.MP3', '')).toBe('audio/mpeg');
    expect(mediaType('a.m4a', '')).toBe('audio/mp4');
    expect(mediaType('a.mp4', '')).toBe('video/mp4');
    expect(mediaType('a.m4a', 'audio/x-m4a')).toBe('audio/x-m4a');
  });
});

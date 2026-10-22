import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createCheckpointStore } from './checkpointStore';
import { SPIKE_SESSIONS, WEB_DB_NAME, WEB_DB_VERSION, openWebDatabase } from './webDatabase';
import { createWebArchive } from './webSessions';

/** The database the spike left in a browser: version 1, one `sessions` store keyed by id. */
function openSpike(factory: IDBFactory): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WEB_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('sessions', { keyPath: 'id' }).put({ id: 'spike-1', text: 'trascrizione dello spike' });
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

describe('web database', () => {
  it("opens over the spike's database on the same origin, keeping its data aside", async () => {
    const factory = new IDBFactory();
    await openSpike(factory);

    const db = await openWebDatabase(factory);
    expect(db.version).toBe(WEB_DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['checkpoints', 'documents', 'folders', 'media', 'sessions', SPIKE_SESSIONS].sort());

    const archive = createWebArchive(factory);
    const session = await archive.create({ name: 'Nuova', completed_at_iso: '2026-10-22T10:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' }, '<p>ok</p>');
    expect((await archive.list()).map(item => item.session_dir)).toEqual([session.session_dir]);
    expect(await createCheckpointStore(factory).findByArchive(session.session_dir)).toBeNull();

    const spike = await new Promise(resolve => {
      const request = db.transaction(SPIKE_SESSIONS).objectStore(SPIKE_SESSIONS).get('spike-1');
      request.onsuccess = () => resolve(request.result);
    });
    expect(spike).toEqual({ id: 'spike-1', text: 'trascrizione dello spike' });
  });
});

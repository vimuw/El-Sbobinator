import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasMovedAddressNotice, setMovedAddressNotice } from '../movedAddress';
import { STORAGE_KEYS } from '../storageKeys';
import { createCheckpointStore } from './checkpointStore';
import { applyCanonicalOrigin, canonicalUrl, decideCanonicalOrigin, isOldWebHost, readArchiveState } from './canonicalOrigin';
import { defaultSettings } from './pipeline/run';
import { newSession } from './pipeline/session';
import { createWebArchive } from './webSessions';

function memoryStorage(values: Record<string, string> = {}): Pick<Storage, 'getItem'> {
  return { getItem: key => values[key] ?? null };
}

function fakeLocation(hostname: string, pathname = '/', search = '', hash = '') {
  return { hostname, pathname, search, hash, replace: vi.fn() };
}

afterEach(() => setMovedAddressNotice(false));

describe('official web address', () => {
  it('moves only the two old addresses, never branch previews, localhost or other hosts', () => {
    expect(isOldWebHost('www.elsbobinator.com')).toBe(true);
    expect(isOldWebHost('elsbobinator.pages.dev')).toBe(true);
    expect(isOldWebHost('WWW.ElSbobinator.com.')).toBe(true);
    for (const host of ['elsbobinator.com', 'web-m4.elsbobinator.pages.dev', 'prova-drive.elsbobinator.pages.dev',
      'el-sbobinator-web.pages.dev', 'localhost', '127.0.0.1', 'xwww.elsbobinator.com', 'www.elsbobinator.com.evil.test']) {
      expect(isOldWebHost(host), host).toBe(false);
    }
  });

  it('leaves the Drive return page on the official address alone, its answer included', async () => {
    const location = fakeLocation('elsbobinator.com', '/drive-auth', '', '#state=abc&access_token=t');
    await expect(applyCanonicalOrigin(location, new IDBFactory(), memoryStorage())).resolves.toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
    expect(hasMovedAddressNotice()).toBe(false);
  });

  it('redirects an empty browser, warns one with sbobine and does nothing when unsure', () => {
    expect(decideCanonicalOrigin('www.elsbobinator.com', 'empty')).toBe('redirect');
    expect(decideCanonicalOrigin('elsbobinator.pages.dev', 'has-data')).toBe('notice');
    expect(decideCanonicalOrigin('elsbobinator.pages.dev', 'unknown')).toBe('none');
    expect(decideCanonicalOrigin('elsbobinator.com', 'empty')).toBe('none');
    expect(decideCanonicalOrigin('web-m4.elsbobinator.pages.dev', 'empty')).toBe('none');
    expect(decideCanonicalOrigin('localhost', 'has-data')).toBe('none');
  });

  it('keeps the path, the query and the hash', () => {
    expect(canonicalUrl({ pathname: '/', search: '', hash: '' })).toBe('https://elsbobinator.com/');
    expect(canonicalUrl({ pathname: '/privacy', search: '?simulazione=1', hash: '#editor' }))
      .toBe('https://elsbobinator.com/privacy?simulazione=1#editor');
  });
});

describe('archive state of this address', () => {
  it('is empty in a new browser', async () => {
    expect(await readArchiveState(new IDBFactory(), memoryStorage())).toBe('empty');
    expect(await readArchiveState(new IDBFactory(), memoryStorage({ [STORAGE_KEYS.QUEUE_V1]: '[]' }))).toBe('empty');
  });

  it('counts sbobine, raccolte, run progress and the saved queue', async () => {
    const withSession = new IDBFactory();
    await createWebArchive(withSession).create({ name: 'Lezione', input_name: 'Lezione.mp3', completed_at_iso: '2026-10-27T10:00:00Z', effective_model: 'gemini-2.5-flash', input_path: '', completion_status: 'completed' }, '<p>testo</p>');
    expect(await readArchiveState(withSession, memoryStorage())).toBe('has-data');

    const withFolder = new IDBFactory();
    await createWebArchive(withFolder).saveFolders([{ id: 'f1', name: 'Fisiologia', color: '', parent_id: null, session_dirs: [] }]);
    expect(await readArchiveState(withFolder, memoryStorage())).toBe('has-data');

    const withCheckpoint = new IDBFactory();
    await createCheckpointStore(withCheckpoint).save(newSession('s', { name: 'Lezione.mp3', size: 10, headHash: 'ab' }, defaultSettings('gemini-2.5-flash')));
    expect(await readArchiveState(withCheckpoint, memoryStorage())).toBe('has-data');

    const queue = memoryStorage({ [STORAGE_KEYS.QUEUE_V1]: JSON.stringify([{ id: 'a', name: 'Lezione.mp3', status: 'queued' }]) });
    expect(await readArchiveState(new IDBFactory(), queue)).toBe('has-data');
    expect(await readArchiveState(new IDBFactory(), memoryStorage({ [STORAGE_KEYS.QUEUE_V1]: '{rotto' }))).toBe('has-data');
  });

  it('is unknown when the archive cannot be opened', async () => {
    expect(await readArchiveState(undefined, memoryStorage())).toBe('unknown');
  });
});

describe('before the web app mounts', () => {
  it('leaves an empty old address for the same page on elsbobinator.com', async () => {
    const location = fakeLocation('www.elsbobinator.com', '/', '?simulazione=1');
    expect(await applyCanonicalOrigin(location, new IDBFactory(), memoryStorage())).toBe(true);
    expect(location.replace).toHaveBeenCalledWith('https://elsbobinator.com/?simulazione=1');
    expect(hasMovedAddressNotice()).toBe(false);
  });

  it('stays on an old address with sbobine and turns the notice on', async () => {
    const location = fakeLocation('elsbobinator.pages.dev');
    const queue = memoryStorage({ [STORAGE_KEYS.QUEUE_V1]: JSON.stringify([{ id: 'a' }]) });
    expect(await applyCanonicalOrigin(location, new IDBFactory(), queue)).toBe(false);
    expect(location.replace).not.toHaveBeenCalled();
    expect(hasMovedAddressNotice()).toBe(true);
  });

  it('reads nothing on the official address or a preview', async () => {
    for (const host of ['elsbobinator.com', 'web-m4.elsbobinator.pages.dev', 'localhost']) {
      const location = fakeLocation(host);
      const storage = { getItem: vi.fn(() => null) };
      // No IndexedDB at all: reading it would have answered 'unknown', not crashed, but must not happen.
      expect(await applyCanonicalOrigin(location, undefined, storage)).toBe(false);
      expect(storage.getItem).not.toHaveBeenCalled();
      expect(location.replace).not.toHaveBeenCalled();
      expect(hasMovedAddressNotice()).toBe(false);
    }
  });
});

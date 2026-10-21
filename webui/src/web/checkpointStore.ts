import { fileKey, type CheckpointStore, type FileIdentity, type SessionState } from './pipeline/session';

// Pipeline checkpoints in IndexedDB: one record per sbobina, found again by the audio file's
// identity (name + size + SHA-256 of the first MiB) when the file is reselected after a reload.
// M2 adds the archive to the same database with a version upgrade.
export const WEB_DB_NAME = 'el-sbobinator-web';
const DB_VERSION = 1;
const CHECKPOINTS = 'checkpoints';
const BY_FILE = 'byFile';

type StoredCheckpoint = SessionState & { fileKey: string };

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(WEB_DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(CHECKPOINTS, { keyPath: 'id' });
      store.createIndex(BY_FILE, 'fileKey');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function createCheckpointStore(factory: IDBFactory = indexedDB): CheckpointStore {
  let database: Promise<IDBDatabase> | null = null;
  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    database ??= openDatabase(factory);
    return database.then(db => new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(CHECKPOINTS, mode);
      const request = body(transaction.objectStore(CHECKPOINTS));
      // Resolve on commit, so a saved checkpoint is really on disk.
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error ?? new Error('Salvataggio annullato dal browser.'));
    }));
  };
  const strip = (stored: StoredCheckpoint | undefined): SessionState | null => {
    if (!stored) return null;
    const { fileKey: _fileKey, ...state } = stored;
    return state;
  };

  return {
    async findByFile(file: FileIdentity) {
      const matches = await run('readonly', store => store.index(BY_FILE).getAll(fileKey(file)) as IDBRequest<StoredCheckpoint[]>);
      matches.sort((a, b) => b.updatedAt - a.updatedAt);
      return strip(matches[0]);
    },
    async get(id: string) {
      return strip(await run('readonly', store => store.get(id) as IDBRequest<StoredCheckpoint | undefined>));
    },
    async save(state: SessionState) {
      await run('readwrite', store => store.put({ ...state, fileKey: fileKey(state.file) }));
    },
    async delete(id: string) {
      await run('readwrite', store => store.delete(id));
    },
  };
}

import { fileKey, type CheckpointStore, type FileIdentity, type SessionState } from './pipeline/session';
import { CHECKPOINTS, CHECKPOINTS_BY_FILE, inTransaction, requestValue } from './webDatabase';

// Pipeline checkpoints in IndexedDB: one record per sbobina, found again by the audio file's
// identity (name + size + SHA-256 of the first MiB) when the file is reselected after a reload.

type StoredCheckpoint = SessionState & { fileKey: string };

export function createCheckpointStore(factory: IDBFactory | undefined = globalThis.indexedDB): CheckpointStore {
  const run = <T>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> =>
    inTransaction(factory, CHECKPOINTS, mode, transaction => requestValue(body(transaction.objectStore(CHECKPOINTS))));
  const strip = (stored: StoredCheckpoint | undefined): SessionState | null => {
    if (!stored) return null;
    const { fileKey: _fileKey, ...state } = stored;
    return state;
  };

  return {
    async findByFile(file: FileIdentity) {
      const matches = await run('readonly', store => store.index(CHECKPOINTS_BY_FILE).getAll(fileKey(file)) as IDBRequest<StoredCheckpoint[]>);
      matches.sort((a, b) => b.updatedAt - a.updatedAt);
      return strip(matches[0]);
    },
    async findByArchive(sessionDir: string) {
      const all = await run('readonly', store => store.getAll() as IDBRequest<StoredCheckpoint[]>);
      return strip(all.find(state => state.archiveSessionDir === sessionDir));
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

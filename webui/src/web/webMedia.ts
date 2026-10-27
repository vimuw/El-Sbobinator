import { MEDIA, MEDIA_BY_SESSION, inTransaction, requestValue } from './webDatabase';

// Audio files kept in this browser (IndexedDB store `media`, one record per picked file): a queued
// file survives a reload while it is processed, and a sbobina keeps its lecture only when the user
// asks for it in the editor. The original file is stored as it is: MP3/M4A plays and seeks in every
// browser, Safari included. A record without sessionDir belongs to the queue; linking it to a
// sbobina keeps it until the sbobina is deleted or the user stops keeping its audio.

export interface StoredMedia {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: number;
  blob: Blob;
  addedAt: number;
  sessionDir?: string;
}

export interface WebMediaStore {
  save(id: string, file: File, now?: number): Promise<void>;
  /** The stored file, with its name and type, or null when it is not in this browser. */
  get(id: string): Promise<File | null>;
  has(id: string): Promise<boolean>;
  forSession(sessionDir: string): Promise<File | null>;
  /** Makes id the audio of sessionDir (replacing any other); false when id is not stored. */
  link(id: string, sessionDir: string): Promise<boolean>;
  /** Removes the audio of sessionDir. */
  unlinkSession(sessionDir: string): Promise<void>;
  /** Removes the queue copy id; a copy linked to a sbobina stays. */
  remove(id: string): Promise<void>;
  /** Removes queue copies not in keepIds and added before `before`; returns how many. */
  prune(keepIds: ReadonlySet<string>, before: number): Promise<number>;
}

const MIME_BY_EXTENSION: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4' };

/** A type the media element can rely on: some browsers leave it empty for .m4a. */
export function mediaType(name: string, type: string): string {
  if (type) return type;
  return MIME_BY_EXTENSION[name.toLowerCase().split('.').pop() ?? ''] ?? 'application/octet-stream';
}

function asFile(record: StoredMedia): File {
  return new File([record.blob], record.name, { type: mediaType(record.name, record.type), lastModified: record.lastModified });
}

export function createWebMediaStore(factory: IDBFactory | undefined = globalThis.indexedDB): WebMediaStore {
  const getRecord = (transaction: IDBTransaction, id: string) =>
    requestValue(transaction.objectStore(MEDIA).get(id) as IDBRequest<StoredMedia | undefined>);
  const sessionRecords = (transaction: IDBTransaction, sessionDir: string) =>
    requestValue(transaction.objectStore(MEDIA).index(MEDIA_BY_SESSION).getAll(sessionDir) as IDBRequest<StoredMedia[]>);

  return {
    async save(id, file, now = Date.now()) {
      await inTransaction(factory, MEDIA, 'readwrite', transaction => {
        transaction.objectStore(MEDIA).put({
          id,
          name: file.name,
          type: file.type,
          size: file.size,
          lastModified: file.lastModified,
          blob: file,
          addedAt: now,
        } satisfies StoredMedia);
      });
    },

    async get(id) {
      const record = await inTransaction(factory, MEDIA, 'readonly', transaction => getRecord(transaction, id));
      return record ? asFile(record) : null;
    },

    async has(id) {
      const key = await inTransaction(factory, MEDIA, 'readonly', transaction =>
        requestValue(transaction.objectStore(MEDIA).getKey(id)));
      return key !== undefined;
    },

    async forSession(sessionDir) {
      const records = await inTransaction(factory, MEDIA, 'readonly', transaction => sessionRecords(transaction, sessionDir));
      return records.length ? asFile(records[0]) : null;
    },

    async link(id, sessionDir) {
      return inTransaction(factory, MEDIA, 'readwrite', async transaction => {
        const record = await getRecord(transaction, id);
        if (!record) return false;
        const store = transaction.objectStore(MEDIA);
        for (const other of await sessionRecords(transaction, sessionDir)) {
          if (other.id !== id) store.delete(other.id);
        }
        store.put({ ...record, sessionDir } satisfies StoredMedia);
        return true;
      });
    },

    async unlinkSession(sessionDir) {
      await inTransaction(factory, MEDIA, 'readwrite', async transaction => {
        const store = transaction.objectStore(MEDIA);
        for (const record of await sessionRecords(transaction, sessionDir)) store.delete(record.id);
      });
    },

    async remove(id) {
      await inTransaction(factory, MEDIA, 'readwrite', async transaction => {
        const record = await getRecord(transaction, id);
        if (record && !record.sessionDir) transaction.objectStore(MEDIA).delete(id);
      });
    },

    async prune(keepIds, before) {
      return inTransaction(factory, MEDIA, 'readwrite', async transaction => {
        const store = transaction.objectStore(MEDIA);
        const records = await requestValue(store.getAll() as IDBRequest<StoredMedia[]>);
        let removed = 0;
        for (const record of records) {
          if (record.sessionDir || keepIds.has(record.id) || record.addedAt >= before) continue;
          store.delete(record.id);
          removed += 1;
        }
        return removed;
      });
    },
  };
}

import type { ArchiveFolder, ArchiveSession, SearchSessionResult } from '../bridge';
import { CHECKPOINTS, DOCUMENTS, FOLDERS, SESSIONS, inTransaction, requestValue, type StoredDocument } from './webDatabase';

// The web archive in IndexedDB: session metadata (the desktop's session.json), the editor document
// (HTML body + autosave generation) and the folders. Paths are synthetic: web-session://<id> is the
// session folder and web-session://<id>/sbobina.html its document.
export const WEB_SESSION_PREFIX = 'web-session://';
const HTML_FILE = 'sbobina.html';

export type NewArchiveSession = Omit<ArchiveSession, 'session_dir' | 'html_path'>;
export type SaveHtmlResult = { ok: boolean; saved?: boolean; error?: string };

export interface WebArchive {
  create(input: NewArchiveSession, body: string): Promise<ArchiveSession>;
  list(): Promise<ArchiveSession[]>;
  /** Full HTML document with its shell, like the desktop's read_html_content. */
  readHtml(path: string): Promise<string | null>;
  saveHtml(path: string, body: string, generation?: number): Promise<SaveHtmlResult>;
  /** Autosave generation of a stored document: 0 until the editor saves it, null when it is gone. */
  generation(path: string): Promise<number | null>;
  update(sessionDir: string, patch: Partial<ArchiveSession>): Promise<ArchiveSession | null>;
  /** Removes the sbobina, its document and its pipeline checkpoint. */
  delete(sessionDir: string): Promise<boolean>;
  loadFolders(): Promise<ArchiveFolder[]>;
  saveFolders(folders: ArchiveFolder[]): Promise<void>;
  search(query: string, limit?: number): Promise<SearchSessionResult[]>;
}

export function webSessionHtmlPath(sessionDir: string): string {
  return `${sessionDir}/${HTML_FILE}`;
}

function sessionDirOf(path: string): string {
  return path.endsWith(`/${HTML_FILE}`) ? path.slice(0, -HTML_FILE.length - 1) : path;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Newest first, like the desktop archive.
function byCompletedDesc(a: ArchiveSession, b: ArchiveSession): number {
  return (b.completed_at_iso || '').localeCompare(a.completed_at_iso || '');
}

function plainText(html: string): string {
  // A space after every block, so words of adjacent paragraphs never merge.
  const spaced = html.replace(/<\/(?:p|h[1-6]|li|div|td|th|blockquote|pre)>|<br\s*\/?>/gi, '$& ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function storageErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return 'Spazio del browser esaurito: impossibile salvare la sbobina.';
  return `Salvataggio nel browser non riuscito${error instanceof Error && error.message ? `: ${error.message}` : '.'}`;
}

export function createWebArchive(factory: IDBFactory | undefined = globalThis.indexedDB): WebArchive {
  const getSession = (transaction: IDBTransaction, sessionDir: string) =>
    requestValue(transaction.objectStore(SESSIONS).get(sessionDir) as IDBRequest<ArchiveSession | undefined>);
  const getDocument = (transaction: IDBTransaction, sessionDir: string) =>
    requestValue(transaction.objectStore(DOCUMENTS).get(sessionDir) as IDBRequest<StoredDocument | undefined>);

  return {
    async create(input, body) {
      const sessionDir = `${WEB_SESSION_PREFIX}${crypto.randomUUID()}`;
      const session: ArchiveSession = { ...input, session_dir: sessionDir, html_path: webSessionHtmlPath(sessionDir) };
      await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readwrite', transaction => {
        transaction.objectStore(SESSIONS).put(session);
        transaction.objectStore(DOCUMENTS).put({ session_dir: sessionDir, body, generation: 0 } satisfies StoredDocument);
      });
      return session;
    },

    async list() {
      const sessions = await inTransaction(factory, SESSIONS, 'readonly', transaction =>
        requestValue(transaction.objectStore(SESSIONS).getAll() as IDBRequest<ArchiveSession[]>));
      return sessions.sort(byCompletedDesc);
    },

    async readHtml(path) {
      const dir = sessionDirOf(path);
      const [session, document] = await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readonly', transaction =>
        Promise.all([getSession(transaction, dir), getDocument(transaction, dir)]));
      if (!session || !document) return null;
      return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${escapeHtml(session.name)}</title></head><body>${document.body}</body></html>`;
    },

    // Autosave sends the body with a growing generation; an older generation arriving late is ignored.
    async saveHtml(path, body, generation) {
      const dir = sessionDirOf(path);
      try {
        return await inTransaction(factory, DOCUMENTS, 'readwrite', async transaction => {
          const document = await getDocument(transaction, dir);
          if (!document) return { ok: false, error: 'Sbobina non trovata in questo browser.' };
          if (typeof generation === 'number' && generation < document.generation) return { ok: true, saved: false };
          transaction.objectStore(DOCUMENTS).put({
            ...document,
            body,
            generation: typeof generation === 'number' ? generation : document.generation,
          } satisfies StoredDocument);
          return { ok: true, saved: true };
        });
      } catch (error) {
        return { ok: false, error: storageErrorMessage(error) };
      }
    },

    async generation(path) {
      const dir = sessionDirOf(path);
      const document = await inTransaction(factory, DOCUMENTS, 'readonly', transaction => getDocument(transaction, dir));
      return document?.generation ?? null;
    },

    async update(sessionDir, patch) {
      const dir = sessionDirOf(sessionDir);
      return inTransaction(factory, SESSIONS, 'readwrite', async transaction => {
        const session = await getSession(transaction, dir);
        if (!session) return null;
        const next: ArchiveSession = { ...session, ...patch, session_dir: session.session_dir, html_path: session.html_path };
        transaction.objectStore(SESSIONS).put(next);
        return next;
      });
    },

    async delete(sessionDir) {
      const dir = sessionDirOf(sessionDir);
      return inTransaction(factory, [SESSIONS, DOCUMENTS, CHECKPOINTS, FOLDERS], 'readwrite', async transaction => {
        const session = await getSession(transaction, dir);
        if (!session) return false;
        transaction.objectStore(SESSIONS).delete(dir);
        transaction.objectStore(DOCUMENTS).delete(dir);
        // The checkpoint would offer "already done" for a sbobina that no longer exists.
        const checkpoints = transaction.objectStore(CHECKPOINTS);
        const states = await requestValue(checkpoints.getAll() as IDBRequest<Array<{ id: string; archiveSessionDir?: string }>>);
        for (const state of states) {
          if (state.archiveSessionDir === dir) checkpoints.delete(state.id);
        }
        const folders = transaction.objectStore(FOLDERS);
        for (const folder of await requestValue(folders.getAll() as IDBRequest<ArchiveFolder[]>)) {
          if (folder.session_dirs?.includes(dir)) folders.put({ ...folder, session_dirs: folder.session_dirs.filter(item => item !== dir) });
        }
        return true;
      });
    },

    async loadFolders() {
      return inTransaction(factory, FOLDERS, 'readonly', transaction =>
        requestValue(transaction.objectStore(FOLDERS).getAll() as IDBRequest<ArchiveFolder[]>));
    },

    // The UI always sends the whole folder tree.
    async saveFolders(folders) {
      await inTransaction(factory, FOLDERS, 'readwrite', transaction => {
        const store = transaction.objectStore(FOLDERS);
        store.clear();
        for (const folder of folders) store.put(folder);
      });
    },

    async search(query, limit = 50) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const [sessions, documents] = await inTransaction(factory, [SESSIONS, DOCUMENTS], 'readonly', transaction => Promise.all([
        requestValue(transaction.objectStore(SESSIONS).getAll() as IDBRequest<ArchiveSession[]>),
        requestValue(transaction.objectStore(DOCUMENTS).getAll() as IDBRequest<StoredDocument[]>),
      ]));
      const bodies = new Map(documents.map(document => [document.session_dir, document.body]));
      const results: SearchSessionResult[] = [];
      for (const session of sessions.sort(byCompletedDesc)) {
        const text = plainText(bodies.get(session.session_dir) ?? '');
        const lower = text.toLowerCase();
        const snippets: SearchSessionResult['snippets'] = [];
        let count = 0;
        for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + needle.length)) {
          count += 1;
          if (snippets.length < 3) {
            snippets.push({
              before: text.slice(Math.max(0, at - 60), at),
              match: text.slice(at, at + needle.length),
              after: text.slice(at + needle.length, at + needle.length + 60),
            });
          }
        }
        if (count > 0) {
          results.push({ session_dir: session.session_dir, name: session.name, html_path: session.html_path, completed_at_iso: session.completed_at_iso, snippets, match_count: count });
        }
        if (results.length >= limit) break;
      }
      return results;
    },
  };
}

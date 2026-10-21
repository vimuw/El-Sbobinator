import type { ArchiveFolder, ArchiveSession, SearchSessionResult } from '../bridge';
import { STORAGE_KEYS } from '../storageKeys';

// M0 placeholder archive: a small localStorage record so the sample document survives a reload.
// M2 replaces it with IndexedDB (sessions, documents, folders) and storage.persist().
export const WEB_SESSION_PREFIX = 'web-session://';
const HTML_FILE = 'sbobina.html';

type StoredSession = { session: ArchiveSession; body: string; generation: number };
type StoredArchive = { sessions: StoredSession[]; folders: ArchiveFolder[] };

function load(): StoredArchive {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1) || 'null') as Partial<StoredArchive> | null;
    return {
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      folders: Array.isArray(parsed?.folders) ? parsed.folders : [],
    };
  } catch {
    return { sessions: [], folders: [] };
  }
}

function store(archive: StoredArchive): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEYS.WEB_M0_SESSIONS_V1, JSON.stringify(archive));
    return true;
  } catch {
    return false;
  }
}

export function webSessionHtmlPath(sessionDir: string): string {
  return `${sessionDir}/${HTML_FILE}`;
}

function sessionDirOf(path: string): string {
  return path.endsWith(`/${HTML_FILE}`) ? path.slice(0, -HTML_FILE.length - 1) : path;
}

function find(archive: StoredArchive, path: string): StoredSession | undefined {
  const dir = sessionDirOf(path);
  return archive.sessions.find(entry => entry.session.session_dir === dir);
}

export function createWebSession(input: Omit<ArchiveSession, 'session_dir' | 'html_path'>, body: string): ArchiveSession {
  const sessionDir = `${WEB_SESSION_PREFIX}${crypto.randomUUID()}`;
  const session: ArchiveSession = { ...input, session_dir: sessionDir, html_path: webSessionHtmlPath(sessionDir) };
  const archive = load();
  archive.sessions.unshift({ session, body, generation: 0 });
  if (!store(archive)) throw new Error('Spazio del browser esaurito: impossibile salvare la sbobina.');
  return session;
}

export function listWebSessions(limit?: number): ArchiveSession[] {
  const sessions = load().sessions.map(entry => entry.session);
  return typeof limit === 'number' && limit > 0 ? sessions.slice(0, limit) : sessions;
}

export function readWebHtml(path: string): string | null {
  const entry = find(load(), path);
  if (!entry) return null;
  const title = entry.session.name.replace(/[<>&"]/g, '');
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${title}</title></head><body>${entry.body}</body></html>`;
}

// Autosave sends the body with a growing generation; an older generation arriving late is ignored.
export function saveWebHtml(path: string, body: string, generation?: number): { ok: boolean; saved?: boolean; error?: string } {
  const archive = load();
  const entry = find(archive, path);
  if (!entry) return { ok: false, error: 'Sbobina non trovata.' };
  if (typeof generation === 'number' && generation < entry.generation) return { ok: true, saved: false };
  entry.body = body;
  if (typeof generation === 'number') entry.generation = generation;
  return store(archive) ? { ok: true, saved: true } : { ok: false, error: 'Spazio del browser esaurito.' };
}

// Autosave generation of a stored document: 0 until the editor saves it, null when it is gone.
export function webSessionGeneration(path: string): number | null {
  return find(load(), path)?.generation ?? null;
}

export function updateWebSession(sessionDir: string, patch: Partial<ArchiveSession>): ArchiveSession | null {
  const archive = load();
  const entry = find(archive, sessionDir);
  if (!entry) return null;
  entry.session = { ...entry.session, ...patch, session_dir: entry.session.session_dir, html_path: entry.session.html_path };
  return store(archive) ? entry.session : null;
}

export function deleteWebSession(sessionDir: string): boolean {
  const archive = load();
  const next = archive.sessions.filter(entry => entry.session.session_dir !== sessionDirOf(sessionDir));
  if (next.length === archive.sessions.length) return false;
  return store({ ...archive, sessions: next });
}

export function loadWebFolders(): ArchiveFolder[] {
  return load().folders;
}

export function saveWebFolders(folders: ArchiveFolder[]): boolean {
  return store({ ...load(), folders });
}

function plainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}

export function searchWebSessions(query: string, limit = 50): SearchSessionResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const results: SearchSessionResult[] = [];
  for (const { session, body } of load().sessions) {
    const text = plainText(body);
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
}

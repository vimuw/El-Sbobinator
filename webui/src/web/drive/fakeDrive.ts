// An in-memory Google Drive app folder speaking the few REST calls of driveApi.ts, for unit tests
// (as a fetch) and for the Playwright web tests (as a page.route handler). Not part of the app.

import type { DriveAuth, DriveAuthError } from './auth';
import { DRIVE_API, DRIVE_UPLOAD, FOLDER_MIME } from './driveApi';
import { DRIVE_APPDATA_SCOPE, DRIVE_FILE_SCOPE } from './oauth';
import type { TabChannel } from './tabLocks';

export interface FakeDriveRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export interface FakeDriveResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface StoredFile {
  id: string;
  name: string;
  modifiedTime: string;
  content: string;
  parents: string[];
  mimeType: string;
}

export interface FakeDriveOptions {
  /** Tokens granted drive.file, which may create visible files (the export). */
  canWriteVisible?: (token: string) => boolean;
  /** The account this Drive belongs to (about.user.emailAddress). */
  email?: string;
}

/** A token of the fakes that carries drive.file. */
export const FAKE_FILE_TOKEN_MARK = 'drive-file';

export interface FakeDrive {
  handle(request: FakeDriveRequest): FakeDriveResponse;
  fetch: typeof fetch;
  /** Files of the hidden app folder as Drive would list them, with their parsed JSON content. */
  files(): Array<{ id: string; name: string; modifiedTime: string; content: unknown }>;
  /** Visible files and folders (the export), with their raw content. */
  visibleFiles(): Array<{ id: string; name: string; mimeType: string; parents: string[]; content: string }>;
  /** Writes a file as another app version or device would. */
  put(name: string, content: unknown): string;
  /** The next answers, in order, are these errors (429, 403 rateLimitExceeded, 500…). */
  failNext(...errors: Array<{ status: number; reason?: string; retryAfter?: number }>): void;
  /** While offline every request fails like fetch does without a network. */
  setOffline(offline: boolean): void;
  /** Every token seen so far stops working (401), as after an hour. */
  expireTokens(): void;
  requests: Array<{ method: string; url: string }>;
}

function json(status: number, value: unknown, headers: Record<string, string> = {}): FakeDriveResponse {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(value) };
}

function error(status: number, reason?: string): FakeDriveResponse {
  return json(status, { error: { code: status, message: `fake ${status}`, errors: reason ? [{ reason }] : [] } });
}

function multipartParts(body: string, contentType: string): string[] {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1] ?? '';
  return body.split(`--${boundary}`)
    .map(part => part.replace(/^\r\n/, ''))
    .filter(part => part && !part.startsWith('--'))
    .map(part => part.slice(part.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, ''));
}

export function createFakeDrive(options: FakeDriveOptions = {}): FakeDrive {
  const canWriteVisible = options.canWriteVisible ?? (token => token.includes(FAKE_FILE_TOKEN_MARK));
  const stored = new Map<string, StoredFile>();
  const failures: Array<{ status: number; reason?: string; retryAfter?: number }> = [];
  const expired = new Set<string>();
  const seen = new Set<string>();
  const requests: Array<{ method: string; url: string }> = [];
  let offline = false;
  let clock = Date.parse('2026-10-27T08:00:00.000Z');
  let nextId = 1;

  // Drive's clock: always moving forward, so modifiedTime orders every write.
  const tick = () => new Date((clock += 1000)).toISOString();
  const meta = (file: StoredFile) => ({ id: file.id, name: file.name, modifiedTime: file.modifiedTime });
  const inAppData = (file: StoredFile) => file.parents.includes('appDataFolder');

  function handle(request: FakeDriveRequest): FakeDriveResponse {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    requests.push({ method, url: request.url });
    const token = (request.headers.authorization ?? request.headers.Authorization ?? '').replace(/^Bearer\s+/i, '');
    if (!token || expired.has(token)) return error(401, 'authError');
    seen.add(token);
    const failure = failures.shift();
    if (failure) return { ...error(failure.status, failure.reason), headers: failure.retryAfter ? { 'retry-after': String(failure.retryAfter) } : {} };

    const path = `${url.origin}${url.pathname}`;
    if (path === `${DRIVE_API}/about`) return json(200, { user: { emailAddress: options.email ?? 'studente@example.com' } });
    if (path === `${DRIVE_API}/files` && method === 'GET') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return error(400);
      const since = /modifiedTime > '([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1];
      const files = [...stored.values()].filter(file => inAppData(file) && (!since || file.modifiedTime > since)).map(meta);
      return json(200, { files });
    }
    if (path === `${DRIVE_API}/files` && method === 'POST') {
      const { name, mimeType, parents } = JSON.parse(request.body ?? '{}') as { name: string; mimeType?: string; parents?: string[] };
      if (!canWriteVisible(token) || mimeType !== FOLDER_MIME) return error(403, 'insufficientPermissions');
      const file = { id: `folder-${nextId++}`, name, modifiedTime: tick(), content: '', parents: parents ?? ['root'], mimeType };
      stored.set(file.id, file);
      return json(200, { ...meta(file), webViewLink: `https://drive.google.com/drive/folders/${file.id}` });
    }
    if (path === `${DRIVE_UPLOAD}/files` && method === 'POST') {
      const [metadata, content] = multipartParts(request.body ?? '', request.headers['content-type'] ?? request.headers['Content-Type'] ?? '');
      const { name, parents, mimeType } = JSON.parse(metadata) as { name: string; parents?: string[]; mimeType?: string };
      const visible = !parents?.includes('appDataFolder');
      if (visible && (!canWriteVisible(token) || !parents?.every(parent => stored.has(parent)))) return error(403, 'insufficientPermissions');
      const file = { id: `file-${nextId++}`, name, modifiedTime: tick(), content, parents: parents ?? [], mimeType: mimeType ?? '' };
      stored.set(file.id, file);
      return json(200, meta(file));
    }
    const fileId = decodeURIComponent(url.pathname.split('/').pop() ?? '');
    const file = stored.get(fileId);
    if (!file) return error(404, 'notFound');
    if (path.startsWith(`${DRIVE_UPLOAD}/files/`) && method === 'PATCH') {
      file.content = request.body ?? '';
      file.modifiedTime = tick();
      return json(200, meta(file));
    }
    if (path.startsWith(`${DRIVE_API}/files/`) && method === 'GET' && url.searchParams.get('alt') === 'media') {
      return { status: 200, headers: { 'content-type': 'application/json' }, body: file.content };
    }
    if (path.startsWith(`${DRIVE_API}/files/`) && method === 'DELETE') {
      stored.delete(fileId);
      return { status: 204, headers: {}, body: '' };
    }
    return error(400);
  }

  const fakeFetch: typeof fetch = async (input, init) => {
    if (offline) throw new TypeError('Failed to fetch');
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const answer = handle({ url: String(input), method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? init.body : null });
    return new Response(answer.status === 204 ? null : answer.body, { status: answer.status, headers: answer.headers });
  };

  return {
    handle,
    fetch: fakeFetch,
    files: () => [...stored.values()].filter(inAppData).map(file => ({ ...meta(file), content: JSON.parse(file.content) as unknown })),
    visibleFiles: () => [...stored.values()].filter(file => !inAppData(file))
      .map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, parents: file.parents, content: file.content })),
    put(name, content) {
      const existing = [...stored.values()].find(file => file.name === name && inAppData(file));
      const file = existing ?? { id: `file-${nextId++}`, name, modifiedTime: '', content: '', parents: ['appDataFolder'], mimeType: 'application/json' };
      file.content = JSON.stringify(content);
      file.modifiedTime = tick();
      stored.set(file.id, file);
      return file.id;
    },
    failNext: (...errors) => { failures.push(...errors); },
    setOffline: value => { offline = value; },
    expireTokens: () => { for (const token of seen) expired.add(token); },
    requests,
  };
}

/**
 * A Google login that answers at once, for the tests of what sits above auth.ts. Tabs of one browser
 * pass the same `shared` object: the account is remembered for all of them, each keeps its token.
 */
export function createFakeAuth(device: string, initial: { token?: boolean; email?: string | null; shared?: { email: string | null } } = {}) {
  let count = 0;
  let token: string | null = initial.token ? `${device}-0` : null;
  const remembered = initial.shared ?? { email: null };
  if (initial.email !== undefined || !initial.shared) remembered.email = initial.email ?? null;
  let owner = token ? remembered.email : null;
  const calls: Array<{ silent: boolean; scope?: string }> = [];
  const failures: DriveAuthError[] = [];
  const disconnects: string[] = [];
  const auth: DriveAuth = {
    token: () => token,
    account: () => remembered.email,
    setAccount: value => {
      remembered.email = value;
      if (token) owner = value;
    },
    tokenAccount: () => (token ? owner : null),
    connect: ({ silent = false, scope, keep = true } = {}) => {
      calls.push({ silent, ...(scope ? { scope } : {}) });
      const failure = failures.shift();
      if (failure) return Promise.reject(failure);
      const issued = scope === DRIVE_FILE_SCOPE ? `${device}-${FAKE_FILE_TOKEN_MARK}-${++count}` : `${device}-${++count}`;
      if (keep) {
        token = issued;
        owner = null;
      }
      // Only the scope asked for: the login does not carry the ones granted before (oauth.ts).
      return Promise.resolve({ accessToken: issued, expiresAt: Date.now() + 3_600_000, scopes: [scope ?? DRIVE_APPDATA_SCOPE] });
    },
    expire: () => { token = null; },
    disconnect: async () => {
      disconnects.push(token ?? '');
      token = null;
      remembered.email = null;
    },
  };
  return { auth, calls, failures, disconnects };
}

/**
 * The Web Locks of one origin, shared by the "tabs" of a test (tabLocks.ts): exclusive locks wait
 * for each other by name, shared ones are granted at once, query() lists what is held.
 */
export function createFakeLocks(): LockManager {
  const held: LockInfo[] = [];
  const queues = new Map<string, Promise<void>>();
  const hold = async <T,>(info: LockInfo, callback: LockGrantedCallback<T>) => {
    held.push(info);
    try {
      return await callback({ name: info.name!, mode: info.mode! } as Lock);
    } finally {
      held.splice(held.indexOf(info), 1);
    }
  };
  const request = async <T,>(name: string, options: LockOptions | LockGrantedCallback<T>, maybeCallback?: LockGrantedCallback<T>) => {
    const callback = (typeof options === 'function' ? options : maybeCallback)!;
    const mode = typeof options === 'function' ? 'exclusive' : options.mode ?? 'exclusive';
    if (mode === 'shared') return hold({ name, mode }, callback);
    const before = queues.get(name) ?? Promise.resolve();
    let done = () => {};
    const mine = new Promise<void>(resolve => { done = resolve; });
    queues.set(name, before.then(() => mine));
    await before;
    try {
      return await hold({ name, mode }, callback);
    } finally {
      done();
    }
  };
  return { request, query: async () => ({ held: [...held], pending: [] }) } as unknown as LockManager;
}

/**
 * The BroadcastChannel of one origin for the "tabs" of a test (tabLocks.ts): each call opens one
 * tab's end; a message reaches the other ends, not the sender's, a moment later.
 */
export function createFakeChannels(): () => TabChannel {
  const ends = new Set<EventTarget>();
  return () => {
    const end = new EventTarget();
    ends.add(end);
    return {
      postMessage: (message: unknown) => {
        for (const other of ends) {
          if (other !== end) queueMicrotask(() => other.dispatchEvent(new MessageEvent('message', { data: message })));
        }
      },
      addEventListener: end.addEventListener.bind(end),
      removeEventListener: end.removeEventListener.bind(end),
    } as TabChannel;
  };
}

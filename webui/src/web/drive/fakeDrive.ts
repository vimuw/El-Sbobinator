// An in-memory Google Drive app folder speaking the few REST calls of driveApi.ts, for unit tests
// (as a fetch) and for the Playwright web tests (as a page.route handler). Not part of the app.

import type { DriveAuth, DriveAuthError } from './auth';
import { DRIVE_API, DRIVE_UPLOAD } from './driveApi';
import { DRIVE_APPDATA_SCOPE } from './oauth';

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
}

export interface FakeDrive {
  handle(request: FakeDriveRequest): FakeDriveResponse;
  fetch: typeof fetch;
  /** Files as Drive would list them, with their parsed JSON content. */
  files(): Array<{ id: string; name: string; modifiedTime: string; content: unknown }>;
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

export function createFakeDrive(): FakeDrive {
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
    if (path === `${DRIVE_API}/about`) return json(200, { user: { emailAddress: 'studente@example.com' } });
    if (path === `${DRIVE_API}/files` && method === 'GET') {
      if (url.searchParams.get('spaces') !== 'appDataFolder') return error(400);
      const since = /modifiedTime > '([^']+)'/.exec(url.searchParams.get('q') ?? '')?.[1];
      const files = [...stored.values()].filter(file => !since || file.modifiedTime > since).map(meta);
      return json(200, { files });
    }
    if (path === `${DRIVE_UPLOAD}/files` && method === 'POST') {
      const [metadata, content] = multipartParts(request.body ?? '', request.headers['content-type'] ?? request.headers['Content-Type'] ?? '');
      const { name, parents } = JSON.parse(metadata) as { name: string; parents?: string[] };
      if (!parents?.includes('appDataFolder')) return error(403, 'insufficientPermissions');
      const file = { id: `file-${nextId++}`, name, modifiedTime: tick(), content };
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
    files: () => [...stored.values()].map(file => ({ ...meta(file), content: JSON.parse(file.content) as unknown })),
    put(name, content) {
      const existing = [...stored.values()].find(file => file.name === name);
      const file = existing ?? { id: `file-${nextId++}`, name, modifiedTime: '', content: '' };
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

/** A Google login that answers at once, for the tests of what sits above auth.ts. */
export function createFakeAuth(device: string, initial: { token?: boolean; email?: string | null } = {}) {
  let count = 0;
  let token: string | null = initial.token ? `${device}-0` : null;
  let email = initial.email ?? null;
  const calls: Array<{ silent: boolean }> = [];
  const failures: DriveAuthError[] = [];
  const disconnects: string[] = [];
  const auth: DriveAuth = {
    token: () => token,
    account: () => email,
    setAccount: value => { email = value; },
    connect: ({ silent = false } = {}) => {
      calls.push({ silent });
      const failure = failures.shift();
      if (failure) return Promise.reject(failure);
      token = `${device}-${++count}`;
      return Promise.resolve({ accessToken: token, expiresAt: Date.now() + 3_600_000, scopes: [DRIVE_APPDATA_SCOPE] });
    },
    expire: () => { token = null; },
    disconnect: async () => {
      disconnects.push(token ?? '');
      token = null;
      email = null;
    },
  };
  return { auth, calls, failures, disconnects };
}

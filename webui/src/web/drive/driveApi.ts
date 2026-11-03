// The Drive v3 REST calls of the sync, on the hidden app folder (appDataFolder, scope
// drive.appdata), plus the few the one-way export needs to create a visible folder and its files
// (scope drive.file: only files this app created). Plain fetch with the bearer token: no Google script, so the page keeps
// script-src 'self'. Quota answers (429, 403 rate limits) and server errors are retried with a
// growing wait, as Google asks.

export const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,modifiedTime';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const MAX_WAIT_MS = 32_000;
// A request that makes no progress for this long (no answer, or a body that stops arriving) has
// stalled. An upload gets more time to be answered, by its size: it goes out before any answer.
export const REQUEST_TIMEOUT_MS = 60_000;
const SLOWEST_UPLOAD_BYTES_PER_SECOND = 16_000;
// Answers that carry no body (a Response with one would not even build).
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

export interface DriveFileMeta {
  id: string;
  name: string;
  /** RFC 3339, Drive's clock: the sync compares these, never the device's clock. */
  modifiedTime: string;
  /** Drive's page of the file (asked for the export's folder only). */
  webViewLink?: string;
}

export class DriveError extends Error {
  constructor(readonly status: number, message: string, readonly reason?: string) {
    super(message);
    this.name = 'DriveError';
  }

  /** 401: the token expired or was revoked, the user must authorize again. */
  get needsAuthorization(): boolean {
    return this.status === 401;
  }

  /** No answer at all: offline, or the request never left the browser. */
  get offline(): boolean {
    return this.status === 0;
  }
}

async function driveError(response: Response): Promise<DriveError> {
  let message = `Google Drive ha risposto ${response.status}`;
  let reason: string | undefined;
  try {
    const body = await response.json() as { error?: { message?: string; errors?: Array<{ reason?: string }> } };
    if (body.error?.message) message = `${message}: ${body.error.message}`;
    reason = body.error?.errors?.[0]?.reason;
  } catch {
    // Not JSON: keep the status only.
  }
  return new DriveError(response.status, message, reason);
}

/** The whole body of an answer; `progress` is called for each part that arrives. */
async function readBody(response: Response, signal: AbortSignal, progress: () => void): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  // Not every body stops on the request's abort: this one does.
  const stop = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', stop, { once: true });
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      progress();
      parts.push(value);
      size += value.byteLength;
    }
  } finally {
    signal.removeEventListener('abort', stop);
  }
  if (signal.aborted) throw new DOMException('Stalled', 'AbortError');
  const body = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }
  return body;
}

/** Whether Google asks to try again later; a create is retried only when it surely did not happen. */
function retryable(error: DriveError, idempotent: boolean): boolean {
  if (error.status === 429) return true;
  if (error.status === 403 && error.reason && RATE_LIMIT_REASONS.has(error.reason)) return true;
  return idempotent && error.status >= 500;
}

export interface DriveApiOptions {
  getToken: () => string | null;
  /** Drive answered 401: the caller forgets the token. */
  onUnauthorized?: () => void;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
  /** A request stalled this long fails like one without a network (default REQUEST_TIMEOUT_MS). */
  timeoutMs?: number;
}

export interface DriveApi {
  accountEmail(): Promise<string>;
  /** Files of the app folder changed after `since` (all of them without it), every page. */
  listChanged(since: string | null): Promise<DriveFileMeta[]>;
  readJson(id: string): Promise<unknown>;
  createJson(name: string, value: unknown): Promise<DriveFileMeta>;
  updateJson(id: string, value: unknown): Promise<DriveFileMeta>;
  remove(id: string): Promise<void>;
  /** A visible folder in My Drive (export only); at the top without a parent. */
  createFolder(name: string, parentId?: string): Promise<DriveFileMeta>;
  /** A visible file in a folder of the export. */
  createFile(name: string, mimeType: string, content: string, parentId: string): Promise<DriveFileMeta>;
}

export function createDriveApi(options: DriveApiOptions): DriveApi {
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const maxAttempts = options.maxAttempts ?? 5;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function call(url: string, init: RequestInit = {}, idempotent = true): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const token = options.getToken();
      if (!token) throw new DriveError(401, 'Non collegato a Google Drive.');
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      let response: Response;
      // A stalled request would hold every round queued after it (driveService.ts).
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stallAfter = (ms: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => abort.abort(), ms);
      };
      const sent = typeof init.body === 'string' ? init.body.length : 0;
      stallAfter(timeoutMs + Math.ceil(sent / SLOWEST_UPLOAD_BYTES_PER_SECOND) * 1000);
      try {
        const answer = await fetchImpl(url, { ...init, headers, signal: abort.signal });
        // Read here, each part of the body restarting the wait: a body that stops arriving stalls too.
        const body = NULL_BODY_STATUSES.has(answer.status) ? null : await readBody(answer, abort.signal, () => stallAfter(timeoutMs));
        response = new Response(body, { status: answer.status, statusText: answer.statusText, headers: answer.headers });
      } catch (error) {
        if (abort.signal.aborted) throw new DriveError(0, 'Google Drive non risponde.');
        throw new DriveError(0, `Google Drive non raggiungibile${error instanceof Error && error.message ? `: ${error.message}` : '.'}`);
      } finally {
        clearTimeout(timer);
      }
      if (response.ok) return response;
      const error = await driveError(response);
      if (error.needsAuthorization) options.onUnauthorized?.();
      if (attempt >= maxAttempts || !retryable(error, idempotent)) throw error;
      const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** (attempt - 1) * 1000 + Math.floor(random() * 1000);
      await sleep(Math.min(wait, MAX_WAIT_MS));
    }
  }

  const json = async <T>(response: Response) => await response.json() as T;

  // Never repeated on a server error: the file may exist already.
  async function upload(metadata: Record<string, unknown>, content: string, contentType: string): Promise<DriveFileMeta> {
    const boundary = `el-sbobinator-${Date.now().toString(36)}`;
    const response = await call(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(boundary, metadata, content, contentType),
    }, false);
    return json<DriveFileMeta>(response);
  }

  function multipartBody(boundary: string, metadata: unknown, content: string, contentType: string): string {
    return [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      `Content-Type: ${contentType}`,
      '',
      content,
      `--${boundary}--`,
      '',
    ].join('\r\n');
  }

  return {
    async accountEmail() {
      const body = await json<{ user?: { emailAddress?: string } }>(await call(`${DRIVE_API}/about?fields=user(emailAddress)`));
      return body.user?.emailAddress ?? '';
    },

    async listChanged(since) {
      const files: DriveFileMeta[] = [];
      let pageToken: string | undefined;
      do {
        const params = new URLSearchParams({
          spaces: 'appDataFolder',
          fields: `nextPageToken,files(${FILE_FIELDS})`,
          pageSize: '1000',
        });
        if (since) params.set('q', `modifiedTime > '${since}'`);
        if (pageToken) params.set('pageToken', pageToken);
        const body = await json<{ files?: DriveFileMeta[]; nextPageToken?: string }>(await call(`${DRIVE_API}/files?${params.toString()}`));
        files.push(...(body.files ?? []));
        pageToken = body.nextPageToken;
      } while (pageToken);
      return files;
    },

    async readJson(id) {
      return json<unknown>(await call(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`));
    },

    async createJson(name, value) {
      return upload({ name, parents: ['appDataFolder'], mimeType: 'application/json' }, JSON.stringify(value), 'application/json; charset=UTF-8');
    },

    async updateJson(id, value) {
      const response = await call(`${DRIVE_UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FILE_FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(value),
      });
      return json<DriveFileMeta>(response);
    },

    async remove(id) {
      await call(`${DRIVE_API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },

    async createFolder(name, parentId) {
      const response = await call(`${DRIVE_API}/files?fields=${FILE_FIELDS},webViewLink`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME, ...(parentId ? { parents: [parentId] } : {}) }),
      }, false);
      return json<DriveFileMeta>(response);
    },

    async createFile(name, mimeType, content, parentId) {
      return upload({ name, mimeType, parents: [parentId] }, content, `${mimeType}; charset=UTF-8`);
    },
  };
}

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

  async function call(url: string, init: RequestInit = {}, idempotent = true): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      const token = options.getToken();
      if (!token) throw new DriveError(401, 'Non collegato a Google Drive.');
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      let response: Response;
      try {
        response = await fetchImpl(url, { ...init, headers });
      } catch (error) {
        throw new DriveError(0, `Google Drive non raggiungibile${error instanceof Error && error.message ? `: ${error.message}` : '.'}`);
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

import { handleDriveRequest, type DriveServerEnv } from './driveServer';

// The Drive login's server half on the web dev server (npm run dev:web:drive): Vite sends every
// other /api request to the desktop backend (vite.config.ts), which has no /api/drive. The same
// handler as the site's Pages Function (functions/api/drive/[action].ts), on Node's request.

export const DRIVE_API_PREFIX = '/api/drive/';

/** What the middleware reads of Node's IncomingMessage. */
export interface DevRequest extends AsyncIterable<Uint8Array | string> {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

/** What the middleware writes on Node's ServerResponse. */
export interface DevResponse {
  statusCode: number;
  setHeader(name: string, value: string | string[]): unknown;
  end(body?: Uint8Array): unknown;
}

export interface DriveDevMiddlewareOptions {
  /** Read at each request: the dev server's environment (GOOGLE_CLIENT_SECRET, DRIVE_COOKIE_KEY). */
  env: () => DriveServerEnv;
  /** The dev server's scheme: https with the LAN certificate (vite.web.lan.config.ts). */
  protocol: () => 'http' | 'https';
  handle?: typeof handleDriveRequest;
}

async function readBody(request: DevRequest): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
  if (!chunks.length) return undefined;
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function toFetchRequest(request: DevRequest, url: string, method: string, body: Uint8Array<ArrayBuffer> | undefined): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name.startsWith(':')) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }
  return new Request(url, { method, headers, body });
}

export function createDriveDevMiddleware(options: DriveDevMiddlewareOptions) {
  const handle = options.handle ?? handleDriveRequest;
  return (request: DevRequest, response: DevResponse, next: (error?: unknown) => void): void => {
    const path = (request.url ?? '').split('?')[0];
    if (!path.startsWith(DRIVE_API_PREFIX)) {
      next();
      return;
    }
    void (async () => {
      const method = (request.method ?? 'GET').toUpperCase();
      const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request);
      const host = String(request.headers.host ?? 'localhost');
      const url = `${options.protocol()}://${host}${request.url}`;
      // As the Pages Function's [action]: one path segment.
      const action = decodeURIComponent(path.slice(DRIVE_API_PREFIX.length));
      const answer = await handle(toFetchRequest(request, url, method, body), options.env(), action);
      response.statusCode = answer.status;
      answer.headers.forEach((value, name) => {
        if (name !== 'set-cookie') response.setHeader(name, value);
      });
      const cookies = answer.headers.getSetCookie();
      if (cookies.length) response.setHeader('Set-Cookie', cookies);
      response.end(new Uint8Array(await answer.arrayBuffer()));
    })().catch(next);
  };
}

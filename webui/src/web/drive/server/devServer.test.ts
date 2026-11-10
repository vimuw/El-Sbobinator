import { afterEach, describe, expect, it, vi } from 'vitest';
import { GOOGLE_AUTH_ENDPOINT } from '../oauth';
import { LOGIN_COOKIE } from './driveServer';
import { createDriveDevMiddleware, type DevRequest, type DevResponse } from './devServer';

const CLIENT_ID = '123456789-abc123def.apps.googleusercontent.com';
const COOKIE_KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index)));
const STATE = '0123456789abcdef0123456789abcdef';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Node's request as the dev server hands it over: headers lower-cased, the body as chunks. */
function nodeRequest(url: string, init: { method?: string; headers?: Record<string, string | string[]>; body?: string[] } = {}): DevRequest {
  const chunks = init.body ?? [];
  return {
    url,
    method: init.method ?? 'GET',
    headers: { host: 'localhost:3001', ...init.headers },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield new TextEncoder().encode(chunk);
    },
  };
}

function nodeResponse() {
  const headers: Record<string, string | string[]> = {};
  let resolveEnd: (body: string) => void = () => {};
  const ended = new Promise<string>(resolve => { resolveEnd = resolve; });
  const response: DevResponse = {
    statusCode: 200,
    setHeader: (name, value) => { headers[name.toLowerCase()] = value; },
    end: body => resolveEnd(body ? new TextDecoder().decode(body) : ''),
  };
  return { response, headers, ended };
}

describe('Drive login on the web dev server', () => {
  it('is served by the dev server itself, before the /api proxy to the desktop backend', async () => {
    // Regression: npm run dev:web:drive sent /api/drive to the backend on :8000, which has none,
    // so no account could ever be linked there.
    vi.stubEnv('EL_SBOBINATOR_GOOGLE_CLIENT_ID', CLIENT_ID);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'segreto-di-prova');
    vi.stubEnv('DRIVE_COOKIE_KEY', COOKIE_KEY);
    const { createViteConfig } = await import('../../../../vite.config');
    const config = createViteConfig('web');
    const plugin = config.plugins?.find(item => item && typeof item === 'object' && 'name' in item && item.name === 'web-dev-drive');
    if (!plugin || typeof plugin !== 'object' || !('configureServer' in plugin) || typeof plugin.configureServer !== 'function') {
      throw new Error('Drive dev server plugin missing');
    }
    expect(plugin).toMatchObject({ apply: 'serve' });
    const use = vi.fn();
    Reflect.apply(plugin.configureServer, undefined, [{ middlewares: { use }, config: { server: {} } }]);
    expect(use).toHaveBeenCalledOnce();
    const middleware = use.mock.calls[0][0] as ReturnType<typeof createDriveDevMiddleware>;

    const { response, headers, ended } = nodeResponse();
    const next = vi.fn();
    middleware(nodeRequest(`/api/drive/start?state=${STATE}`), response, next);
    await ended;
    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(303);
    const location = new URL(String(headers.location));
    expect(`${location.origin}${location.pathname}`).toBe(GOOGLE_AUTH_ENDPOINT);
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3001/api/drive/callback');
    expect(headers['set-cookie']).toEqual([expect.stringMatching(new RegExp(`^${LOGIN_COOKIE}=`))]);
  });

  it('is not there without a client ID, where the site has no Drive either', async () => {
    vi.stubEnv('EL_SBOBINATOR_GOOGLE_CLIENT_ID', '');
    const { createViteConfig } = await import('../../../../vite.config');
    const names = (createViteConfig('web').plugins ?? []).map(item => (item && typeof item === 'object' && 'name' in item ? item.name : null));
    expect(names).not.toContain('web-dev-drive');
  });

  it('leaves every other request to the next middleware (the /api proxy, Vite)', () => {
    const handle = vi.fn();
    const middleware = createDriveDevMiddleware({ env: () => ({}), protocol: () => 'http', handle });
    for (const url of ['/api/sessions', '/api/drivex/token', '/index.html', undefined]) {
      const next = vi.fn();
      middleware(nodeRequest(url as string), nodeResponse().response, next);
      expect(next).toHaveBeenCalledOnce();
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('hands the handler the whole request and writes back every cookie of its answer', async () => {
    const handle = vi.fn(async (request: Request, _env: unknown, action: string) => {
      expect(action).toBe('token');
      expect(request.url).toBe('https://localhost:3001/api/drive/token?x=1');
      expect(request.method).toBe('POST');
      expect(request.headers.get('origin')).toBe('https://localhost:3001');
      expect(request.headers.get('cookie')).toBe('a=1; b=2');
      expect(await request.text()).toBe('uno-due');
      const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      headers.append('Set-Cookie', 'a=; Max-Age=0');
      headers.append('Set-Cookie', 'b=3; Path=/');
      return new Response('{"ok":true}', { status: 201, headers });
    });
    const env = { GOOGLE_CLIENT_ID: CLIENT_ID };
    const middleware = createDriveDevMiddleware({ env: () => env, protocol: () => 'https', handle });
    const { response, headers, ended } = nodeResponse();
    const next = vi.fn();
    middleware(nodeRequest('/api/drive/token?x=1', {
      method: 'post',
      headers: { origin: 'https://localhost:3001', cookie: 'a=1; b=2' },
      body: ['uno-', 'due'],
    }), response, next);
    expect(await ended).toBe('{"ok":true}');
    expect(handle).toHaveBeenCalledWith(expect.any(Request), env, 'token');
    expect(response.statusCode).toBe(201);
    expect(headers['content-type']).toBe('application/json');
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['set-cookie']).toEqual(['a=; Max-Age=0', 'b=3; Path=/']);
    expect(next).not.toHaveBeenCalled();
  });

  it('passes a failure of the handler on to the dev server', async () => {
    const failure = new Error('rotto');
    const middleware = createDriveDevMiddleware({ env: () => ({}), protocol: () => 'http', handle: () => Promise.reject(failure) });
    const next = vi.fn();
    middleware(nodeRequest('/api/drive/token', { method: 'POST' }), nodeResponse().response, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledWith(failure));
  });
});

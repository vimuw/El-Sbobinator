import { describe, expect, it, vi } from 'vitest';
import type { DevRequest } from '../../web/drive/server/devServer';
import { createReportDevMiddleware } from './devServer';
import type { handleReportRequest } from './tunnel';

const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.de.sentry.io/456';

function nodeRequest(url: string, method = 'POST', body = 'envelope'): DevRequest {
  return {
    url,
    method,
    headers: { host: 'localhost:3001', origin: 'http://localhost:3001' },
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(body);
    },
  };
}

describe('report tunnel on the dev server', () => {
  it('hands /api/report to the tunnel with the dev origin allowed', async () => {
    const handle = vi.fn<typeof handleReportRequest>(async () => new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } }));
    const middleware = createReportDevMiddleware({ dsn: DSN, protocol: () => 'http', handle });
    const headers: Record<string, string | string[]> = {};
    const ended = new Promise<number>(resolve => {
      const response = { statusCode: 0, setHeader: (name: string, value: string | string[]) => { headers[name] = value; }, end: () => resolve(response.statusCode) };
      middleware(nodeRequest('/api/report'), response, () => {});
    });
    expect(await ended).toBe(200);
    expect(headers['cache-control']).toBe('no-store');
    const [request, env] = handle.mock.calls[0];
    expect(request.url).toBe('http://localhost:3001/api/report');
    expect(await request.text()).toBe('envelope');
    expect(env).toEqual({ SENTRY_DSN: DSN, REPORT_ALLOWED_ORIGIN: 'http://localhost:3001' });
  });

  it('leaves every other address to the next middleware', () => {
    const handle = vi.fn<typeof handleReportRequest>();
    const next = vi.fn();
    createReportDevMiddleware({ dsn: DSN, protocol: () => 'http', handle })(nodeRequest('/api/drive/token'), { statusCode: 0, setHeader: () => {}, end: () => {} }, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(handle).not.toHaveBeenCalled();
  });
});

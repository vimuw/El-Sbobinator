import { describe, expect, it, vi } from 'vitest';
import { MAX_ENVELOPE_BYTES, handleReportRequest, type ReportServerEnv } from './tunnel';

const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.de.sentry.io/456';
const SITE = 'https://elsbobinator.com';
const ENV: ReportServerEnv = { SENTRY_DSN: DSN, REPORT_ALLOWED_ORIGIN: `${SITE}, https://staging.elsbobinator.pages.dev` };
const ENVELOPE = `${JSON.stringify({ event_id: 'a'.repeat(32), dsn: DSN })}\n{"type":"event"}\n{"message":"x"}\n`;

function post(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(`${SITE}/api/report`, {
    method: 'POST',
    headers: { Origin: SITE, 'Content-Type': 'text/plain;charset=UTF-8', Cookie: '__Host-drive=sealed', 'CF-Connecting-IP': '1.2.3.4', 'X-Forwarded-For': '1.2.3.4', ...headers },
    body,
  });
}

function sentry(status = 200, headers: Record<string, string> = {}) {
  return vi.fn<typeof fetch>(async () => new Response('{"id":"abc"}', { status, headers }));
}

describe('report tunnel', () => {
  it('forwards the envelope to its project with nothing of the browser but the body', async () => {
    const fetchImpl = sentry();
    const response = await handleReportRequest(post(ENVELOPE), ENV, { fetchImpl });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://o123.ingest.de.sentry.io/api/456/envelope/');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/x-sentry-envelope' });
    expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe(ENVELOPE);
  });

  it('accepts staging, the other configured origin', async () => {
    const response = await handleReportRequest(post(ENVELOPE, { Origin: 'https://staging.elsbobinator.pages.dev' }), ENV, { fetchImpl: sentry() });
    expect(response.status).toBe(200);
  });

  it('accepts a page on the address the request came to, though the project does not list it', async () => {
    // The site still runs on www. and *.pages.dev: canonicalOrigin.ts shows a notice, it does not redirect.
    for (const old of ['https://www.elsbobinator.com', 'https://elsbobinator.pages.dev']) {
      const fetchImpl = sentry();
      const request = new Request(`${old}/api/report`, { method: 'POST', headers: { Origin: old }, body: ENVELOPE });
      expect((await handleReportRequest(request, { SENTRY_DSN: DSN, REPORT_ALLOWED_ORIGIN: SITE }, { fetchImpl })).status, old).toBe(200);
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });

  it('still refuses another site that posts to an old address', async () => {
    const fetchImpl = sentry();
    const request = new Request('https://www.elsbobinator.com/api/report', { method: 'POST', headers: { Origin: 'https://evil.example' }, body: ENVELOPE });
    expect((await handleReportRequest(request, { SENTRY_DSN: DSN, REPORT_ALLOWED_ORIGIN: SITE }, { fetchImpl })).status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses whatever is not an envelope of our project from our site', async () => {
    const fetchImpl = sentry();
    const cases: Array<[Request, number]> = [
      [new Request(`${SITE}/api/report`), 405],
      [post(ENVELOPE, { Origin: 'https://evil.example' }), 403],
      [new Request(`${SITE}/api/report`, { method: 'POST', body: ENVELOPE }), 403],
      [post('not an envelope'), 400],
      [post(ENVELOPE.replace('o123.ingest.de.sentry.io/456', 'o999.ingest.de.sentry.io/777')), 400],
      [post(ENVELOPE.replace('0123456789abcdef', 'ffffffffffffffff')), 400],
      [post(new Uint8Array(MAX_ENVELOPE_BYTES + 1)), 413],
    ];
    for (const [request, status] of cases) {
      expect((await handleReportRequest(request, ENV, { fetchImpl })).status, `${request.method} ${request.headers.get('Origin')}`).toBe(status);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('has no tunnel in a site built without reports', async () => {
    const fetchImpl = sentry();
    expect((await handleReportRequest(post(ENVELOPE), {}, { fetchImpl })).status).toBe(404);
    expect((await handleReportRequest(post(ENVELOPE), { SENTRY_DSN: 'https://example.com/1', REPORT_ALLOWED_ORIGIN: SITE }, { fetchImpl })).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes Sentry\'s rate limits on, so the page pauses', async () => {
    const response = await handleReportRequest(post(ENVELOPE), ENV, { fetchImpl: sentry(429, { 'Retry-After': '60', 'X-Sentry-Rate-Limits': '60:error:key', 'Set-Cookie': 'x=1' }) });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    expect(response.headers.get('X-Sentry-Rate-Limits')).toBe('60:error:key');
    expect(response.headers.get('Set-Cookie')).toBeNull();
  });

  it('answers 502 when Sentry fails or cannot be reached', async () => {
    expect((await handleReportRequest(post(ENVELOPE), ENV, { fetchImpl: sentry(503) })).status).toBe(502);
    const offline = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); });
    expect((await handleReportRequest(post(ENVELOPE), ENV, { fetchImpl: offline })).status).toBe(502);
  });
});

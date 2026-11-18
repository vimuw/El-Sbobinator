import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { close, createTransport } from '@sentry/browser';
import { reportClientError } from '../diagnostics';
import { AUTO_REPORTS_KEY, REPORT_TUNNEL_PATH } from './config';
import { MAX_AUTOMATIC_REPORTS, initMonitoring, monitoringOptions, resetMonitoringForTests, sendFeedback, setAutoReports, type FeedbackInput } from './sentry';

const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.de.sentry.io/456';
const GEMINI_KEY = 'AIzaSyPrimary1234567890123';

interface Sent { url: string; body: string }
let sent: Sent[] = [];
let status = 200;

function start() {
  initMonitoring(DSN, {
    transport: options => createTransport(options, async request => {
      const body = typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body);
      sent.push({ url: options.url, body });
      return { statusCode: status };
    }),
  });
}

/** The envelope's items: header line, then payload line, pairs after the envelope header. */
function items(body: string): Array<{ type: string; filename?: string; payload: string }> {
  const lines = body.split('\n');
  const result = [];
  for (let index = 1; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index]) as { type: string; filename?: string };
    result.push({ ...header, payload: lines[index + 1] });
  }
  return result;
}

const feedback = (overrides: Partial<FeedbackInput> = {}): FeedbackInput => ({
  kind: 'bug',
  message: 'L’editor non salva il titolo.',
  email: 'io@example.com',
  images: [{ data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), filename: 'immagine-1.jpg' }],
  techReport: '## El Sbobinator (web)\n- Versione: v1.5.0',
  ...overrides,
});

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('Sentry reports', () => {
  beforeEach(() => {
    sent = [];
    status = 200;
    localStorage.clear();
    resetMonitoringForTests();
  });
  afterEach(async () => {
    resetMonitoringForTests();
    await close();
  });

  it('sends the page\'s errors through the site\'s tunnel, filtered', async () => {
    start();
    reportClientError('react', new Error(`Rendering failed with key ${GEMINI_KEY}`));
    await flush();
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(REPORT_TUNNEL_PATH);
    expect(sent[0].body).not.toContain(GEMINI_KEY);
    const [event] = items(sent[0].body);
    expect(event.type).toBe('event');
    const payload = JSON.parse(event.payload);
    expect(payload.tags).toEqual({ source: 'react' });
    // No user, cookie or header but the browser's name.
    expect(payload.user).toBeUndefined();
    expect(Object.keys(payload.request?.headers ?? {}).every(name => name === 'User-Agent')).toBe(true);
  });

  it('turns off everything SDK 11 would collect on its own', () => {
    const options = monitoringOptions(DSN);
    expect(options.tunnel).toBe(REPORT_TUNNEL_PATH);
    expect(options.defaultIntegrations).toBe(false);
    expect(options.dataCollection).toMatchObject({
      userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false, stackFrameVariables: false,
      httpHeaders: { request: { allow: ['User-Agent'] }, response: false },
    });
    expect((options.integrations as Array<{ name: string }>).map(item => item.name).sort())
      .toEqual(['Breadcrumbs', 'Dedupe', 'ElSbobinatorScrub', 'HttpContext', 'LinkedErrors']);
  });

  it('stops automatic reports when the user turns them off, and remembers it', async () => {
    start();
    setAutoReports(false);
    reportClientError('react', new Error('boom'));
    await flush();
    expect(sent).toHaveLength(0);
    expect(localStorage.getItem(AUTO_REPORTS_KEY)).toBe('off');
    // A feedback still goes: the user pressed "Invia".
    await expect(sendFeedback(feedback())).resolves.toMatchObject({ ok: true });
    expect(sent).toHaveLength(1);
  });

  it(`sends at most ${MAX_AUTOMATIC_REPORTS} automatic reports per page`, async () => {
    start();
    for (let index = 0; index < MAX_AUTOMATIC_REPORTS + 5; index += 1) reportClientError('window', new Error(`failure ${index}`));
    await flush();
    expect(sent).toHaveLength(MAX_AUTOMATIC_REPORTS);
  });

  it('sends a feedback with its images and tech info, and gives the user a code', async () => {
    start();
    const result = await sendFeedback(feedback());
    expect(result.ok && result.code).toMatch(/^[0-9A-F]{8}$/);
    const [event, ...attachments] = items(sent[0].body);
    expect(event.type).toBe('feedback');
    const payload = JSON.parse(event.payload);
    expect(payload.contexts.feedback).toMatchObject({ message: 'L’editor non salva il titolo.', contact_email: 'io@example.com' });
    expect(payload.tags).toMatchObject({ 'feedback.kind': 'bug', 'feedback.tech': 'on' });
    expect(attachments.map(item => item.filename)).toEqual(['immagine-1.jpg', 'info-tecniche.txt']);
  });

  it('sends only the user\'s words when the tech info is left out', async () => {
    start();
    await sendFeedback(feedback({ techReport: undefined, email: '' }));
    const [event, ...attachments] = items(sent[0].body);
    const payload = JSON.parse(event.payload);
    // Only Sentry's random trace id joins the feedback: no browser, device or page state.
    expect(Object.keys(payload.contexts).sort()).toEqual(['feedback', 'trace']);
    expect(payload.contexts.feedback.contact_email).toBeUndefined();
    expect(payload.breadcrumbs ?? []).toEqual([]);
    expect(attachments.map(item => item.filename)).toEqual(['immagine-1.jpg']);
  });

  it('says when the report could not be delivered', async () => {
    start();
    status = 503;
    await expect(sendFeedback(feedback())).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('allows three feedback every ten minutes', async () => {
    start();
    const now = Date.now();
    for (let index = 0; index < 3; index += 1) await expect(sendFeedback(feedback(), now)).resolves.toMatchObject({ ok: true });
    await expect(sendFeedback(feedback(), now + 60_000)).resolves.toEqual({ ok: false, reason: 'rate_limited' });
    expect(sent).toHaveLength(3);
    await expect(sendFeedback(feedback(), now + 11 * 60_000)).resolves.toMatchObject({ ok: true });
  });

  it('counts only delivered feedback, so failed tries keep offering the email', async () => {
    start();
    const now = Date.now();
    status = 403;
    for (let index = 0; index < 3; index += 1) await expect(sendFeedback(feedback(), now + index)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    // The fourth failure is still 'unavailable' (with the email link), not 'rate_limited'.
    await expect(sendFeedback(feedback(), now + 10)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    status = 200;
    for (let index = 0; index < 3; index += 1) await expect(sendFeedback(feedback(), now + 20 + index)).resolves.toMatchObject({ ok: true });
    await expect(sendFeedback(feedback(), now + 30)).resolves.toEqual({ ok: false, reason: 'rate_limited' });
  });
});

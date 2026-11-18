import { describe, expect, it } from 'vitest';
import type { Event } from '@sentry/browser';
import { AUTOMATIC_TEXT_LIMIT, MASK, redactSecrets, scrubBreadcrumb, scrubEvent, scrubText, scrubUrl } from './scrub';

const GEMINI_KEY = 'AIzaSyPrimary1234567890123';
const NEW_GEMINI_KEY = 'AQ.Ab8RN6Lmz0TqW1xYbYcDeFgHiJk';
const ACCESS_TOKEN = 'ya29.a0AfB_byC-token.value';
// A passage of a lecture, as an error message might quote it.
const LECTURE = 'Il paziente, Mario Rossi, 54 anni, si presenta con dolore toracico. '.repeat(12);

describe('report filters', () => {
  it('masks keys and tokens wherever they appear', () => {
    const text = `key=${GEMINI_KEY} new ${NEW_GEMINI_KEY} token ${ACCESS_TOKEN} Authorization: Bearer abc.def`;
    const clean = redactSecrets(text);
    for (const secret of [GEMINI_KEY, NEW_GEMINI_KEY, ACCESS_TOKEN, 'abc.def']) expect(clean).not.toContain(secret);
    expect(clean.split(MASK)).toHaveLength(5);
  });

  it('cuts the app\'s texts and hides email addresses', () => {
    const clean = scrubText(`Drive di studente@example.com: ${LECTURE}`);
    expect(clean).not.toContain('studente@example.com');
    expect(clean.length).toBe(AUTOMATIC_TEXT_LIMIT + 1);
    expect(clean.endsWith('…')).toBe(true);
  });

  it('keeps origin, path and app routes of an address, never its query or OAuth fragment', () => {
    expect(scrubUrl('https://elsbobinator.com/api/drive/callback?code=4/abc&state=123')).toBe('https://elsbobinator.com/api/drive/callback');
    expect(scrubUrl('https://elsbobinator.com/drive-auth#access_token=ya29.x&state=1')).toBe('https://elsbobinator.com/drive-auth');
    expect(scrubUrl('https://elsbobinator.com/#/archivio/sbobina/abc')).toBe('https://elsbobinator.com/#/archivio/sbobina/abc');
    expect(scrubUrl(`https://generativelanguage.googleapis.com/v1beta/files?key=${GEMINI_KEY}`)).toBe('https://generativelanguage.googleapis.com/v1beta/files');
  });

  it('drops console lines and keeps only method, address and status of a request', () => {
    expect(scrubBreadcrumb({ category: 'console', message: LECTURE })).toBeNull();
    const fetch = scrubBreadcrumb({
      category: 'fetch',
      data: { method: 'POST', url: '/api/drive/token?x=1', status_code: 200, request_body_size: 10, response_body_size: 900 },
    });
    expect(fetch?.data).toEqual({ method: 'POST', url: '/api/drive/token', status_code: 200 });
  });

  it('keeps the clicked element\'s tag and classes, not its labels', () => {
    const click = scrubBreadcrumb({ category: 'ui.click', message: 'div.archive > button.session-card[aria-label="Apri Lezione di cardiologia"][title="Lezione"]' });
    expect(click?.message).toBe('div.archive > button.session-card');
  });

  it('sends an error that quotes a lecture and a key only filtered', () => {
    const event: Event = {
      message: LECTURE,
      user: { email: 'studente@example.com', ip_address: '1.2.3.4' },
      extra: { html: LECTURE },
      exception: { values: [{ type: 'Error', value: `${LECTURE} ${GEMINI_KEY}`, stacktrace: { frames: [{ filename: 'https://elsbobinator.com/assets/index.js?v=1', vars: { text: LECTURE } }] } }] },
      request: { url: 'https://elsbobinator.com/?x=1#/editor', headers: { 'User-Agent': 'Safari', Referer: 'https://elsbobinator.com/drive-auth#access_token=ya29.x', Cookie: '__Host-drive=secret' } },
      breadcrumbs: [{ category: 'console', message: LECTURE }, { category: 'navigation', data: { from: '/#/coda', to: '/#/editor?token=1' } }],
      contexts: { page: { draft: LECTURE } },
    };
    const clean = scrubEvent(event);
    const json = JSON.stringify(clean);
    expect(json).not.toContain(GEMINI_KEY);
    expect(json).not.toContain('studente@example.com');
    expect(json).not.toContain('1.2.3.4');
    expect(json).not.toContain('__Host-drive');
    expect(json).not.toContain('access_token');
    // Each text the app wrote leaves at most AUTOMATIC_TEXT_LIMIT characters of the lecture.
    for (const text of [clean.message, clean.exception?.values?.[0].value, clean.contexts?.page?.draft as string]) {
      expect(text?.length).toBeLessThanOrEqual(AUTOMATIC_TEXT_LIMIT + 1);
    }
    expect(clean.request).toEqual({ url: 'https://elsbobinator.com/#/editor', headers: { 'User-Agent': 'Safari' } });
    expect(clean.breadcrumbs).toEqual([{ category: 'navigation', data: { from: '/#/coda', to: '/' } }]);
    expect(clean.exception?.values?.[0].stacktrace?.frames?.[0]).toEqual({ filename: 'https://elsbobinator.com/assets/index.js', abs_path: undefined, vars: undefined });
  });

  it('keeps the user\'s feedback text whole, without keys, and strips everything else when bare', () => {
    const feedback: Event = {
      type: 'feedback',
      contexts: {
        feedback: { message: `L'editor si blocca. La mia chiave è ${GEMINI_KEY}. Scrivetemi a io@example.com`, contact_email: 'io@example.com', url: 'https://elsbobinator.com/?x=1' },
        browser: { name: 'Safari' },
      },
      breadcrumbs: [{ category: 'navigation', data: { to: '/' } }],
      request: { url: 'https://elsbobinator.com/', headers: { 'User-Agent': 'Safari' } },
    };
    const full = scrubEvent(feedback);
    expect(full.contexts?.feedback).toEqual({
      message: `L'editor si blocca. La mia chiave è ${MASK}. Scrivetemi a io@example.com`,
      contact_email: 'io@example.com',
      url: 'https://elsbobinator.com/',
    });
    expect(full.contexts?.browser).toEqual({ name: 'Safari' });
    const bare = scrubEvent(feedback, { bare: true });
    expect(Object.keys(bare.contexts ?? {})).toEqual(['feedback']);
    expect(bare.breadcrumbs).toEqual([]);
    expect(bare.request).toEqual({ url: 'https://elsbobinator.com/' });
  });
});

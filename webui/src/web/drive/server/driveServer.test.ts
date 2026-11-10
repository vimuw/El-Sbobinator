import { describe, expect, it, vi } from 'vitest';
import { DRIVE_APPDATA_SCOPE } from '../oauth';
import { LOGIN_COOKIE, SESSION_COOKIE, SESSION_MAX_AGE_S, handleDriveRequest, type DriveServerEnv } from './driveServer';

const ORIGIN = 'https://elsbobinator.com';
const STATE = '0123456789abcdef0123456789abcdef';
const ENV: DriveServerEnv = {
  GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'segreto-di-prova',
  DRIVE_COOKIE_KEY: btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, index) => index))),
};

const sha256 = async (text: string) => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Google's token, revoke and Drive "about" endpoints, as far as the server uses them. */
function fakeGoogle(options: { scope?: string; refresh?: string | null; email?: string; refreshError?: string; down?: boolean } = {}) {
  let challenge = '';
  const calls: Array<{ url: string; body: URLSearchParams }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (options.down) throw new TypeError('fetch failed');
    const body = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
    calls.push({ url, body });
    if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
      const auth = new Headers(init?.headers).get('Authorization');
      return Response.json(auth === 'Bearer at-1' ? { user: { emailAddress: options.email ?? 'studente@example.com' } } : {}, { status: auth === 'Bearer at-1' ? 200 : 401 });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') return new Response(null, { status: 200 });
    if (body.get('client_secret') !== ENV.GOOGLE_CLIENT_SECRET) return Response.json({ error: 'invalid_client' }, { status: 401 });
    if (body.get('grant_type') === 'authorization_code') {
      // PKCE: only the verifier of the browser that started this login opens the code.
      if (body.get('code') !== 'code-1' || await sha256(body.get('code_verifier') ?? '') !== challenge) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return Response.json({
        access_token: 'at-1', expires_in: 3599, scope: options.scope ?? DRIVE_APPDATA_SCOPE,
        ...(options.refresh === null ? {} : { refresh_token: options.refresh ?? 'rt-1' }),
      });
    }
    if (options.refreshError) return Response.json({ error: options.refreshError }, { status: 400 });
    return Response.json({ access_token: `at-${calls.length}`, expires_in: 3599, scope: DRIVE_APPDATA_SCOPE });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls, setChallenge: (value: string) => { challenge = value; } };
}

const cookieOf = (response: Response, name: string) => {
  const line = response.headers.getSetCookie().find(item => item.startsWith(`${name}=`));
  return line ? { line, value: line.slice(name.length + 1, line.indexOf(';')) } : null;
};

const get = (path: string, cookie = '') => new Request(`${ORIGIN}${path}`, { headers: cookie ? { Cookie: cookie } : {} });
const post = (path: string, cookie = '', origin = ORIGIN) => new Request(`${ORIGIN}${path}`, {
  method: 'POST',
  headers: { Origin: origin, 'Sec-Fetch-Site': origin === ORIGIN ? 'same-origin' : 'cross-site', ...(cookie ? { Cookie: cookie } : {}) },
});

/** Start → Google → callback: the session cookie of a linked browser. */
async function link(google = fakeGoogle(), now = 1_000_000) {
  const started = await handleDriveRequest(get(`/api/drive/start?state=${STATE}&login_hint=studente%40example.com`), ENV, 'start', { now: () => now });
  const location = new URL(started.headers.get('Location')!);
  google.setChallenge(location.searchParams.get('code_challenge')!);
  const login = cookieOf(started, LOGIN_COOKIE)!;
  const back = await handleDriveRequest(get(`/api/drive/callback?state=${STATE}&code=code-1`, `${LOGIN_COOKIE}=${login.value}`), ENV, 'callback', { fetchImpl: google.fetchImpl, now: () => now + 5000 });
  return { started, location, login, back, session: cookieOf(back, SESSION_COOKIE) };
}

const fragment = (response: Response) => Object.fromEntries(new URLSearchParams(new URL(response.headers.get('Location')!).hash.slice(1)));

describe('Drive login server', () => {
  it('starts Google\'s code flow with PKCE and a ten-minute login cookie that can come back from Google', async () => {
    const { started, location, login } = await link();
    expect(started.status).toBe(303);
    expect(`${location.origin}${location.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: ENV.GOOGLE_CLIENT_ID,
      redirect_uri: `${ORIGIN}/api/drive/callback`,
      response_type: 'code',
      scope: DRIVE_APPDATA_SCOPE,
      state: STATE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      code_challenge_method: 'S256',
      login_hint: 'studente@example.com',
    });
    expect(location.searchParams.has('client_secret')).toBe(false);
    expect(login.line).toMatch(/^__Host-drive-login=[^;]+; Max-Age=600; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
    expect(started.headers.get('Cache-Control')).toBe('no-store');

    const chooser = await handleDriveRequest(get(`/api/drive/start?state=${STATE}`), ENV, 'start');
    expect(new URL(chooser.headers.get('Location')!).searchParams.get('prompt')).toBe('select_account consent');
    expect((await handleDriveRequest(get('/api/drive/start?state=nope'), ENV, 'start')).status).toBe(400);
  });

  it('keeps the refresh token only encrypted in an HttpOnly, Strict cookie and sends the window back to the app', async () => {
    const { back, session } = await link();
    expect(back.status).toBe(303);
    expect(new URL(back.headers.get('Location')!).pathname).toBe('/drive-auth');
    expect(fragment(back)).toEqual({ state: STATE, result: 'ok' });
    expect(session!.line).toMatch(new RegExp(`^__Host-drive=[^;]+; Max-Age=${SESSION_MAX_AGE_S}; Path=/; Secure; HttpOnly; SameSite=Strict$`));
    expect(session!.value).not.toContain('rt-1');
    expect(atob(session!.value.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('rt-1');
    expect(cookieOf(back, LOGIN_COOKIE)!.line).toContain('Max-Age=0');
    // No token in the address the window goes back to.
    expect(back.headers.get('Location')).not.toContain('at-1');
  });

  it('accepts Google\'s answer only for the login this browser started, within ten minutes', async () => {
    const google = fakeGoogle();
    const { login } = await link(google);
    const callback = (query: string, cookie: string, now = 1_005_000) => handleDriveRequest(get(`/api/drive/callback?${query}`, cookie), ENV, 'callback', { fetchImpl: google.fetchImpl, now: () => now });
    const cookie = `${LOGIN_COOKIE}=${login.value}`;
    expect(fragment(await callback(`state=${STATE}&code=code-1`, ''))).toMatchObject({ error: 'login_expired' });
    expect(fragment(await callback(`state=${'f'.repeat(32)}&code=code-1`, cookie))).toMatchObject({ error: 'login_expired' });
    expect(fragment(await callback(`state=${STATE}&code=code-1`, cookie, 1_000_000 + 601_000))).toMatchObject({ error: 'login_expired' });
    expect(fragment(await callback(`state=${STATE}&code=code-1`, `${LOGIN_COOKIE}=${login.value.slice(0, -4)}AAAA`))).toMatchObject({ error: 'login_expired' });
    // A code of another login (another verifier) is refused by Google.
    expect(fragment(await callback(`state=${STATE}&code=code-2`, cookie))).toMatchObject({ error: 'login_failed' });
    expect(fragment(await callback(`state=${STATE}&error=access_denied`, cookie))).toEqual({ state: STATE, error: 'access_denied' });
    expect(fragment(await callback(`state=${STATE}&error=%3Cscript%3E`, cookie))).toMatchObject({ error: 'login_failed' });
  });

  it('refuses a login without the app folder\'s permission or without a refresh token', async () => {
    expect(fragment((await link(fakeGoogle({ scope: 'email' }))).back)).toMatchObject({ error: 'scope_missing' });
    const noRefresh = await link(fakeGoogle({ refresh: null }));
    expect(fragment(noRefresh.back)).toMatchObject({ error: 'no_refresh_token' });
    expect(noRefresh.session).toBeNull();
    expect(fragment((await link(fakeGoogle({ down: true }))).back)).toMatchObject({ error: 'google_unreachable' });
  });

  it('hands the page a fresh access token and the account, renewing the cookie', async () => {
    const google = fakeGoogle();
    const { session } = await link(google);
    const answer = await handleDriveRequest(post('/api/drive/token', `${SESSION_COOKIE}=${session!.value}`), ENV, 'token', { fetchImpl: google.fetchImpl });
    expect(answer.status).toBe(200);
    expect(await answer.json()).toEqual({ access_token: expect.stringMatching(/^at-/), expires_in: 3599, email: 'studente@example.com' });
    expect(answer.headers.get('Cache-Control')).toBe('no-store');
    expect(cookieOf(answer, SESSION_COOKIE)!.line).toContain(`Max-Age=${SESSION_MAX_AGE_S}`);
    const refresh = google.calls.at(-1)!;
    expect(refresh.url).toBe('https://oauth2.googleapis.com/token');
    expect(Object.fromEntries(refresh.body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-1', client_secret: ENV.GOOGLE_CLIENT_SECRET });
  });

  it('answers 401 and clears the cookie when the login is gone, tampered or revoked at Google', async () => {
    const { session, login } = await link();
    const token = (cookie: string, google = fakeGoogle()) => handleDriveRequest(post('/api/drive/token', cookie), ENV, 'token', { fetchImpl: google.fetchImpl });
    const none = await token('');
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'login_required' });
    const tampered = await token(`${SESSION_COOKIE}=${session!.value.slice(0, -4)}AAAA`);
    expect(tampered.status).toBe(401);
    expect(cookieOf(tampered, SESSION_COOKIE)!.line).toContain('Max-Age=0');
    // The login cookie never opens as a session one (the cookie name is sealed in).
    expect((await token(`${SESSION_COOKIE}=${login.value}`)).status).toBe(401);
    // Another key (another deployment): unreadable.
    const otherKey = { ...ENV, DRIVE_COOKIE_KEY: btoa('x'.repeat(32)) };
    expect((await handleDriveRequest(post('/api/drive/token', `${SESSION_COOKIE}=${session!.value}`), otherKey, 'token', { fetchImpl: fakeGoogle().fetchImpl })).status).toBe(401);
    const revoked = await token(`${SESSION_COOKIE}=${session!.value}`, fakeGoogle({ refreshError: 'invalid_grant' }));
    expect(revoked.status).toBe(401);
    expect(cookieOf(revoked, SESSION_COOKIE)!.line).toContain('Max-Age=0');
    // Google unreachable: not a lost login, the cookie stays.
    const down = await token(`${SESSION_COOKIE}=${session!.value}`, fakeGoogle({ down: true }));
    expect(down.status).toBe(502);
    expect(cookieOf(down, SESSION_COOKIE)).toBeNull();
  });

  it('serves the token and the disconnect to this site\'s page only, by POST', async () => {
    const { session } = await link();
    const cookie = `${SESSION_COOKIE}=${session!.value}`;
    const google = fakeGoogle();
    for (const action of ['token', 'disconnect']) {
      expect((await handleDriveRequest(post(`/api/drive/${action}`, cookie, 'https://evil.example'), ENV, action, { fetchImpl: google.fetchImpl })).status).toBe(403);
      expect((await handleDriveRequest(get(`/api/drive/${action}`, cookie), ENV, action, { fetchImpl: google.fetchImpl })).status).toBe(405);
      const noOrigin = new Request(`${ORIGIN}/api/drive/${action}`, { method: 'POST', headers: { Cookie: cookie } });
      expect((await handleDriveRequest(noOrigin, ENV, action, { fetchImpl: google.fetchImpl })).status).toBe(403);
    }
    expect(google.calls).toEqual([]);
    expect((await handleDriveRequest(get('/api/drive/altro'), ENV, 'altro')).status).toBe(404);
  });

  it('"Disconnetti" revokes the refresh token at Google and clears the cookie, even when Google is down', async () => {
    const google = fakeGoogle();
    const { session } = await link(google);
    const answer = await handleDriveRequest(post('/api/drive/disconnect', `${SESSION_COOKIE}=${session!.value}`), ENV, 'disconnect', { fetchImpl: google.fetchImpl });
    expect(answer.status).toBe(204);
    expect(cookieOf(answer, SESSION_COOKIE)!.line).toContain('Max-Age=0');
    expect(google.calls.at(-1)).toMatchObject({ url: 'https://oauth2.googleapis.com/revoke' });
    expect(google.calls.at(-1)!.body.get('token')).toBe('rt-1');

    const down = await handleDriveRequest(post('/api/drive/disconnect', `${SESSION_COOKIE}=${session!.value}`), ENV, 'disconnect', { fetchImpl: fakeGoogle({ down: true }).fetchImpl });
    expect(down.status).toBe(204);
    expect(cookieOf(down, SESSION_COOKIE)!.line).toContain('Max-Age=0');
  });

  it('says so when the site has no secrets configured, without calling Google', async () => {
    const google = fakeGoogle();
    const missing = { GOOGLE_CLIENT_ID: ENV.GOOGLE_CLIENT_ID };
    expect(fragment(await handleDriveRequest(get(`/api/drive/start?state=${STATE}`), missing, 'start'))).toEqual({ state: STATE, error: 'server_not_configured' });
    expect((await handleDriveRequest(post('/api/drive/token', 'x=1'), missing, 'token', { fetchImpl: google.fetchImpl })).status).toBe(503);
    // A key of the wrong size counts as missing.
    expect((await handleDriveRequest(post('/api/drive/token', 'x=1'), { ...ENV, DRIVE_COOKIE_KEY: btoa('corta') }, 'token', { fetchImpl: google.fetchImpl })).status).toBe(503);
    expect(google.calls).toEqual([]);
  });
});

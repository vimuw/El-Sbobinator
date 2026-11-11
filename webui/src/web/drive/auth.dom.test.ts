import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../storageKeys';
import { DriveAuthError, createDriveAuth, type DriveAuthOptions } from './auth';
import { DriveError } from './driveApi';
import { describeDriveError } from './driveService';
import { DRIVE_APPDATA_SCOPE, DRIVE_FILE_SCOPE } from './oauth';

type Listener = (event: MessageEvent) => void;
const ORIGIN = 'https://elsbobinator.com';

function fakeChannel() {
  const listeners = new Set<Listener>();
  return {
    addEventListener: (_: 'message', listener: Listener) => { listeners.add(listener); },
    removeEventListener: (_: 'message', listener: Listener) => { listeners.delete(listener); },
    close: vi.fn(),
    post: (data: unknown, origin = '') => { for (const listener of [...listeners]) listener(new MessageEvent('message', { data, origin })); },
    size: () => listeners.size,
  };
}

/** The site's server: /api/drive/token answers with this browser's login, or 401 without one. */
function fakeServer() {
  const state = { login: null as { email: string } | null, issued: 0, down: false, hang: false, failure: null as { status: number; error: string } | null };
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (state.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    }
    if (state.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (state.failure) return Promise.resolve(Response.json({ error: state.failure.error }, { status: state.failure.status }));
    if (String(input).endsWith('/api/drive/disconnect')) {
      state.login = null;
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    if (!state.login) return Promise.resolve(Response.json({ error: 'login_required' }, { status: 401 }));
    state.issued += 1;
    return Promise.resolve(Response.json({ access_token: `tok-${state.issued}`, expires_in: 3600, email: state.login.email }));
  });
  const tokenRequests = () => requests.filter(request => request.url.endsWith('/api/drive/token')).length;
  return { state, requests, fetchImpl, tokenRequests };
}

function setup(overrides: Partial<DriveAuthOptions> = {}) {
  const channel = fakeChannel();
  const opened: string[] = [];
  const server = fakeServer();
  let now = 1_000_000;
  const auth = createDriveAuth({
    clientId: '1-abc.apps.googleusercontent.com',
    redirectUri: `${ORIGIN}/drive-auth`,
    origin: ORIGIN,
    openWindow: url => { opened.push(url); return {} as Window; },
    openChannel: () => channel,
    windowEvents: null,
    fetchImpl: server.fetchImpl as unknown as typeof fetch,
    now: () => now,
    ...overrides,
  });
  const reply = (fields: Record<string, string>) => {
    const state = new URL(opened.at(-1)!).searchParams.get('state')!;
    channel.post({ type: 'el-sbobinator-oauth', fragment: `#${new URLSearchParams({ state, ...fields }).toString()}` });
  };
  /** The window went through the server's login: the cookie is set, the return page answers ok. */
  const linkAs = (email: string) => {
    server.state.login = { email };
    reply({ result: 'ok' });
  };
  return { auth, channel, opened, server, reply, linkAs, advance: (ms: number) => { now += ms; } };
}

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('Drive auth', () => {
  it('links through the site\'s server and keeps the token in memory only, never in storage', async () => {
    sessionStorage.setItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1, JSON.stringify({ accessToken: 'old', expiresAt: 9e15, scopes: [] }));
    const { auth, opened, linkAs, server } = setup();
    // Builds before the server login kept it there: it goes.
    expect(sessionStorage.getItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1)).toBeNull();

    const connecting = auth.connect();
    const url = new URL(opened[0]);
    expect(`${url.origin}${url.pathname}`).toBe(`${ORIGIN}/api/drive/start`);
    expect(url.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(url.searchParams.has('login_hint')).toBe(false);
    linkAs('studente@example.com');
    const token = await connecting;
    expect(token).toMatchObject({ accessToken: 'tok-1', account: 'studente@example.com', scopes: [DRIVE_APPDATA_SCOPE] });
    expect(server.requests.at(-1)).toMatchObject({ url: `${ORIGIN}/api/drive/token`, init: { method: 'POST', credentials: 'same-origin' } });
    // Not this tab's until the sync bound its account.
    expect(auth.token()).toBeNull();
    auth.adopt(token);
    auth.setAccount('studente@example.com');
    expect(auth.token()).toBe('tok-1');
    expect(auth.tokenAccount()).toBe('studente@example.com');
    expect(JSON.stringify({ ...sessionStorage, ...localStorage })).not.toContain('tok-1');
  });

  it('renews the token through the server shortly before it expires, one request for many callers', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server, advance } = setup();
    server.state.login = { email: 'studente@example.com' };
    // A reloaded page: no token in hand, the server's login gives one.
    expect(auth.token()).toBeNull();
    const [one, two] = await Promise.all([auth.freshToken(), auth.freshToken()]);
    expect([one, two]).toEqual(['tok-1', 'tok-1']);
    expect(server.tokenRequests()).toBe(1);
    expect(auth.tokenAccount()).toBe('studente@example.com');
    advance(3600_000 - 6 * 60_000);
    expect(await auth.freshToken()).toBe('tok-1');
    advance(2 * 60_000);
    // Within five minutes of its end: renewed before a round can die halfway.
    expect(await auth.freshToken()).toBe('tok-2');
    expect(server.tokenRequests()).toBe(2);
    advance(3 * 3600_000);
    expect(auth.token()).toBeNull();
    expect(await auth.freshToken()).toBe('tok-3');
    expect(auth.needsReconnect()).toBe(false);
  });

  it('asks the server for nothing without a remembered account', async () => {
    const { auth, server } = setup();
    server.state.login = { email: 'studente@example.com' };
    expect(await auth.freshToken()).toBeNull();
    expect(server.requests).toEqual([]);
  });

  it('needs "Riconnetti" once the server has lost the login, and stops asking until a new link', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server, linkAs } = setup();
    expect(await auth.freshToken()).toBeNull();
    expect(auth.needsReconnect()).toBe(true);
    expect(await auth.freshToken()).toBeNull();
    expect(server.tokenRequests()).toBe(1);
    // The account stays: the tap reconnects it.
    expect(auth.account()).toBe('studente@example.com');

    const connecting = auth.connect();
    linkAs('studente@example.com');
    auth.adopt(await connecting);
    expect(auth.needsReconnect()).toBe(false);
  });

  it('keeps a valid token while the server is unreachable, and says offline once none is left', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server, advance } = setup();
    server.state.login = { email: 'studente@example.com' };
    await auth.freshToken();
    server.state.down = true;
    advance(3600_000 - 3 * 60_000);
    expect(await auth.freshToken()).toBe('tok-1');
    advance(3 * 60_000);
    const error = await auth.freshToken().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriveError);
    expect((error as DriveError).offline).toBe(true);
    // Offline is not a lost login.
    expect(auth.needsReconnect()).toBe(false);
  });

  it('tells a failing login service apart from being offline, and asks for no "Riconnetti"', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const offlineMessage = describeDriveError(new DriveError(0, ''));
    const renewalError = async (failure: { status: number; error: string } | null, down = false) => {
      const { auth, server } = setup();
      server.state.login = { email: 'studente@example.com' };
      server.state.failure = failure;
      server.state.down = down;
      const error = await auth.freshToken().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(DriveError);
      // The server answered or not: neither is a lost login.
      expect((error as DriveError).needsAuthorization).toBe(false);
      expect(auth.needsReconnect()).toBe(false);
      return error as DriveError;
    };

    // Cloudflare secrets missing: the deploy, not the connection.
    const unconfigured = await renewalError({ status: 503, error: 'server_not_configured' });
    expect(unconfigured).toMatchObject({ status: 503, offline: false, reason: 'server_not_configured' });
    expect(describeDriveError(unconfigured)).toBe('Il collegamento a Google Drive non è ancora attivo su questo sito.');

    // A wrong client secret: Google refuses the server, which answers 502 google_error.
    const refused = await renewalError({ status: 502, error: 'google_error' });
    expect(refused).toMatchObject({ status: 502, offline: false });
    expect(describeDriveError(refused)).not.toBe(offlineMessage);
    expect(describeDriveError(refused)).toContain('Il servizio di accesso a Google Drive non è disponibile al momento (502)');

    // No answer at all: still offline.
    const offline = await renewalError(null, true);
    expect(offline.offline).toBe(true);
    expect(describeDriveError(offline)).toBe(offlineMessage);
  });

  it('asks the server nothing during a link, whose login may be another account\'s until bound', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server, opened, linkAs } = setup();
    const connecting = auth.connect();
    expect(new URL(opened[0]).searchParams.get('login_hint')).toBe('studente@example.com');
    expect(await auth.freshToken()).toBeNull();
    expect(server.tokenRequests()).toBe(0);
    linkAs('altro@example.com');
    const token = await connecting;
    expect(token.account).toBe('altro@example.com');
    expect(await auth.freshToken()).toBeNull();
    expect(server.tokenRequests()).toBe(1);
    // The binding failed: the next round asks again, and the cookie still holds the other
    // account's login. Its token is never this tab's: only a new link helps ("Riconnetti").
    auth.expire();
    expect(await auth.freshToken()).toBeNull();
    expect(server.tokenRequests()).toBe(2);
    expect(auth.needsReconnect()).toBe(true);
  });

  it('drops a renewal that answers after "Disconnetti"', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server } = setup();
    server.state.login = { email: 'studente@example.com' };
    const renewing = auth.freshToken();
    await auth.disconnect();
    expect(await renewing).toBeNull();
    expect(auth.token()).toBeNull();
  });

  it('disconnects through the server and forgets the account, even when the server never answers', async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
      const { auth, server } = setup();
      server.state.login = { email: 'studente@example.com' };
      await auth.freshToken();
      await auth.disconnect();
      expect(server.requests.at(-1)).toMatchObject({ url: `${ORIGIN}/api/drive/disconnect`, init: { method: 'POST' } });
      expect(server.state.login).toBeNull();
      expect(auth.token()).toBeNull();
      expect(auth.account()).toBeNull();

      auth.setAccount('studente@example.com');
      server.state.hang = true;
      let done = false;
      const disconnecting = auth.disconnect().then(() => { done = true; });
      expect(auth.account()).toBeNull();
      await vi.advanceTimersByTimeAsync(10_000);
      await disconnecting;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['offline', (server: ReturnType<typeof fakeServer>) => { server.state.down = true; }],
    ['answering 503', (server: ReturnType<typeof fakeServer>) => { server.state.failure = { status: 503, error: 'unavailable' }; }],
  ])('keeps a "Disconnetti" the server never confirmed (%s) pending, and finishes it on the next visit', async (_case, fail) => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const first = setup();
    first.server.state.login = { email: 'studente@example.com' };
    fail(first.server);
    await first.auth.disconnect();
    expect(first.auth.account()).toBeNull();
    // The cookie still holds the login: this browser must know the disconnect is not done.
    expect(first.auth.disconnectPending()).toBe(true);

    // The next visit: the server answers again, the retry clears the cookie and the flag.
    const next = setup();
    next.server.state.login = { email: 'studente@example.com' };
    expect(next.auth.disconnectPending()).toBe(true);
    expect(await next.auth.finishDisconnect()).toBe(true);
    expect(next.server.requests.map(request => request.url)).toEqual([`${ORIGIN}/api/drive/disconnect`]);
    expect(next.server.state.login).toBeNull();
    expect(next.auth.disconnectPending()).toBe(false);
    // Done: nothing more to send.
    expect(await next.auth.finishDisconnect()).toBe(true);
    expect(next.server.requests).toHaveLength(1);
  });

  it('sets no pending flag on a confirmed "Disconnetti", and keeps it while the retry fails', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, server } = setup();
    server.state.login = { email: 'studente@example.com' };
    await auth.disconnect();
    expect(auth.disconnectPending()).toBe(false);

    auth.setAccount('studente@example.com');
    server.state.login = { email: 'studente@example.com' };
    server.state.failure = { status: 403, error: 'forbidden' };
    await auth.disconnect();
    expect(await auth.finishDisconnect()).toBe(false);
    expect(auth.disconnectPending()).toBe(true);
    server.state.failure = null;
    expect(await auth.finishDisconnect()).toBe(true);
    expect(auth.disconnectPending()).toBe(false);
  });

  it('asks the cookie for no token while a "Disconnetti" is pending, and a new link replaces it', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_DISCONNECT_PENDING_V1, '1');
    const { auth, server, linkAs } = setup();
    server.state.login = { email: 'studente@example.com' };
    expect(await auth.freshToken()).toBeNull();
    expect(auth.token()).toBeNull();
    expect(server.tokenRequests()).toBe(0);

    // "Collega Google Drive": the server's callback replaces the cookie, so nothing is left to revoke.
    const connecting = auth.connect();
    linkAs('nuovo@example.com');
    const token = await connecting;
    expect(token.account).toBe('nuovo@example.com');
    expect(auth.disconnectPending()).toBe(false);
    expect(server.requests.some(request => request.url.endsWith('/disconnect'))).toBe(false);
  });

  it('sends no pending disconnect during a link, whose new cookie it would clear', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_DISCONNECT_PENDING_V1, '1');
    const { auth, server } = setup();
    void auth.connect();
    expect(await auth.finishDisconnect()).toBe(false);
    expect(server.requests).toHaveLength(0);
  });

  it('remembers a pending disconnect for this page when localStorage is blocked', async () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
    const local = { getItem: blocked, setItem: blocked, removeItem: blocked } as unknown as Storage;
    const { auth, server } = setup({ local });
    server.state.down = true;
    await auth.disconnect();
    expect(auth.disconnectPending()).toBe(true);
    server.state.down = false;
    expect(await auth.finishDisconnect()).toBe(true);
    expect(auth.disconnectPending()).toBe(false);
  });

  it('expire() keeps the account; expire(true) waits for a new link', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'a@b.it');
    const { auth, server } = setup();
    server.state.login = { email: 'a@b.it' };
    await auth.freshToken();
    auth.expire();
    expect(auth.token()).toBeNull();
    expect(auth.account()).toBe('a@b.it');
    expect(auth.needsReconnect()).toBe(false);
    auth.expire(true);
    expect(auth.needsReconnect()).toBe(true);
    expect(await auth.freshToken()).toBeNull();
  });

  it('stop() after a takeover: no token and no renewal, even with the server\'s login still valid', async () => {
    // Regression: "Usa qui" only forgot the token in memory; the old tab's next Drive request
    // renewed it through the cookie and its sync round went on next to the new tab's.
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'a@b.it');
    const { auth, server, advance } = setup();
    server.state.login = { email: 'a@b.it' };
    expect(await auth.freshToken()).toBe('tok-1');
    // A renewal already on its way when the other tab takes over is dropped too.
    advance(3600_000 - 2 * 60_000);
    server.state.hang = true;
    const pending = auth.freshToken();
    auth.stop();
    server.state.hang = false;
    expect(auth.token()).toBeNull();
    const before = server.tokenRequests();
    expect(await auth.freshToken()).toBeNull();
    advance(3600_000);
    expect(await auth.freshToken()).toBeNull();
    expect(server.tokenRequests()).toBe(before);
    auth.adopt({ accessToken: 'late', expiresAt: 9e15, scopes: [DRIVE_APPDATA_SCOPE] });
    expect(auth.token()).toBeNull();
    // The server's login is the other tab's: stop() never disconnects it.
    expect(server.state.login).toEqual({ email: 'a@b.it' });
    expect(auth.account()).toBe('a@b.it');
    expect(auth.needsReconnect()).toBe(false);
    void pending.catch(() => undefined);
  });

  it('refuses a renewal for another account than the remembered one, also in the middle of a round', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'a@b.it');
    const { auth, server, advance } = setup();
    server.state.login = { email: 'a@b.it' };
    expect(await auth.freshToken()).toBe('tok-1');
    // Meanwhile the cookie became another account's (a link of another tab whose binding failed).
    server.state.login = { email: 'altro@example.com' };
    advance(3600_000 - 2 * 60_000);
    expect(await auth.freshToken()).toBeNull();
    expect(auth.token()).toBeNull();
    expect(auth.tokenAccount()).toBeNull();
    expect(auth.needsReconnect()).toBe(true);
    // A reloaded page with the same cookie: refused at once as well.
    const reloaded = setup({ fetchImpl: server.fetchImpl as unknown as typeof fetch });
    expect(await reloaded.auth.freshToken()).toBeNull();
    expect(reloaded.auth.needsReconnect()).toBe(true);
  });

  it('reports the server\'s and Google\'s errors, ignores answers to another login, and a blocked window', async () => {
    const { auth, reply, channel } = setup();
    const connecting = auth.connect();
    channel.post({ type: 'el-sbobinator-oauth', fragment: '#state=stale&result=ok' });
    expect(channel.size()).toBe(1);
    reply({ error: 'admin_policy_enforced' });
    await expect(connecting).rejects.toMatchObject({ code: 'admin_policy_enforced' });
    expect(channel.close).toHaveBeenCalled();

    const expired = auth.connect();
    reply({ error: 'login_expired' });
    await expect(expired).rejects.toMatchObject({ message: expect.stringContaining('troppo a lungo') });

    // Linked, but no cookie came back with it (cookies blocked for the site).
    const noCookie = auth.connect();
    reply({ result: 'ok' });
    const error = await noCookie.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriveAuthError);
    expect((error as DriveAuthError).code).toBe('cookie_blocked');
    expect(auth.needsReconnect()).toBe(false);

    const blocked = setup({ openWindow: () => null });
    await expect(blocked.auth.connect()).rejects.toMatchObject({ code: 'popup_blocked' });
  });

  it('accepts the window.opener answer from this origin only, and gives up after a while', async () => {
    vi.useFakeTimers();
    try {
      const events = fakeChannel();
      const { auth, opened, server } = setup({ openChannel: () => null, windowEvents: events, timeoutMs: 5000 });
      server.state.login = { email: 'studente@example.com' };
      const connecting = auth.connect();
      const state = new URL(opened[0]).searchParams.get('state')!;
      const fragment = `#${new URLSearchParams({ state, result: 'ok' }).toString()}`;
      events.post({ type: 'el-sbobinator-oauth', fragment }, 'https://evil.example');
      expect(server.requests).toEqual([]);
      events.post({ type: 'el-sbobinator-oauth', fragment }, ORIGIN);
      await expect(connecting).resolves.toMatchObject({ accessToken: 'tok-1' });
      const timedOut = auth.connect();
      vi.advanceTimersByTime(5000);
      await expect(timedOut).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks Google for drive.file on its own for the export, never touching the tab\'s login', async () => {
    localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
    const { auth, reply, opened, server } = setup();
    server.state.login = { email: 'studente@example.com' };
    await auth.freshToken();

    const exporting = auth.connectExport();
    const url = new URL(opened.at(-1)!);
    expect(`${url.origin}${url.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(DRIVE_FILE_SCOPE);
    expect(url.searchParams.get('response_type')).toBe('token');
    // Its token carries drive.file only: the sync's token never gains it.
    expect(url.searchParams.get('include_granted_scopes')).toBe('false');
    expect(url.searchParams.get('login_hint')).toBe('studente@example.com');
    // Google asks only for the new permission: no account choice forced.
    expect(url.searchParams.has('prompt')).toBe(false);
    reply({ access_token: 'tok-export', token_type: 'Bearer', expires_in: '3600', scope: DRIVE_FILE_SCOPE });
    await expect(exporting).resolves.toMatchObject({ accessToken: 'tok-export' });
    expect(auth.token()).toBe('tok-1');

    // The box left unticked: no token, a clear reason.
    const refused = auth.connectExport();
    reply({ access_token: 'tok-x', token_type: 'Bearer', expires_in: '3600', scope: DRIVE_APPDATA_SCOPE });
    await expect(refused).rejects.toMatchObject({ code: 'file_scope_missing', message: expect.stringContaining('permesso di creare file') });
  });

  it('keeps the account for this page when localStorage is blocked', async () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError'); };
    const local = { getItem: blocked, setItem: blocked, removeItem: blocked } as unknown as Storage;
    const session = { getItem: blocked, setItem: blocked, removeItem: blocked } as unknown as Storage;
    const { auth, server } = setup({ local, session });
    auth.setAccount('studente@example.com');
    expect(auth.account()).toBe('studente@example.com');
    server.state.login = { email: 'studente@example.com' };
    expect(await auth.freshToken()).toBe('tok-1');

    await auth.disconnect();
    expect(auth.account()).toBeNull();
  });

  it('keeps the account for this page when localStorage refuses the write', () => {
    const local = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); }, removeItem: () => {} } as unknown as Storage;
    const { auth } = setup({ local });
    auth.setAccount('studente@example.com');
    expect(auth.account()).toBe('studente@example.com');
  });
});

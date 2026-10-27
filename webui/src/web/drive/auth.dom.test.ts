import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../storageKeys';
import { DriveAuthError, createDriveAuth, type DriveAuthOptions } from './auth';
import { DRIVE_APPDATA_SCOPE } from './oauth';

type Listener = (event: MessageEvent) => void;

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

function setup(overrides: Partial<DriveAuthOptions> = {}) {
  const channel = fakeChannel();
  const opened: string[] = [];
  const fetchImpl = vi.fn(async () => new Response('{}'));
  let now = 1_000_000;
  const auth = createDriveAuth({
    clientId: '1-abc.apps.googleusercontent.com',
    redirectUri: 'https://elsbobinator.com/drive-auth',
    origin: 'https://elsbobinator.com',
    openWindow: url => { opened.push(url); return {} as Window; },
    openChannel: () => channel,
    windowEvents: null,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    now: () => now,
    ...overrides,
  });
  const reply = (fields: Record<string, string>) => {
    const state = new URL(opened.at(-1)!).searchParams.get('state')!;
    channel.post({ type: 'el-sbobinator-oauth', fragment: `#${new URLSearchParams({ state, ...fields }).toString()}` });
  };
  return { auth, channel, opened, fetchImpl, reply, advance: (ms: number) => { now += ms; } };
}

const tokenFields = { access_token: 'tok-1', token_type: 'Bearer', expires_in: '3600', scope: DRIVE_APPDATA_SCOPE };

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('Drive auth', () => {
  it('keeps the token in sessionStorage until it is about to expire, never in localStorage', async () => {
    const { auth, reply, advance } = setup();
    const connecting = auth.connect();
    reply(tokenFields);
    await expect(connecting).resolves.toMatchObject({ accessToken: 'tok-1' });
    expect(auth.token()).toBe('tok-1');
    expect(sessionStorage.getItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1)).toContain('tok-1');
    expect(JSON.stringify({ ...localStorage })).not.toContain('tok-1');

    // A reloaded page (new auth object) still finds it within the hour.
    const reloaded = setup();
    expect(reloaded.auth.token()).toBe('tok-1');
    advance(3600_000 - 30_000);
    expect(auth.token()).toBeNull();
  });

  it('reconnects the remembered account silently and forgets it on disconnect, revoking the token', async () => {
    const { auth, reply, opened, fetchImpl } = setup();
    auth.setAccount('studente@uniupo.it');
    const connecting = auth.connect({ silent: true });
    const url = new URL(opened[0]);
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('studente@uniupo.it');
    reply(tokenFields);
    await connecting;

    await auth.disconnect();
    expect(auth.token()).toBeNull();
    expect(auth.account()).toBeNull();
    expect(sessionStorage.getItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1)).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({ method: 'POST', body: 'token=tok-1' }));
  });

  it('asks for the account when nothing is remembered, and expire() keeps the account', async () => {
    const { auth, reply, opened } = setup();
    const connecting = auth.connect({ silent: true });
    expect(new URL(opened[0]).searchParams.get('prompt')).toBe('select_account');
    reply(tokenFields);
    await connecting;
    auth.setAccount('a@b.it');
    auth.expire();
    expect(auth.token()).toBeNull();
    expect(auth.account()).toBe('a@b.it');
  });

  it('ignores answers to another login and reports Google errors and blocked windows', async () => {
    const { auth, reply, channel } = setup();
    const connecting = auth.connect();
    channel.post({ type: 'el-sbobinator-oauth', fragment: '#state=stale&access_token=x&token_type=Bearer&expires_in=10' });
    expect(channel.size()).toBe(1);
    reply({ error: 'admin_policy_enforced' });
    await expect(connecting).rejects.toMatchObject({ code: 'admin_policy_enforced' });
    expect(channel.close).toHaveBeenCalled();

    const silent = auth.connect({ silent: true });
    reply({ error: 'interaction_required' });
    const error = await silent.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DriveAuthError);
    expect((error as DriveAuthError).needsInteractiveLogin).toBe(true);

    const blocked = setup({ openWindow: () => null });
    await expect(blocked.auth.connect()).rejects.toMatchObject({ code: 'popup_blocked' });
  });

  it('accepts the window.opener answer from this origin only, and gives up after a while', async () => {
    vi.useFakeTimers();
    try {
      const events = fakeChannel();
      const { auth, opened } = setup({ openChannel: () => null, windowEvents: events, timeoutMs: 5000 });
      const connecting = auth.connect();
      const state = new URL(opened[0]).searchParams.get('state')!;
      const fragment = `#${new URLSearchParams({ state, ...tokenFields }).toString()}`;
      events.post({ type: 'el-sbobinator-oauth', fragment }, 'https://evil.example');
      expect(auth.token()).toBeNull();
      events.post({ type: 'el-sbobinator-oauth', fragment }, 'https://elsbobinator.com');
      await expect(connecting).resolves.toMatchObject({ accessToken: 'tok-1' });
      const timedOut = auth.connect();
      vi.advanceTimersByTime(5000);
      await expect(timedOut).rejects.toMatchObject({ code: 'timeout' });
    } finally {
      vi.useRealTimers();
    }
  });
});

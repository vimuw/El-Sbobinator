import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../../storageKeys';
import { createWebArchive, type NewArchiveSession } from '../webSessions';
import { DriveAuthError, createDriveAuth } from './auth';
import { DriveError, createDriveApi } from './driveApi';
import { createDriveService, describeDriveError, type DriveServiceOptions } from './driveService';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './fakeDrive';
import { sessionFileName, toSessionFile } from './syncFormat';
import { bindAccount, readMeta, readRecords, trackArchive } from './syncState';

const input = (name: string): NewArchiveSession => ({
  name,
  input_name: `${name}.mp3`,
  completed_at_iso: '2026-10-27T08:00:00.000Z',
  effective_model: 'gemini-2.5-flash',
  input_path: 'web-file://locale',
  completion_status: 'completed',
});

function device(drive: FakeDrive, name: string, overrides: Partial<DriveServiceOptions> & { token?: boolean; email?: string | null } = {}) {
  const factory = new IDBFactory();
  const login = createFakeAuth(name, { token: overrides.token, email: overrides.email });
  const api = createDriveApi({ getToken: () => login.auth.token(), onUnauthorized: () => login.auth.expire(), fetchImpl: drive.fetch, sleep: async () => {}, random: () => 0 });
  let busy = false;
  const reports: unknown[] = [];
  const service = createDriveService({
    factory,
    auth: login.auth,
    api,
    isBusy: () => busy,
    onReport: report => reports.push(report),
    delayMs: 20,
    ...overrides,
  });
  const archive = trackArchive(factory, () => service.schedule());
  return { factory, service, archive, login, reports, setBusy: (value: boolean) => { busy = value; } };
}

const listCalls = (drive: FakeDrive) => drive.requests.filter(request => request.method === 'GET' && /\/files\?/.test(request.url)).length;

describe('Drive sync service', () => {
  it('stays idle without an account, and the first connection sends what the browser already holds', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc');
    await createWebArchive(pc.factory).create(input('Anatomia'), '<p>ossa</p>');
    const stop = pc.service.start();
    await pc.service.syncNow();
    expect(drive.requests).toEqual([]);
    expect(pc.service.status()).toMatchObject({ available: true, connected: false, needs_reconnect: false, last_sync_at: null });

    const status = await pc.service.connect();
    expect(pc.login.calls).toEqual([{ silent: false }]);
    expect(status).toMatchObject({ connected: true, email: 'studente@example.com', needs_reconnect: false, syncing: false, error: null });
    expect(status.last_sync_at).not.toBeNull();
    expect(drive.files()).toHaveLength(1);
    expect((await readMeta(pc.factory)).account).toBe('studente@example.com');
    stop();
  });

  it('opens the Google window before any await, silently when the account is remembered', () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { email: 'studente@example.com' });
    void pc.service.connect();
    expect(pc.login.calls).toEqual([{ silent: true }]);
  });

  it('asks for the full account choice on the next tap after Google refuses a silent login', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { email: 'studente@example.com' });
    expect(pc.service.status()).toMatchObject({ connected: true, needs_reconnect: true });
    pc.login.failures.push(new DriveAuthError('interaction_required'));
    const refused = await pc.service.connect();
    expect(refused.error).toContain('tocca di nuovo');
    expect(refused.needs_reconnect).toBe(true);
    const status = await pc.service.connect();
    expect(pc.login.calls).toEqual([{ silent: true }, { silent: false }]);
    expect(status).toMatchObject({ needs_reconnect: false, error: null });
  });

  it('syncs once a few moments after a burst of local changes', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    const session = await pc.archive.create(input('Fisiologia'), '<p>uno</p>');
    await pc.archive.update(session.session_dir, { name: 'Fisiologia 1' });
    await pc.archive.update(session.session_dir, { name: 'Fisiologia 2' });
    expect(listCalls(drive)).toBe(0);
    await vi.waitFor(() => expect(drive.files()).toHaveLength(1));
    await vi.waitFor(() => expect(pc.service.status().syncing).toBe(false));
    expect(listCalls(drive)).toBe(1);
    expect(drive.files()[0].content).toMatchObject({ session: { name: 'Fisiologia 2' } });
  });

  it('waits for the Gemini run to end before syncing', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    pc.setBusy(true);
    await pc.archive.create(input('Chimica'), '<p>due</p>');
    expect(pc.service.status().waiting_for_run).toBe(false);
    // The tap is kept, and the status says so: the settings and the sidebar tell it to the user.
    expect(await pc.service.syncNow()).toMatchObject({ syncing: false, waiting_for_run: true });
    expect(drive.requests).toEqual([]);
    pc.setBusy(false);
    pc.service.runEnded();
    expect(pc.service.status().waiting_for_run).toBe(false);
    await vi.waitFor(() => expect(drive.files()).toHaveLength(1));
  });

  it('runs one round at a time and one more for a change made during it', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Biologia'), '<p>tre</p>');
    const first = pc.service.syncNow();
    // Asked for before the first round starts: that round serves both.
    await Promise.all([first, pc.service.syncNow()]);
    expect(listCalls(drive)).toBe(1);
    // Asked for once a round is on the network: it may have read the archive already, one more follows.
    await createWebArchive(pc.factory).create(input('Chimica'), '<p>quattro</p>');
    const running = pc.service.syncNow();
    await vi.waitFor(() => expect(listCalls(drive)).toBe(2));
    const next = pc.service.syncNow();
    await Promise.all([running, next]);
    expect(listCalls(drive)).toBe(3);
    expect(drive.files()).toHaveLength(2);
  });

  it('reports an expired login and offers the reconnect tap', async () => {
    const drive = createFakeDrive();
    const onNeedsReconnect = vi.fn();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com', onNeedsReconnect });
    await pc.service.syncNow();
    drive.expireTokens();
    const status = await pc.service.syncNow();
    expect(onNeedsReconnect).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({ connected: true, needs_reconnect: true, error: 'Accesso a Google Drive scaduto: tocca per riconnettere.' });
    expect((await pc.service.connect()).needs_reconnect).toBe(false);
  });

  it('retries when the page comes back online or to the foreground', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    drive.setOffline(true);
    const stop = pc.service.start();
    await vi.waitFor(() => expect(pc.service.status().error).toContain('non raggiungibile'));
    await pc.archive.create(input('Istologia'), '<p>quattro</p>');
    drive.setOffline(false);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(pc.service.status().error).toBeNull());
    expect(drive.files()).toHaveLength(1);

    const before = listCalls(drive);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(listCalls(drive)).toBe(before + 1));
    stop();
    window.dispatchEvent(new Event('online'));
    await pc.service.syncNow();
    expect(listCalls(drive)).toBe(before + 2);
  });

  it('shows the last sync of an earlier page after a reload', async () => {
    const drive = createFakeDrive();
    // Every reading of the clock is a millisecond later: the shown and the stored time must be one reading.
    let tick = Date.parse('2026-10-27T18:00:00.000Z');
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com', now: () => new Date(tick++) });
    await pc.service.syncNow();
    const reloaded = createDriveService({ factory: pc.factory, auth: pc.login.auth, api: createDriveApi({ getToken: () => null }), isBusy: () => false });
    drive.setOffline(true);
    const stop = reloaded.start();
    await vi.waitFor(() => expect(reloaded.status().last_sync_at).toBe(pc.service.status().last_sync_at));
    stop();
  });

  it('forgets the account on "Disconnetti" and ignores the round in flight', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Genetica'), '<p>cinque</p>');
    const round = pc.service.syncNow();
    const status = await pc.service.disconnect();
    await round;
    expect(pc.login.disconnects).toHaveLength(1);
    expect(status).toMatchObject({ connected: false, email: null, needs_reconnect: false, syncing: false, last_sync_at: null, error: null });
    expect(pc.service.status()).toMatchObject({ last_sync_at: null, error: null });
  });

  it('starts from scratch on another account, sending every sbobina to its Drive', async () => {
    const first = createFakeDrive();
    const pc = device(first, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Patologia'), '<p>sei</p>');
    await pc.service.connect();
    expect(first.files()).toHaveLength(1);
    const [record] = (await readRecords(pc.factory)).values();
    expect(record.file_id).toBeDefined();

    // The same browser linked to another Google account (another Drive).
    const second = createFakeDrive();
    const other = createDriveApi({ getToken: () => pc.login.auth.token(), fetchImpl: second.fetch, sleep: async () => {} });
    vi.spyOn(other, 'accountEmail').mockResolvedValue('altro@example.com');
    const service = createDriveService({ factory: pc.factory, auth: pc.login.auth, api: other, isBusy: () => false });
    await service.connect();
    expect(second.files()).toHaveLength(1);
    expect((await readMeta(pc.factory)).account).toBe('altro@example.com');
  });

  it('drops the token of a login whose account could not be read: no round syncs into an unbound Drive', async () => {
    const first = createFakeDrive();
    const pc = device(first, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Patologia'), '<p>sei</p>');
    await pc.service.connect();
    await pc.service.disconnect();

    // Another account picked in the Google window, then the account read fails (offline, 5xx) or says nothing.
    const second = createFakeDrive({ email: 'altro@example.com' });
    const other = createDriveApi({ getToken: () => pc.login.auth.token(), fetchImpl: second.fetch, sleep: async () => {} });
    vi.spyOn(other, 'accountEmail').mockRejectedValueOnce(new DriveError(0, 'offline')).mockResolvedValueOnce('');
    const service = createDriveService({ factory: pc.factory, auth: pc.login.auth, api: other, isBusy: () => false });
    const archive = trackArchive(pc.factory, () => {});
    const [session] = await archive.list();
    for (const attempt of ['offline', 'empty']) {
      const status = await service.connect();
      expect(status.error, attempt).toBe(attempt === 'offline' ? 'Google Drive non raggiungibile: le modifiche partiranno quando torna la connessione.' : 'Sincronizzazione non riuscita: Google Drive non ha indicato l’account collegato.');
      expect(pc.login.auth.token(), attempt).toBeNull();
      await archive.saveHtml(session.html_path, `<p>${attempt}</p>`, Date.now());
      await service.syncNow();
      expect(second.files(), attempt).toEqual([]);
      expect((await readMeta(pc.factory)).account).toBe('studente@example.com');
    }

    // The next tap binds the account and only then sends the archive to its Drive.
    await service.connect();
    expect((await readMeta(pc.factory)).account).toBe('altro@example.com');
    expect(second.files().map(file => (file.content as { body: string }).body)).toEqual(['<p>empty</p>']);
  });

  it('brings the other account\'s older sbobine even when rounds run while it is being bound', async () => {
    const first = createFakeDrive();
    // The first account's Drive is busy: its listing watermark ends far ahead of the other Drive's clock.
    for (let write = 0; write < 150; write++) first.put('altro.json', {});
    const pc = device(first, 'pc', { token: true, email: 'studente@example.com' });
    await pc.service.connect();

    const second = createFakeDrive();
    const dir = 'web-session://11111111-2222-4333-8444-555555555555';
    const old = { session_dir: dir, html_path: `${dir}/sbobina.html`, name: 'Dal tablet', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: '', input_path: '' };
    second.put(sessionFileName(dir), toSessionFile(old, '<p>vecchia</p>', 0, { updated_at: '2026-10-27T08:00:01.000Z', device_id: 'tablet' }));
    const other = createDriveApi({ getToken: () => pc.login.auth.token(), fetchImpl: second.fetch, sleep: async () => {} });
    let answerEmail!: (email: string) => void;
    vi.spyOn(other, 'accountEmail').mockImplementation(() => new Promise(resolve => { answerEmail = resolve; }));
    const list = other.listChanged.bind(other);
    let answerList: (() => void) | null = null;
    vi.spyOn(other, 'listChanged').mockImplementationOnce(async since => {
      await new Promise<void>(resolve => { answerList = resolve; });
      return list(since);
    });
    const service = createDriveService({ factory: pc.factory, auth: pc.login.auth, api: other, isBusy: () => false });

    // A round is on the network when the login answers, and the tab coming back asks for another.
    const running = service.syncNow();
    await vi.waitFor(() => expect(answerList).not.toBeNull());
    const connecting = service.connect();
    await Promise.resolve();
    const again = service.syncNow();
    answerList!();
    await vi.waitFor(() => expect(answerEmail).toBeDefined());
    answerEmail('altro@example.com');
    await Promise.all([running, connecting, again]);

    expect(await createWebArchive(pc.factory).get(dir)).toMatchObject({ name: 'Dal tablet' });
    expect((await readMeta(pc.factory)).account).toBe('altro@example.com');
  });

  it('drops the token of an account this browser has left (a tab restored with it): no round, no erase on its Drive', async () => {
    // Regression: a tab reopened or duplicated with its sessionStorage kept the previous account's
    // token, and its rounds and "Elimina tutti i miei dati" worked on that account's Drive.
    const drive = createFakeDrive();
    const reconnects = vi.fn();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com', onNeedsReconnect: reconnects });
    await bindAccount(pc.factory, 'studente@example.com');
    await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    await pc.service.syncNow();
    expect(drive.files()).toHaveLength(1);

    // Another account was connected in this browser since; this tab still holds the first one's token.
    await bindAccount(pc.factory, 'altro@example.com');
    const requests = drive.requests.length;
    expect(await pc.service.syncNow()).toMatchObject({ needs_reconnect: true });
    pc.login.auth.adopt({ accessToken: 'pc-0', expiresAt: Date.now() + 3_600_000, scopes: [] });
    pc.login.auth.setAccount('studente@example.com');
    expect(await pc.service.erase()).toMatchObject({ removed: 0 });
    expect(drive.requests.length).toBe(requests);
    expect(drive.files()).toHaveLength(1);
    expect(reconnects).toHaveBeenCalledTimes(2);
    expect(pc.login.auth.token()).toBeNull();
  });

  describe('a tab restored with its token after another tab left Drive', () => {
    // The real login: sessionStorage per tab, the remembered account in the shared localStorage.
    const memoryStorage = (): Storage => {
      const items = new Map<string, string>();
      return {
        get length() { return items.size; },
        clear: () => items.clear(),
        getItem: key => items.get(key) ?? null,
        key: index => [...items.keys()][index] ?? null,
        removeItem: key => { items.delete(key); },
        setItem: (key, value) => { items.set(key, String(value)); },
      };
    };
    let first = createFakeDrive();
    let second = createFakeDrive({ email: 'altro@example.com' });
    const tab =(factory: IDBFactory, token: string | null, account: string) => {
      const session = memoryStorage();
      if (token) session.setItem(STORAGE_KEYS.WEB_DRIVE_TOKEN_V1, JSON.stringify({ accessToken: token, expiresAt: Date.now() + 3_600_000, scopes: [], account }));
      const auth = createDriveAuth({ clientId: 'id', redirectUri: 'https://elsbobinator.com/drive-auth', session, fetchImpl: vi.fn(async () => new Response()) });
      const api = createDriveApi({
        getToken: () => auth.token(),
        fetchImpl: (url, init) => (new Headers(init?.headers).get('Authorization') === 'Bearer tok-altro' ? second : first).fetch(url, init),
        sleep: async () => {},
      });
      const reconnects = vi.fn();
      return { auth, reconnects, service: createDriveService({ factory, auth, api, isBusy: () => false, onNeedsReconnect: reconnects }) };
    };
    const setup = async () => {
      localStorage.clear();
      first = createFakeDrive();
      second = createFakeDrive({ email: 'altro@example.com' });
      const factory = new IDBFactory();
      await createWebArchive(factory).create(input('Anatomia'), '<p>ossa</p>');
      localStorage.setItem(STORAGE_KEYS.WEB_DRIVE_ACCOUNT_V1, 'studente@example.com');
      await bindAccount(factory, 'studente@example.com');
      return factory;
    };
    afterEach(() => localStorage.clear());

    it('sends nothing to the other account\'s Drive after "Elimina dati Drive"', async () => {
      // Regression: the erase left the state unbound, and a tab closed while linked to the other
      // account came back with its token and sent the whole archive to that Drive.
      const factory = await setup();
      const restored = tab(factory, 'tok-altro', 'altro@example.com');
      expect(await tab(factory, 'tok-studente', 'studente@example.com').service.erase()).toMatchObject({ connected: false });

      expect(await restored.service.syncNow()).toMatchObject({ connected: false, needs_reconnect: false });
      expect(second.requests).toEqual([]);
      expect(restored.auth.token()).toBeNull();
      expect(restored.reconnects).not.toHaveBeenCalled();
    });

    it('stays disconnected after "Disconnetti" in a tab whose token had expired', async () => {
      // Regression: with nothing to revoke the binding stayed, and a restored tab of the same account
      // went on syncing (the settings read "Collegato") after the user disconnected.
      const factory = await setup();
      const restored = tab(factory, 'tok-studente', 'studente@example.com');
      await tab(factory, null, 'studente@example.com').service.disconnect();

      expect(await restored.service.syncNow()).toMatchObject({ connected: false });
      expect(first.files()).toEqual([]);
      expect(first.requests).toEqual([]);
      expect(restored.auth.token()).toBeNull();
      expect(restored.reconnects).not.toHaveBeenCalled();
    });
  });

  it('keeps the emptied Drive empty when a round is asked for during the erase', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    await pc.service.syncNow();
    expect(drive.files()).toHaveLength(1);

    const erased = pc.service.erase();
    // The page comes back to the foreground while the folder is emptied.
    const waiting = pc.service.syncNow();
    expect(await erased).toMatchObject({ removed: 1, connected: false, needs_reconnect: false });
    await waiting;
    expect(drive.files()).toHaveLength(0);
    expect(await readRecords(pc.factory)).toEqual(new Map());
  });

  it('binds a new login before any round uses its token', async () => {
    const first = createFakeDrive();
    const pc = device(first, 'pc', { token: true, email: 'studente@example.com' });
    await bindAccount(pc.factory, 'studente@example.com');
    await pc.archive.create(input('Anatomia'), '<p>ossa</p>');
    await pc.service.syncNow();
    const second = createFakeDrive({ email: 'altro@example.com' });
    // The first token reaches the first Drive; the one of the new login, the other Drive.
    const api = createDriveApi({
      getToken: () => pc.login.auth.token(),
      fetchImpl: (url, init) => (new Headers(init?.headers).get('Authorization') === 'Bearer pc-0' ? first : second).fetch(url, init),
      sleep: async () => {},
    });
    const list = api.listChanged.bind(api);
    let answerList: (() => void) | null = null;
    vi.spyOn(api, 'listChanged').mockImplementationOnce(async since => {
      await new Promise<void>(resolve => { answerList = resolve; });
      return list(since);
    });
    const service = createDriveService({ factory: pc.factory, auth: pc.login.auth, api, isBusy: () => false });

    // A round of the first account is on the network when the login answers; another is asked for.
    const running = service.syncNow();
    await vi.waitFor(() => expect(answerList).not.toBeNull());
    const connecting = service.connect();
    await Promise.resolve();
    const again = service.syncNow();
    answerList!();
    await Promise.all([running, connecting, again]);

    // The other Drive is asked whose it is before anything else: no round used it unbound.
    expect(second.requests[0]?.url).toContain('/about');
    expect((await readMeta(pc.factory)).account).toBe('altro@example.com');
    expect(second.files()).toHaveLength(1);
  });
});

describe('describeDriveError', () => {
  it('names quota, offline and unknown errors in Italian', async () => {
    const { DriveError } = await import('./driveApi');
    expect(describeDriveError(new DriveError(403, 'x', 'storageQuotaExceeded'))).toContain('Spazio su Google Drive esaurito');
    expect(describeDriveError(new DriveError(0, 'x'))).toContain('non raggiungibile');
    expect(describeDriveError(new DriveError(500, 'Google Drive ha risposto 500'))).toBe('Google Drive ha risposto 500');
    expect(describeDriveError(new DriveAuthError('popup_blocked'))).toContain('pop-up');
    expect(describeDriveError(new DriveAuthError('interaction_required'))).toBe('Google chiede di confermare l’accesso: tocca di nuovo il pulsante per scegliere l’account.');
    expect(describeDriveError(new Error('boom'))).toBe('Sincronizzazione non riuscita: boom');
  });
});

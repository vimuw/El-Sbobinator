import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createWebArchive, type NewArchiveSession } from '../webSessions';
import { DriveAuthError } from './auth';
import { DriveError, createDriveApi } from './driveApi';
import { createDriveService, describeDriveError, type DriveServiceOptions } from './driveService';
import { createFakeAuth, createFakeDrive, createFakeLocks, type FakeDrive } from './fakeDrive';
import { sessionFileName, toSessionFile } from './syncFormat';
import { bindAccount, readMeta, readRecords, trackArchive } from './syncState';
import { createTabLocks } from './tabLocks';

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
    await pc.service.syncNow();
    expect(drive.requests).toEqual([]);
    pc.setBusy(false);
    pc.service.runEnded();
    await vi.waitFor(() => expect(drive.files()).toHaveLength(1));
  });

  it('lets the round in progress end before a held write, and runs the one asked for meanwhile after it', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Biologia'), '<p>tre</p>');
    const round = pc.service.syncNow();
    let listsDuringWork = -1;
    const held = pc.service.hold(async () => {
      const lists = listCalls(drive);
      void pc.service.syncNow();
      await new Promise(resolve => setTimeout(resolve, 50));
      listsDuringWork = listCalls(drive) - lists;
      return 'fatto';
    });
    await round;
    expect(await held).toBe('fatto');
    expect(listsDuringWork).toBe(0);
    await vi.waitFor(() => expect(listCalls(drive)).toBe(2));
  });

  it('runs one round at a time and one more for a change made during it', async () => {
    const drive = createFakeDrive();
    const pc = device(drive, 'pc', { token: true, email: 'studente@example.com' });
    await createWebArchive(pc.factory).create(input('Biologia'), '<p>tre</p>');
    const first = pc.service.syncNow();
    const second = pc.service.syncNow();
    await Promise.all([first, second]);
    expect(listCalls(drive)).toBe(2);
    expect(drive.files()).toHaveLength(1);
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

  it('stops the tabs still holding the previous account\'s token once another tab connects a different one', async () => {
    const first = createFakeDrive();
    const second = createFakeDrive({ email: 'altro@example.com' });
    // Tabs of one browser: one database, one remembered account, a token each.
    const factory = new IDBFactory();
    const shared = { email: 'studente@example.com' as string | null };
    const tab = (drive: FakeDrive, name: string) => {
      const login = createFakeAuth(name, { token: true, shared });
      const api = createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} });
      const reconnects: string[] = [];
      const service = createDriveService({ factory, auth: login.auth, api, isBusy: () => false, onNeedsReconnect: () => reconnects.push(name) });
      return { service, reconnects };
    };
    const switching = tab(second, 'scheda-a');
    const syncing = tab(first, 'scheda-b');
    const erasing = tab(first, 'scheda-c');
    await bindAccount(factory, 'studente@example.com');
    const archive = trackArchive(factory, () => {});
    const session = await archive.create(input('Patologia'), '<p>uno</p>');
    await syncing.service.syncNow();
    expect(first.files()).toHaveLength(1);

    await switching.service.connect();
    expect(second.files()).toHaveLength(1);
    await archive.saveHtml(session.html_path, '<p>due</p>', Date.now());
    await archive.create(input('Nuova'), '<p>nuova</p>');

    // The previous account's Drive receives nothing more, and is not emptied from here.
    expect(await syncing.service.syncNow()).toMatchObject({ email: 'altro@example.com', needs_reconnect: true });
    expect(await erasing.service.erase()).toMatchObject({ removed: 0, needs_reconnect: true });
    expect(first.files()).toHaveLength(1);
    expect([...syncing.reconnects, ...erasing.reconnects]).toEqual(['scheda-b', 'scheda-c']);

    // The tab of the new account sends both changes to its Drive.
    await switching.service.syncNow();
    expect(second.files().map(file => (file.content as { body: string }).body).sort()).toEqual(['<p>due</p>', '<p>nuova</p>']);
    expect(await createWebArchive(factory).readHtml(session.html_path)).toContain('<p>due</p>');
  });

  it('stops a tab that still reads the previous account once another tab has bound a different one', async () => {
    const first = createFakeDrive();
    const second = createFakeDrive({ email: 'altro@example.com' });
    const factory = new IDBFactory();
    const locks = createTabLocks(createFakeLocks());
    const shared = { email: 'studente@example.com' as string | null };
    // Tabs B and C read the remembered account late (localStorage reaches other tabs a moment later):
    // for them it is still the previous one, while the database already names the new one.
    const tab = (drive: FakeDrive, name: string, remembered?: { email: string | null }) => {
      const login = createFakeAuth(name, { token: true, shared: remembered ?? { email: 'studente@example.com' } });
      const api = createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} });
      const reconnects: string[] = [];
      const service = createDriveService({ factory, auth: login.auth, api, isBusy: () => false, exclusive: run => locks.exclusive(run), onNeedsReconnect: () => reconnects.push(name) });
      return { service, reconnects };
    };
    const switching = tab(second, 'scheda-a', shared);
    const syncing = tab(first, 'scheda-b');
    const erasing = tab(first, 'scheda-c');
    await bindAccount(factory, 'studente@example.com');
    const archive = trackArchive(factory, () => {});
    await archive.create(input('Patologia'), '<p>uno</p>');
    await syncing.service.syncNow();
    expect(first.files()).toHaveLength(1);

    await switching.service.connect();
    await archive.create(input('Nuova'), '<p>nuova</p>');
    const before = [...(await readRecords(factory)).values()];

    // The previous account's Drive receives nothing and is not emptied, and the new account's state
    // keeps no file of it.
    expect(await syncing.service.syncNow()).toMatchObject({ needs_reconnect: true });
    expect(await erasing.service.erase()).toMatchObject({ removed: 0, needs_reconnect: true });
    expect(first.files()).toHaveLength(1);
    expect([...(await readRecords(factory)).values()]).toEqual(before);
    expect(await readMeta(factory)).toMatchObject({ account: 'altro@example.com' });
    expect(await readMeta(factory)).not.toHaveProperty('erased');
    expect([...syncing.reconnects, ...erasing.reconnects]).toEqual(['scheda-b', 'scheda-c']);

    // The tab of the new account sends both sbobine to its Drive.
    await switching.service.syncNow();
    expect(second.files().map(file => (file.content as { body: string }).body).sort()).toEqual(['<p>nuova</p>', '<p>uno</p>']);
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

  it('binds another account only once the round of another tab is over, so its Drive receives what that round downloaded', async () => {
    const first = createFakeDrive();
    const second = createFakeDrive({ email: 'altro@example.com' });
    const factory = new IDBFactory();
    const shared = { email: 'studente@example.com' as string | null };
    const locks = createTabLocks(createFakeLocks());
    const tab = (drive: FakeDrive, name: string) => {
      const login = createFakeAuth(name, { token: true, shared });
      const api = createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} });
      return { api, service: createDriveService({ factory, auth: login.auth, api, isBusy: () => false, exclusive: run => locks.exclusive(run) }) };
    };
    await bindAccount(factory, 'studente@example.com');
    // Made on the tablet: only on the first account's Drive.
    const dir = 'web-session://11111111-2222-4333-8444-555555555555';
    const old = { session_dir: dir, html_path: `${dir}/sbobina.html`, name: 'Dal tablet', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: '', input_path: '' };
    first.put(sessionFileName(dir), toSessionFile(old, '<p>tablet</p>', 0, { updated_at: '2026-10-27T08:00:01.000Z', device_id: 'tablet' }));
    const syncing = tab(first, 'scheda-b');
    const switching = tab(second, 'scheda-a');
    const read = syncing.api.readJson.bind(syncing.api);
    let answerRead: (() => void) | null = null;
    vi.spyOn(syncing.api, 'readJson').mockImplementation(async id => {
      const value = await read(id);
      await new Promise<void>(resolve => { answerRead = resolve; });
      return value;
    });

    // Tab B is downloading the tablet's sbobina when tab A connects the other account.
    const downloading = syncing.service.syncNow();
    await vi.waitFor(() => expect(answerRead).not.toBeNull());
    const connecting = switching.service.connect();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect((await readMeta(factory)).account).toBe('studente@example.com');
    answerRead!();
    await Promise.all([downloading, connecting]);

    expect(await createWebArchive(factory).get(dir)).toMatchObject({ name: 'Dal tablet' });
    expect((await readMeta(factory)).account).toBe('altro@example.com');
    expect(second.files().map(file => file.name)).toContain(sessionFileName(dir));
  });

  it('keeps a round waiting for another tab\'s lock out of a login until its account is bound', async () => {
    const first = createFakeDrive();
    const second = createFakeDrive({ email: 'altro@example.com' });
    const factory = new IDBFactory();
    const shared = { email: 'studente@example.com' as string | null };
    const locks = createTabLocks(createFakeLocks());
    await bindAccount(factory, 'studente@example.com');
    await trackArchive(factory, () => {}).create(input('Anatomia'), '<p>ossa</p>');
    const dir = 'web-session://11111111-2222-4333-8444-555555555555';
    const old = { session_dir: dir, html_path: `${dir}/sbobina.html`, name: 'Dal tablet', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: '', input_path: '' };
    first.put(sessionFileName(dir), toSessionFile(old, '<p>tablet</p>', 0, { updated_at: '2026-10-27T08:00:01.000Z', device_id: 'tablet' }));

    const loginB = createFakeAuth('scheda-b', { token: true, shared });
    const apiB = createDriveApi({ getToken: () => loginB.auth.token(), fetchImpl: first.fetch, sleep: async () => {} });
    const read = apiB.readJson.bind(apiB);
    let answerRead: (() => void) | null = null;
    vi.spyOn(apiB, 'readJson').mockImplementation(async id => {
      const value = await read(id);
      await new Promise<void>(resolve => { answerRead = resolve; });
      return value;
    });
    const tabB = createDriveService({ factory, auth: loginB.auth, api: apiB, isBusy: () => false, exclusive: run => locks.exclusive(run) });
    // Tab A's first token is the first account's; the one of the new login reaches the other Drive.
    const loginA = createFakeAuth('scheda-a', { token: true, shared });
    const apiA = createDriveApi({
      getToken: () => loginA.auth.token(),
      fetchImpl: (input, init) => (new Headers(init?.headers).get('Authorization') === 'Bearer scheda-a-0' ? first : second).fetch(input, init),
      sleep: async () => {},
    });
    const tabA = createDriveService({ factory, auth: loginA.auth, api: apiA, isBusy: () => false, exclusive: run => locks.exclusive(run) });

    // Tab B holds the lock while downloading; tab A's round asks for it, then tab A connects the other account.
    const downloading = tabB.syncNow();
    await vi.waitFor(() => expect(answerRead).not.toBeNull());
    const queued = tabA.syncNow();
    await Promise.resolve();
    const connecting = tabA.connect();
    answerRead!();
    await Promise.all([downloading, queued, connecting]);

    // The other Drive is asked whose it is before anything else: no round used it unbound.
    expect(second.requests[0]?.url).toContain('/about');
    expect((await readMeta(factory)).account).toBe('altro@example.com');
    expect(second.files().map(file => file.name)).toContain(sessionFileName(dir));
  });

  it('stops the other tabs once one of them erases the Drive data: nothing goes back to the emptied Drive', async () => {
    const drive = createFakeDrive();
    const factory = new IDBFactory();
    const shared = { email: 'studente@example.com' as string | null };
    const tab = (name: string) => {
      const login = createFakeAuth(name, { token: true, shared });
      const api = createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} });
      const reconnects: string[] = [];
      const service = createDriveService({ factory, auth: login.auth, api, isBusy: () => false, onNeedsReconnect: () => reconnects.push(name) });
      return { service, reconnects };
    };
    await bindAccount(factory, 'studente@example.com');
    await trackArchive(factory, () => {}).create(input('Anatomia'), '<p>ossa</p>');
    const erasing = tab('scheda-a');
    const other = tab('scheda-b');
    await erasing.service.syncNow();
    expect(drive.files()).toHaveLength(1);

    expect(await erasing.service.erase()).toMatchObject({ removed: 1, connected: false });
    // The other tab comes back to the foreground: disconnected as well, not asked to reconnect.
    expect(await other.service.syncNow()).toMatchObject({ connected: false, email: null, needs_reconnect: false });
    expect(drive.files()).toHaveLength(0);
    expect(other.reconnects).toEqual([]);
  });

  it('keeps the emptied Drive empty when another tab\'s round waits for the erase to end', async () => {
    const drive = createFakeDrive();
    const factory = new IDBFactory();
    const locks = createTabLocks(createFakeLocks());
    // Tab B sees the account forgotten by tab A one task late: localStorage reaches the other tabs
    // of the browser on its own schedule, not with the lock.
    const remembered = { email: 'studente@example.com' as string | null };
    const seenByOther = { email: remembered.email };
    const tab = (name: string, shared: { email: string | null }) => {
      const login = createFakeAuth(name, { token: true, shared });
      const api = createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} });
      const reconnects: string[] = [];
      const service = createDriveService({ factory, auth: login.auth, api, isBusy: () => false, exclusive: run => locks.exclusive(run), onNeedsReconnect: () => reconnects.push(name) });
      return { service, reconnects };
    };
    await bindAccount(factory, 'studente@example.com');
    await trackArchive(factory, () => {}).create(input('Anatomia'), '<p>ossa</p>');
    const erasing = tab('scheda-a', remembered);
    const other = tab('scheda-b', seenByOther);
    await erasing.service.syncNow();
    expect(drive.files()).toHaveLength(1);

    const erased = erasing.service.erase();
    await Promise.resolve();
    // Tab B's round asks for the lock while tab A empties the folder, and runs before B learns that
    // the account was forgotten.
    const waiting = other.service.syncNow();
    expect(await erased).toMatchObject({ removed: 1, connected: false });
    await waiting;
    expect(drive.files()).toHaveLength(0);
    expect(other.reconnects).toEqual([]);

    seenByOther.email = remembered.email;
    expect(await other.service.syncNow()).toMatchObject({ connected: false, needs_reconnect: false });
    expect(drive.files()).toHaveLength(0);
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

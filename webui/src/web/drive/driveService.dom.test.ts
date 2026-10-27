import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createWebArchive, type NewArchiveSession } from '../webSessions';
import { DriveAuthError } from './auth';
import { createDriveApi } from './driveApi';
import { createDriveService, describeDriveError, type DriveServiceOptions } from './driveService';
import { createFakeAuth, createFakeDrive, type FakeDrive } from './fakeDrive';
import { readMeta, readRecords, trackArchive } from './syncState';

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
  const archive = trackArchive(createWebArchive(factory), factory, () => service.schedule());
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
});

describe('describeDriveError', () => {
  it('names quota, offline and unknown errors in Italian', async () => {
    const { DriveError } = await import('./driveApi');
    expect(describeDriveError(new DriveError(403, 'x', 'storageQuotaExceeded'))).toContain('Spazio su Google Drive esaurito');
    expect(describeDriveError(new DriveError(0, 'x'))).toContain('non raggiungibile');
    expect(describeDriveError(new DriveError(500, 'Google Drive ha risposto 500'))).toBe('Google Drive ha risposto 500');
    expect(describeDriveError(new DriveAuthError('popup_blocked'))).toContain('pop-up');
    expect(describeDriveError(new Error('boom'))).toBe('Sincronizzazione non riuscita: boom');
  });
});

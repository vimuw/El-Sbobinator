import { describe, expect, it, vi } from 'vitest';
import { DriveError, createDriveApi } from './driveApi';
import { createFakeDrive } from './fakeDrive';

function setup(token: string | null = 'tok') {
  const drive = createFakeDrive();
  const sleep = vi.fn(async () => {});
  const onUnauthorized = vi.fn();
  const api = createDriveApi({ getToken: () => token, fetchImpl: drive.fetch, sleep, random: () => 0, onUnauthorized });
  return { drive, api, sleep, onUnauthorized };
}

describe('Drive API', () => {
  it('creates, lists by modifiedTime, reads, updates and removes JSON files in the app folder', async () => {
    const { api, drive } = setup();
    expect(await api.accountEmail()).toBe('studente@example.com');
    const first = await api.createJson('sbobina-a.json', { a: 1 });
    const second = await api.createJson('raccolte.json', { b: 2 });
    expect(await api.readJson(first.id)).toEqual({ a: 1 });
    expect((await api.listChanged(null)).map(file => file.name)).toEqual(['sbobina-a.json', 'raccolte.json']);
    expect(await api.listChanged(first.modifiedTime)).toEqual([second]);

    const updated = await api.updateJson(first.id, { a: 2 });
    expect(updated.modifiedTime > second.modifiedTime).toBe(true);
    expect(await api.readJson(first.id)).toEqual({ a: 2 });
    await api.remove(second.id);
    expect(drive.files().map(file => file.name)).toEqual(['sbobina-a.json']);
    expect(drive.requests.find(request => request.method === 'GET' && request.url.includes('/files?'))?.url).toContain('spaces=appDataFolder');
  });

  it('waits and retries on 429, 403 rate limits and server errors, honouring Retry-After', async () => {
    const { api, drive, sleep } = setup();
    drive.failNext({ status: 429 }, { status: 403, reason: 'userRateLimitExceeded' }, { status: 503, retryAfter: 3 });
    expect(await api.listChanged(null)).toEqual([]);
    expect(sleep.mock.calls.map(call => (call as unknown[])[0])).toEqual([1000, 2000, 3000]);
  });

  it('gives up after the last attempt and does not retry other errors', async () => {
    const { api, drive, sleep } = setup();
    drive.failNext(...Array.from({ length: 5 }, () => ({ status: 429 })));
    await expect(api.listChanged(null)).rejects.toMatchObject({ status: 429 });
    expect(sleep).toHaveBeenCalledTimes(4);

    drive.failNext({ status: 403, reason: 'insufficientPermissions' });
    await expect(api.listChanged(null)).rejects.toMatchObject({ status: 403, reason: 'insufficientPermissions' });
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it('never retries a create after a server error, which may have created the file', async () => {
    const { api, drive } = setup();
    drive.failNext({ status: 500 });
    await expect(api.createJson('sbobina-a.json', {})).rejects.toMatchObject({ status: 500 });
    drive.failNext({ status: 429 });
    await expect(api.createJson('sbobina-a.json', {})).resolves.toMatchObject({ name: 'sbobina-a.json' });
  });

  it('reports a lost token (401) and an offline browser distinctly', async () => {
    const { api, drive, onUnauthorized } = setup();
    await api.listChanged(null);
    drive.expireTokens();
    const expired = await api.listChanged(null).then(() => null, (error: unknown) => error as DriveError);
    expect(expired).toBeInstanceOf(DriveError);
    expect(expired?.needsAuthorization).toBe(true);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    drive.setOffline(true);
    const offline = await api.readJson('x').then(() => null, (error: unknown) => error as DriveError);
    expect(offline?.offline).toBe(true);

    await expect(setup(null).api.listChanged(null)).rejects.toMatchObject({ status: 401 });
  });
});

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
  it('gives up on a body that stops arriving, waits for one that keeps coming, and gives an upload time by its size', async () => {
    vi.useFakeTimers();
    try {
      const chunks = (parts: string[], every: number, stallAfter = Infinity) => new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const [index, part] of parts.entries()) {
            if (index >= stallAfter) return;
            await new Promise(resolve => setTimeout(resolve, every));
            controller.enqueue(new TextEncoder().encode(part));
          }
          controller.close();
        },
      });
      const answering = (body: () => ReadableStream<Uint8Array>, after = 0) => vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        setTimeout(() => resolve(new Response(body(), { status: 200 })), after);
      }));
      const json = ['{"user":', '{"emailAddress":', '"a@b.it"}}'];

      // Headers, then the body stops after its first part.
      const stalled = createDriveApi({ getToken: () => 'tok', fetchImpl: answering(() => chunks(json, 10, 1)), timeoutMs: 1000 });
      const failing = expect(stalled.accountEmail()).rejects.toMatchObject({ offline: true, message: 'Google Drive non risponde.' });
      await vi.advanceTimersByTimeAsync(1100);
      await failing;

      // Slow, but never a second without a new part: it arrives whole.
      const slow = createDriveApi({ getToken: () => 'tok', fetchImpl: answering(() => chunks(json, 800)), timeoutMs: 1000 });
      const email = slow.accountEmail();
      await vi.advanceTimersByTimeAsync(2500);
      expect(await email).toBe('a@b.it');

      // A 64 KB upload answered after 3 s: more than the stall time, within the time its size gets.
      const meta = '{"id":"f1","name":"a.json","modifiedTime":"2026-11-02T10:00:00.000Z"}';
      const uploading = createDriveApi({ getToken: () => 'tok', fetchImpl: answering(() => chunks([meta], 0), 3000), timeoutMs: 1000 });
      const created = uploading.createJson('a.json', { text: 'x'.repeat(64_000) });
      await vi.advanceTimersByTimeAsync(3100);
      expect(await created).toMatchObject({ id: 'f1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives up on a request left without an answer, as without a network', async () => {
    vi.useFakeTimers();
    try {
      // A stalled connection: the request never answers until it is aborted.
      const hanging = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }));
      const api = createDriveApi({ getToken: () => 'tok', fetchImpl: hanging, timeoutMs: 1000 });
      const listing = api.listChanged(null);
      const failed = expect(listing).rejects.toMatchObject({ status: 0, offline: true, message: 'Google Drive non risponde.' });
      await vi.advanceTimersByTimeAsync(1000);
      await failed;
      expect(hanging).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

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

  it('tries once more with a token renewed after a 401, never in a loop', async () => {
    const drive = createFakeDrive();
    let token = 'tok-1';
    const onUnauthorized = vi.fn(() => { if (token === 'tok-1') token = 'tok-2'; });
    const api = createDriveApi({ getToken: async () => token, fetchImpl: drive.fetch, sleep: async () => {}, onUnauthorized });
    await api.createJson('sbobina-a.json', {});
    drive.expireTokens();
    // An upload too: Drive refused it, so it never happened.
    await expect(api.createJson('sbobina-b.json', {})).resolves.toMatchObject({ name: 'sbobina-b.json' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(drive.files()).toHaveLength(2);

    drive.expireTokens();
    await expect(api.listChanged(null)).rejects.toMatchObject({ status: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
  });

  it('never retries a renewal the login service failed with a 5xx: that is no Drive server error', async () => {
    const drive = createFakeDrive();
    const sleep = vi.fn(async () => {});
    const getToken = vi.fn(async () => { throw new DriveError(503, 'Il collegamento a Google Drive non è ancora attivo su questo sito.', 'server_not_configured'); });
    const api = createDriveApi({ getToken, fetchImpl: drive.fetch, sleep });
    await expect(api.listChanged(null)).rejects.toMatchObject({ status: 503, reason: 'server_not_configured' });
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(drive.requests).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError } from './pipeline/retry';
import { createPageState, createScreenWakeLock } from './pageLifecycle';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
}

afterEach(() => {
  vi.useRealTimers();
  setHidden(false);
  setOnline(true);
});

describe('createPageState', () => {
  it('remembers that the page was hidden since a moment', () => {
    let clock = 100;
    const page = createPageState(document, window, () => clock);
    expect(page.wasHiddenSince(0)).toBe(false);
    setHidden(true);
    expect(page.isHidden()).toBe(true);
    expect(page.wasHiddenSince(500)).toBe(true);
    clock = 200;
    setHidden(false);
    expect(page.wasHiddenSince(150)).toBe(true);
    expect(page.wasHiddenSince(201)).toBe(false);
    page.dispose();
  });

  it('waits for the page to be visible again and rejects when cancelled', async () => {
    const page = createPageState(document, window);
    setHidden(true);
    const controller = new AbortController();
    let resolved = false;
    const wait = page.waitVisible(controller.signal).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    setHidden(false);
    await wait;
    expect(resolved).toBe(true);

    setHidden(true);
    const cancelled = page.waitVisible(controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(CancelledError);
    page.dispose();
  });

  it('waits for the network, by event or by polling', async () => {
    vi.useFakeTimers();
    const page = createPageState(document, window);
    setOnline(false);
    expect(page.isOffline()).toBe(true);
    const controller = new AbortController();
    const byEvent = page.waitOnline(controller.signal);
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await byEvent;

    setOnline(false);
    const byPoll = page.waitOnline(controller.signal);
    setOnline(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await byPoll;
    page.dispose();
  });
});

describe('createScreenWakeLock', () => {
  function fakeNavigator() {
    const sentinels: Array<{ released: boolean; release: () => Promise<void> }> = [];
    const request = vi.fn(async () => {
      const sentinel = { released: false, release: async () => { sentinel.released = true; } };
      sentinels.push(sentinel);
      return sentinel;
    });
    return { nav: { wakeLock: { request } } as unknown as Navigator, request, sentinels };
  }

  it('takes the lock, takes it again on return and releases it at the end', async () => {
    const { nav, request, sentinels } = fakeNavigator();
    const lock = createScreenWakeLock(document, nav);
    await lock.start();
    expect(request).toHaveBeenCalledTimes(1);
    sentinels[0].released = true; // the browser drops it when the page is hidden
    setHidden(true);
    setHidden(false);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(2);
    await lock.stop();
    expect(sentinels[1].released).toBe(true);
    setHidden(true);
    setHidden(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('goes on without it when the browser refuses or has no Wake Lock', async () => {
    const refusing = { wakeLock: { request: vi.fn(async () => { throw new Error('NotAllowedError'); }) } } as unknown as Navigator;
    const lock = createScreenWakeLock(document, refusing);
    await expect(lock.start()).resolves.toBeUndefined();
    await expect(lock.stop()).resolves.toBeUndefined();
    const none = createScreenWakeLock(document, {} as Navigator);
    expect(none.supported).toBe(false);
    await none.start();
    await none.stop();
  });
});

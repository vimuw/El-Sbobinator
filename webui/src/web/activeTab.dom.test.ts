import { describe, expect, it, vi } from 'vitest';
import { ACTIVE_TAB_LOCK, claimActiveTab, showWaitingPage } from './activeTab';

/**
 * The Web Locks of one origin for one exclusive lock, as the browser grants it: ifAvailable answers
 * null while held, a queued request waits (or is aborted by its signal), steal takes the lock and
 * rejects the holder's request. close() is the holder's tab going away.
 */
function fakeLocks() {
  type Holder = { stolen: (error: unknown) => void; done: () => void };
  let holder: Holder | null = null;
  const waiting: Array<() => void> = [];
  const grant = (callback: LockGrantedCallback<unknown>) => new Promise<unknown>((resolve, reject) => {
    const mine: Holder = {
      stolen: reject,
      done: () => resolve(undefined),
    };
    holder = mine;
    void Promise.resolve(callback({ name: ACTIVE_TAB_LOCK, mode: 'exclusive' } as Lock));
  });
  const locks = {
    request: (name: string, options: LockOptions, callback: LockGrantedCallback<unknown>) => {
      expect(name).toBe(ACTIVE_TAB_LOCK);
      if (options.steal) {
        holder?.stolen(new DOMException('stolen', 'AbortError'));
        return grant(callback);
      }
      if (!holder) return grant(callback);
      if (options.ifAvailable) return Promise.resolve(callback(null));
      return new Promise((resolve, reject) => {
        const next = () => { grant(callback).then(resolve, reject); };
        waiting.push(next);
        options.signal?.addEventListener('abort', () => {
          waiting.splice(waiting.indexOf(next), 1);
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    },
  } as unknown as LockManager;
  return {
    locks,
    waiting: () => waiting.length,
    close: () => {
      holder?.done();
      holder = null;
      waiting.shift()?.();
    },
  };
}

const settled = async (promise: Promise<unknown>) => {
  let done = false;
  void promise.then(() => { done = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  return done;
};

describe('one active tab of the site', () => {
  it('starts at once without Web Locks, as before', async () => {
    const onWaiting = vi.fn();
    await claimActiveTab({ locks: null, onWaiting, onLost: () => {} });
    expect(onWaiting).not.toHaveBeenCalled();
  });

  it('starts as without Web Locks when the browser refuses the lock (site data blocked)', async () => {
    // Regression: the refusal reached the page's start and the app never mounted.
    const refusing = { request: () => Promise.reject(new DOMException('The request was denied.', 'SecurityError')) } as unknown as LockManager;
    const throwing = { request: () => { throw new DOMException('The request was denied.', 'SecurityError'); } } as unknown as LockManager;
    for (const locks of [refusing, throwing]) {
      const onWaiting = vi.fn();
      await claimActiveTab({ locks, onWaiting, onLost: () => {} });
      expect(onWaiting).not.toHaveBeenCalled();
    }
  });

  it('starts the first tab at once and the second when the first closes', async () => {
    const { locks, close } = fakeLocks();
    const first = { onWaiting: vi.fn(), onLost: vi.fn() };
    await claimActiveTab({ locks, ...first });
    expect(first.onWaiting).not.toHaveBeenCalled();

    const second = { onWaiting: vi.fn(), onLost: vi.fn() };
    const claimed = claimActiveTab({ locks, ...second });
    expect(await settled(claimed)).toBe(false);
    expect(second.onWaiting).toHaveBeenCalledTimes(1);

    close();
    expect(await settled(claimed)).toBe(true);
    expect(first.onLost).not.toHaveBeenCalled();
    expect(second.onLost).not.toHaveBeenCalled();
  });

  it('lets the waiting tab take over: the other one is told it lost the app', async () => {
    const { locks, waiting } = fakeLocks();
    const first = { onWaiting: vi.fn(), onLost: vi.fn() };
    await claimActiveTab({ locks, ...first });
    let takeOver = () => {};
    const second = { onWaiting: vi.fn((take: () => void) => { takeOver = take; }), onLost: vi.fn() };
    const claimed = claimActiveTab({ locks, ...second });
    await vi.waitFor(() => expect(second.onWaiting).toHaveBeenCalled());

    takeOver();
    expect(await settled(claimed)).toBe(true);
    expect(first.onLost).toHaveBeenCalledTimes(1);
    expect(second.onLost).not.toHaveBeenCalled();
    // The request it queued before taking over was withdrawn.
    expect(waiting()).toBe(0);
  });

  it('shows the waiting page in Italian and takes over once on "Usa qui"', () => {
    const takeOver = vi.fn();
    const hide = showWaitingPage(takeOver);
    expect(document.body.textContent).toContain('El Sbobinator è aperto in un’altra scheda');
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Usa qui')!;
    // The app's primary pill, not the bare secondary button that rendered tiny.
    expect(button.classList.contains('modal-action-button')).toBe(true);
    expect(button.classList.contains('is-primary')).toBe(true);
    button.click();
    button.click();
    expect(takeOver).toHaveBeenCalledTimes(1);
    hide();
    expect(document.body.textContent).not.toContain('Usa qui');
  });
});

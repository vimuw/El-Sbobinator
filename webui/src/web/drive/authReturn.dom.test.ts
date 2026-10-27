import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OAUTH_CHANNEL } from './oauth';

const posted: Array<{ channel: string; data: unknown }> = [];

class FakeChannel {
  constructor(readonly name: string) {}
  postMessage(data: unknown) { posted.push({ channel: this.name, data }); }
  close() {}
}

beforeEach(() => {
  vi.resetModules();
  posted.length = 0;
  vi.stubGlobal('BroadcastChannel', FakeChannel);
  document.body.innerHTML = '<p id="drive-auth-message"></p>';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});

describe('Drive login return page', () => {
  it('hands the answer to the app tab, clears it from the address bar and closes', async () => {
    vi.useFakeTimers();
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    history.replaceState(null, '', '/drive-auth#state=s1&access_token=tok&token_type=Bearer&expires_in=3600');
    await import('./authReturn');
    expect(posted).toEqual([{ channel: OAUTH_CHANNEL, data: { type: 'el-sbobinator-oauth', fragment: '#state=s1&access_token=tok&token_type=Bearer&expires_in=3600' } }]);
    expect(location.hash).toBe('');
    expect(location.pathname).toBe('/drive-auth');
    expect(document.getElementById('drive-auth-message')?.textContent).toContain('puoi chiudere');
    vi.advanceTimersByTime(300);
    expect(close).toHaveBeenCalled();
  });

  it('sends nothing when opened without an answer', async () => {
    history.replaceState(null, '', '/drive-auth');
    await import('./authReturn');
    expect(posted).toEqual([]);
    expect(document.getElementById('drive-auth-message')?.textContent).toContain('serve solo');
  });
});

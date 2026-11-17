import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_CAPABILITIES, getHostCapabilities, setHostCapabilities } from '../hostCapabilities';
import { startMonitoring } from './start';

const DSN = 'https://0123456789abcdef0123456789abcdef@o123.ingest.de.sentry.io/456';

afterEach(() => {
  setHostCapabilities(DESKTOP_CAPABILITIES);
  vi.restoreAllMocks();
});

describe('startMonitoring', () => {
  it('starts the reports in builds with a DSN', async () => {
    const initMonitoring = vi.fn();
    setHostCapabilities({ kind: 'web', reportForm: false });

    await expect(startMonitoring(DSN, async () => ({ initMonitoring }))).resolves.toBe(true);
    expect(initMonitoring).toHaveBeenCalledWith(DSN);
    expect(getHostCapabilities().reportForm).toBe(false);
  });

  it('loads nothing without a DSN', async () => {
    const load = vi.fn();
    await expect(startMonitoring('', load)).resolves.toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('lets the app open with the Google form when the Sentry chunk does not load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setHostCapabilities({ kind: 'web', reportForm: false, permanentDelete: false });
    const blocked = new TypeError('Failed to fetch dynamically imported module: /assets/sentry-abc123.js');

    await expect(startMonitoring(DSN, () => Promise.reject(blocked))).resolves.toBe(false);
    // The in-app window could not send: "Segnala un problema" goes back to the form, the rest stays.
    expect(getHostCapabilities()).toMatchObject({ kind: 'web', reportForm: true, permanentDelete: false });
    expect(consoleError).toHaveBeenCalledWith('monitoring', blocked);
  });

  it('falls back the same way when the SDK fails to start', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setHostCapabilities({ kind: 'web', reportForm: false });
    const initMonitoring = vi.fn(() => { throw new Error('init failed'); });

    await expect(startMonitoring(DSN, async () => ({ initMonitoring }))).resolves.toBe(false);
    expect(getHostCapabilities().reportForm).toBe(true);
  });
});

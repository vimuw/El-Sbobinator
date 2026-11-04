import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { createDriveApi } from './drive/driveApi';
import { createFakeAuth, createFakeDrive } from './drive/fakeDrive';
import { createWebPywebviewApi, leaveTab } from './webHost';

// Another tab of the site took over this one (activeTab.ts). In a file of its own: the page stays
// "left" for the rest of the module.

describe('web host taken over by another tab', () => {
  it('drops its Drive token and reloads without asking, also past the app\'s guard during a run', async () => {
    // Regression: only the host's own leave prompt was skipped; the app's one (App.tsx) kept a tab
    // with a run alive after "Usa qui", writing the archive with the tab that took over.
    const drive = createFakeDrive();
    const login = createFakeAuth('pc', { token: true, email: 'studente@example.com' });
    const api = createWebPywebviewApi(() => {}, {
      database: new IDBFactory(),
      drive: { auth: login.auth, api: createDriveApi({ getToken: () => login.auth.token(), fetchImpl: drive.fetch, sleep: async () => {} }) },
      driveDelayMs: 60_000,
    });
    expect(await api.get_drive_status!()).toMatchObject({ connected: true, needs_reconnect: false });

    const reload = vi.fn();
    leaveTab(reload);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(login.auth.token()).toBeNull();
    expect((window as unknown as { __elSbobinatorQuitting?: boolean }).__elSbobinatorQuitting).toBe(true);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(false);
  });
});

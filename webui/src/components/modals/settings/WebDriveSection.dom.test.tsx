import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createDriveApi } from '../../../web/drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from '../../../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../../../web/webHost';
import { createWebArchive } from '../../../web/webSessions';
import { WebDriveSection } from './WebDriveSection';

// The "Google Drive" panel of the web settings, on the real web host with a fake login and Drive.

function setup(drive: FakeDrive, initial: { token?: boolean; email?: string | null } = {}) {
  const factory = new IDBFactory();
  const login = createFakeAuth('pc', initial);
  const api = createDriveApi({ getToken: () => login.auth.token(), onUnauthorized: () => login.auth.expire(), fetchImpl: drive.fetch, sleep: async () => {} });
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory, drive: { auth: login.auth, api }, driveDelayMs: 20 }) };
  return { factory, login };
}

afterEach(() => {
  delete window.pywebview;
});

describe('WebDriveSection', () => {
  it('links Google Drive from the tap and shows the account and the last sync', async () => {
    const drive = createFakeDrive();
    const { factory, login } = setup(drive);
    await createWebArchive(factory).create({ name: 'Anatomia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'gemini-2.5-flash', input_path: '' }, '<p>ossa</p>');
    render(<WebDriveSection />);
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Non collegato'));

    fireEvent.click(screen.getByRole('button', { name: 'Collega Google Drive' }));
    // The Google window opened inside the tap, before anything awaited.
    expect(login.calls).toEqual([{ silent: false }]);
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Collegato come studente@example.com'));
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /));
    expect(drive.files()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Sincronizza ora' })).toBeTruthy();
  });

  it('offers the reconnect tap when the login of a remembered account is gone', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { email: 'studente@example.com' });
    render(<WebDriveSection />);
    const reconnect = await screen.findByRole('button', { name: 'Drive: tocca per riconnettere' });
    expect(screen.queryByTestId('web-drive-last-sync')).toBeNull();
    fireEvent.click(reconnect);
    expect(login.calls).toEqual([{ silent: true }]);
    await screen.findByRole('button', { name: 'Sincronizza ora' });
  });

  it('shows why a sync failed and disconnects without deleting anything', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { token: true, email: 'studente@example.com' });
    render(<WebDriveSection />);
    // The round the host starts with on opening the page.
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /), { timeout: 5000 });
    drive.setOffline(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizza ora' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Google Drive non raggiungibile'));

    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti' }));
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Non collegato'));
    expect(login.disconnects).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Collega Google Drive' })).toBeTruthy();
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '../storageKeys';
import { createDriveApi } from '../web/drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from '../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../web/webHost';
import { createWebArchive } from '../web/webSessions';
import { NavSidebar } from './NavSidebar';
import { SidebarAccount } from './SidebarAccount';

// The Google account in the sidebar, on the real web host with a fake login and Drive.

function setup(drive: FakeDrive, initial: { token?: boolean; email?: string | null } = {}) {
  const factory = new IDBFactory();
  const login = createFakeAuth('pc', initial);
  const client = (getToken: () => string | null) => createDriveApi({ getToken, onUnauthorized: () => login.auth.expire(), fetchImpl: drive.fetch, sleep: async () => {} });
  const connection = { auth: login.auth, api: client(() => login.auth.token()), exportApi: (token: string) => client(() => token) };
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory, drive: connection, driveDelayMs: 20 }) };
  return { factory, login };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.pywebview;
  localStorage.clear();
});

describe('SidebarAccount', () => {
  it('is not there in builds without Drive', () => {
    window.pywebview = { api: {} };
    const { container } = render(<SidebarAccount onOpenStorageSettings={() => {}} />);
    expect(container.innerHTML).toBe('');
  });

  it('sits at the foot of the sidebar, below Impostazioni and after a divider', async () => {
    setup(createFakeDrive());
    const noop = () => {};
    render(
      <NavSidebar
        activePage="queue" setActivePage={noop} apiReady bridgeDelayed={false} hasApiKey isApiKeyValid appState="idle"
        themeMode="light" setThemeMode={noop} showConsole={false} setShowConsole={noop} setIsSettingsOpen={noop}
        hasPendingUpdate={false} consoleDisabled={false} unreadNotificationsCount={0} isNotificationsOpen={false}
        setIsNotificationsOpen={noop} shakeBell={false}
      />,
    );
    const account = await screen.findByTestId('sidebar-account');
    const settings = screen.getByRole('button', { name: 'Apri impostazioni' });
    const tools = Array.from(settings.closest('nav')!.querySelectorAll('button'));
    expect(tools.at(-1)).toBe(account);
    expect(tools.at(-2)).toBe(settings);
    const divider = document.querySelector('.sidebar-account-divider');
    expect(divider?.nextElementSibling?.contains(account)).toBe(true);
  });

  it('on a phone: only the three reasons, and the settings as a gear beside the main button', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    setup(createFakeDrive());
    const openSettings = vi.fn();
    render(<SidebarAccount onOpenStorageSettings={openSettings} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collega Google Drive' }));
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(menu.textContent).not.toContain('Le sbobine ora sono solo in questo browser');
    expect(menu.textContent).toContain('le ritrovi sugli altri dispositivi');
    expect(menu.querySelector('.sidebar-account-link')).toBeNull();
    const gear = within(menu).getByRole('button', { name: 'Più dettagli in Impostazioni' });
    const link = within(menu).getByRole('button', { name: 'Collega Google Drive' });
    expect(gear.parentElement).toBe(link.parentElement?.parentElement);
    fireEvent.click(gear);
    expect(openSettings).toHaveBeenCalledTimes(1);
  });

  it('not linked: an empty avatar with a still grey dot that invites to link Drive, from the tap of its menu', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive);
    render(<SidebarAccount onOpenStorageSettings={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Collega Google Drive' });
    expect(within(button).getByTestId('sidebar-account-empty')).toBeTruthy();
    expect(within(button).getByTestId('sidebar-badge-neutral')).toBeTruthy();

    button.getBoundingClientRect = () => ({ top: window.innerHeight - 88, height: 36, bottom: window.innerHeight - 52, left: 9, right: 45, width: 36, x: 9, y: 0, toJSON: () => ({}) });
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    // Like the notifications: beside the sidebar, with a caret at the middle of the avatar.
    expect(menu.style.bottom).toBe('36px');
    expect(within(menu).getByTestId('popover-caret').style.bottom).toBe('25px');
    // Named like the settings page it leads to, with its state right after the title.
    const heading = within(menu).getByRole('heading', { name: 'Sincronizzazione' });
    expect(heading.nextElementSibling?.textContent).toBe('Non collegato');
    expect(menu.textContent).toContain('Non collegato');
    expect(menu.textContent).toContain('le ritrovi sugli altri dispositivi');
    expect(menu.textContent).toContain('Più dettagli in Impostazioni');
    fireEvent.click(screen.getAllByRole('button', { name: 'Collega Google Drive' }).find(item => menu.contains(item))!);
    expect(login.calls).toEqual([{ silent: false }]);
    expect(localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1)).toBe('drive');
    await waitFor(() => expect(screen.getByTestId('sidebar-account-email').textContent).toBe('studente@example.com'));
    expect(screen.getByRole('button', { name: /^Account Google: studente@example\.com/ }).textContent).toBe('S');
  });

  it('linked: the initial, a still warning dot and "Riconnetti" when the login is gone', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { email: 'studente@example.com' });
    render(<SidebarAccount onOpenStorageSettings={() => {}} />);
    const button = await screen.findByRole('button', { name: 'Account Google: studente@example.com (Da riconnettere)' });
    expect(screen.getByTestId('sidebar-badge-warning')).toBeTruthy();

    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Account Google Drive' }).textContent).toContain('L’accesso è scaduto');
    fireEvent.click(screen.getByRole('button', { name: 'Riconnetti' }));
    expect(login.calls).toEqual([{ silent: true }]);
    await screen.findByRole('button', { name: 'Sincronizza ora' });
  });

  it('"Esci dall’account" unlinks this browser from the menu and keeps the copy on Drive', async () => {
    const drive = createFakeDrive();
    const { factory } = setup(drive, { token: true, email: 'studente@example.com' });
    await createWebArchive(factory).create({ name: 'Anatomia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'm', input_path: '' }, '<p>ossa</p>');
    render(<SidebarAccount onOpenStorageSettings={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Account Google: studente@example\.com/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sincronizza ora' }));
    await waitFor(() => expect(drive.files().length).toBeGreaterThan(0));
    const kept = drive.files().length;
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    // Below the way to the settings, the last line of the menu.
    const leave = within(menu).getByRole('button', { name: 'Esci dall’account' });
    expect(within(menu).getByRole('button', { name: 'Gestisci in Impostazioni' }).nextElementSibling).toBe(leave);

    fireEvent.click(leave);
    await waitFor(() => expect(menu.textContent).toContain('Non collegato'));
    expect(within(menu).queryByRole('button', { name: 'Esci dall’account' })).toBeNull();
    expect(drive.files()).toHaveLength(kept);
    expect(screen.getByTestId('sidebar-account').getAttribute('aria-label')).toBe('Collega Google Drive');
  });

  it('on a phone, linked: "Esci dall’account" is there too, without the settings row', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    setup(createFakeDrive(), { token: true, email: 'studente@example.com' });
    render(<SidebarAccount onOpenStorageSettings={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /^Account Google: studente@example\.com/ }));
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(within(menu).getByRole('button', { name: 'Esci dall’account' })).toBeTruthy();
    expect(within(menu).queryByText('Gestisci in Impostazioni')).toBeNull();
  });

  it('"Gestisci in Impostazioni" leads to the settings and closes the menu; Esc closes it too', async () => {
    const drive = createFakeDrive();
    setup(drive, { token: true, email: 'studente@example.com' });
    const onOpenStorageSettings = vi.fn();
    render(<SidebarAccount onOpenStorageSettings={onOpenStorageSettings} />);
    const button = await screen.findByRole('button', { name: /^Account Google: studente@example\.com/ });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Gestisci in Impostazioni' }));
    expect(onOpenStorageSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

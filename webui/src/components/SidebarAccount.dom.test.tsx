import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRIVE_EXPIRED_ERROR } from '../bridge';
import { DRIVE_WAITING_FOR_RUN } from '../hooks/useDriveStatus';
import { DriveAuthError } from '../web/drive/auth';
import { STORAGE_KEYS } from '../storageKeys';
import { createDriveApi } from '../web/drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from '../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../web/webHost';
import { createWebArchive } from '../web/webSessions';
import { NavSidebar } from './NavSidebar';
import { CLOUD_CHECK_OUTLINE } from './driveCloudIcons';
import { DRIVE_LINK_REASONS, DRIVE_STAYS_HERE } from './modals/settings/WebDriveSection';
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
    const { container } = render(<SidebarAccount />);
    expect(container.innerHTML).toBe('');
  });

  it('sits just above Impostazioni, the last button of the sidebar, with no divider of its own', async () => {
    setup(createFakeDrive());
    const noop = () => {};
    render(
      <NavSidebar
        activePage="queue" setActivePage={noop} apiReady bridgeDelayed={false} hasApiKey isApiKeyValid appState="idle"
        themeMode="light" setThemeMode={noop} setIsSettingsOpen={noop}
        unreadNotificationsCount={0} isNotificationsOpen={false}
        setIsNotificationsOpen={noop} shakeBell={false}
      />,
    );
    const account = await screen.findByTestId('sidebar-account');
    const settings = screen.getByRole('button', { name: 'Apri impostazioni' });
    const tools = Array.from(settings.closest('nav')!.querySelectorAll('button'));
    expect(tools.at(-1)).toBe(settings);
    expect(tools.at(-2)).toBe(account);
    expect(document.querySelector('.sidebar-account-divider')).toBeNull();
  });

  it('on a phone: only the list and the button that links, with no way to the settings', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    setup(createFakeDrive());
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: 'Collega Google Drive' }));
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(menu.textContent).not.toContain('Le sbobine ora sono solo in questo browser');
    expect(menu.textContent).toContain('le ritrovi sugli altri dispositivi');
    expect(menu.textContent).toContain('audio e chiavi API restano in questo browser');
    expect(menu.querySelector('[data-testid="sidebar-account-leave"]')).toBeNull();
    expect(within(menu).getAllByRole('button').map(button => button.textContent)).toEqual(['Collega Google Drive']);
  });

  it('never grows its cloud on hover, so the float plays at the size of the icon itself', async () => {
    setup(createFakeDrive());
    render(<SidebarAccount />);
    const button = await screen.findByTestId('sidebar-account');
    const scaled = [button, ...Array.from(button.querySelectorAll('*'))]
      .flatMap((el) => Array.from(el.classList))
      .filter((token) => /(^|:)scale-/.test(token));
    expect(scaled).toEqual([]);
  });

  it('not linked: a crossed-out cloud with no dot that invites to link Drive, from the tap of its menu', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive);
    render(<SidebarAccount />);
    const button = await screen.findByRole('button', { name: 'Collega Google Drive' });
    // No account of the app to picture: a cloud for Drive, its state in the drawing, no dot.
    expect(within(button).getByTestId('sidebar-drive-off')).toBeTruthy();
    expect(button.querySelector('.sidebar-badge')).toBeNull();

    button.getBoundingClientRect = () => ({ top: window.innerHeight - 88, height: 36, bottom: window.innerHeight - 52, left: 9, right: 45, width: 36, x: 9, y: 0, toJSON: () => ({}) });
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    // Like the notifications: beside the sidebar, with a caret at the middle of the button.
    expect(menu.style.bottom).toBe('36px');
    expect(within(menu).getByTestId('popover-caret').style.bottom).toBe('25px');
    // Named like the settings page it leads to, with its state right after the title.
    const heading = within(menu).getByRole('heading', { name: 'Google Drive' });
    expect(heading.nextElementSibling?.textContent).toBe('Non collegato');
    expect(menu.textContent).toContain('Non collegato');
    // The reasons of Impostazioni → Google Drive and what stays out, so no way there: the menu
    // says it all and ends with the button that links.
    const items = Array.from(menu.querySelectorAll('li')).map(item => item.textContent);
    expect(items).toEqual(DRIVE_LINK_REASONS.map(([, text]) => text).concat(DRIVE_STAYS_HERE));
    expect(menu.textContent).not.toMatch(/Impostazioni/);
    expect(menu.querySelector('[data-testid="sidebar-account-leave"]')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Collega Google Drive' }).find(item => menu.contains(item))!);
    expect(login.calls).toEqual(['link']);
    expect(localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1)).toBe('drive');
    await waitFor(() => expect(screen.getByTestId('sidebar-account-email').textContent).toBe('studente@example.com'));
    const linked = screen.getByTestId('sidebar-account');
    expect(linked.getAttribute('aria-label')).toMatch(/^Google Drive: /);
    // The email is in the menu, not drawn on the button as an initial.
    expect(linked.textContent).toBe('');
    expect(within(linked).queryByTestId('sidebar-drive-off')).toBeNull();
  });

  it('linked: a warning cloud and "Riconnetti" when the login is gone', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { email: 'studente@example.com' });
    render(<SidebarAccount />);
    const button = await screen.findByRole('button', { name: 'Google Drive: Da riconnettere' });
    const icon = within(button).getByTestId('sidebar-drive-reconnect');
    expect(icon.parentElement?.classList.contains('is-reconnect')).toBe(true);
    // The warning is drawn on the same cloud as the synced state, not lucide's rounder CloudAlert.
    expect(Array.from(icon.querySelectorAll('path')).map(path => path.getAttribute('d'))).toEqual(['M12 12v4', 'M12 20h.01', CLOUD_CHECK_OUTLINE]);
    expect(icon.parentElement?.className).not.toContain('is-syncing');
    expect(button.querySelector('.sidebar-badge')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Account Google Drive' }).textContent).toContain('L’accesso è scaduto');
    // Here "Riconnetti" is the menu's call to action: it keeps its word, with the way out beside it.
    const reconnect = screen.getByRole('button', { name: 'Riconnetti' });
    expect(reconnect.textContent).toBe('Riconnetti');
    expect(reconnect.nextElementSibling).toBe(screen.getByRole('button', { name: 'Scollega Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riconnetti' }));
    expect(login.calls).toEqual(['link']);
    // The sync draws the Drive cloud with arrows, as in the settings.
    const sync = await screen.findByRole('button', { name: 'Sincronizza' });
    expect(Array.from(sync.querySelectorAll('svg path')).map(path => path.getAttribute('d')))
      .toContain('M20.996 15.251A4.5 4.5 0 0 0 17.495 8h-1.79a7 7 0 1 0-12.709 5.607');
  });

  it('a "Riconnetti" that fails says why in the menu, still to reconnect', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { email: 'studente@example.com' });
    // The server could not trade Google's code (a wrong client secret, say).
    login.failures.push(new DriveAuthError('login_failed'));
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: 'Google Drive: Da riconnettere' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riconnetti' }));

    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect((await within(menu).findByRole('alert')).textContent).toBe('Accesso a Google non riuscito: riprova.');
    expect(menu.textContent).toContain('L’accesso è scaduto');
    expect(within(menu).getByRole('button', { name: 'Riconnetti' })).toBeTruthy();
  });

  it('to reconnect after a 401, the menu does not repeat "scaduto" as an error', async () => {
    window.pywebview = { api: { get_drive_status: async () => ({
      available: true, connected: true, email: 'studente@example.com', needs_reconnect: true, syncing: false,
      last_sync_at: null, error: DRIVE_EXPIRED_ERROR,
    }) } };
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: 'Google Drive: Da riconnettere' }));
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(menu.textContent).toContain('L’accesso è scaduto');
    expect(within(menu).queryByRole('alert')).toBeNull();
  });

  it('"Sincronizza" during an elaborazione says it waits for its end', async () => {
    let waiting = false;
    const status = () => ({
      available: true, connected: true, email: 'studente@example.com', needs_reconnect: false, syncing: false,
      waiting_for_run: waiting, last_sync_at: '2026-11-10T08:00:00.000Z', error: null,
    });
    window.pywebview = { api: { get_drive_status: async () => status(), sync_drive_now: async () => { waiting = true; return status(); } } };
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: /^Google Drive: / }));
    const sync = await screen.findByRole('button', { name: 'Sincronizza' });
    fireEvent.click(sync);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    await waitFor(() => expect(menu.textContent).toContain(DRIVE_WAITING_FOR_RUN));
    expect(menu.textContent).not.toContain('Ultima sincronizzazione');
    expect((sync as HTMLButtonElement).disabled).toBe(true);
  });

  it('"Scollega Drive" unlinks this browser from the menu and keeps the copy on Drive', async () => {
    const drive = createFakeDrive();
    const { factory } = setup(drive, { token: true, email: 'studente@example.com' });
    await createWebArchive(factory).create({ name: 'Anatomia', completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'm', input_path: '' }, '<p>ossa</p>');
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: /^Google Drive: / }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sincronizza' }));
    await waitFor(() => expect(drive.files().length).toBeGreaterThan(0));
    const kept = drive.files().length;
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    // One row as in the settings: "Sincronizza" with its word, then the way out as an icon
    // named for touch and screen readers; no line of its own, no way to the settings.
    const leave = within(menu).getByRole('button', { name: 'Scollega Drive' });
    const row = within(menu).getByTestId('sidebar-account-actions');
    expect(Array.from(row.children)).toEqual([within(menu).getByRole('button', { name: 'Sincronizza' }), leave]);
    expect(leave.textContent).toBe('');
    expect(leave.getAttribute('title')).toBe('Scollega Drive');
    expect(menu.textContent).not.toContain('Scollega Drive');
    expect(menu.textContent).not.toMatch(/Impostazioni/);

    fireEvent.click(leave);
    await waitFor(() => expect(menu.textContent).toContain('Non collegato'));
    expect(within(menu).queryByRole('button', { name: 'Scollega Drive' })).toBeNull();
    expect(drive.files()).toHaveLength(kept);
    expect(screen.getByTestId('sidebar-account').getAttribute('aria-label')).toBe('Collega Google Drive');
  });

  it('on a phone, linked: "Scollega Drive" is there too', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    setup(createFakeDrive(), { token: true, email: 'studente@example.com' });
    render(<SidebarAccount />);
    fireEvent.click(await screen.findByRole('button', { name: /^Google Drive: / }));
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(within(menu).getByRole('button', { name: 'Scollega Drive' })).toBeTruthy();
    expect(menu.textContent).not.toMatch(/Impostazioni/);
  });

  it('while a round runs says it once: "In corso" by the heading, the last sync kept, the icon turning, an arrow rising into the cloud', async () => {
    const status = {
      available: true, connected: true, email: 'studente@example.com', needs_reconnect: false, syncing: true,
      waiting_for_run: false, last_sync_at: '2026-11-10T08:00:00.000Z', error: null,
    };
    window.pywebview = { api: { get_drive_status: async () => status } };
    render(<SidebarAccount />);
    // The button, read on its own, keeps the full state.
    const button = await screen.findByRole('button', { name: 'Google Drive: Sincronizzazione…' });
    const cloud = within(button).getByTestId('sidebar-drive-syncing');
    expect(cloud.parentElement?.classList.contains('is-syncing')).toBe(true);
    // An arrow rises into the same cloud as the other states and the cloud stays put: only the
    // marked paths move, straight up, since a turning mark blurs at 18px.
    const paths = Array.from(cloud.querySelectorAll('path'));
    expect(paths.map(path => path.getAttribute('d'))).toEqual(['M12 13v8', 'm8.5 16.5 3.5-3.5 3.5 3.5', CLOUD_CHECK_OUTLINE]);
    expect(paths.map(path => path.classList.contains('sidebar-drive-mark'))).toEqual([true, true, false]);
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/\.sidebar-drive-cloud\.is-syncing \.sidebar-drive-mark \{\s*animation: sidebar-drive-rise [^}]*infinite;\s*\}/);
    const from = css.indexOf('@keyframes sidebar-drive-rise');
    expect(from).toBeGreaterThan(-1);
    const keyframes = css.slice(from, css.indexOf('@keyframes', from + 1));
    expect(keyframes).toContain('translateY(');
    expect(keyframes).not.toMatch(/rotate|scale/);
    expect(css).not.toContain('sidebar-drive-sync-turn');
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(within(menu).getByRole('heading', { name: 'Google Drive' }).nextElementSibling?.textContent).toBe('In corso');
    expect(menu.textContent).toContain('Ultima sincronizzazione:');
    expect(menu.textContent).not.toContain('Sincronizzazione in corso');
    const sync = within(menu).getByRole('button', { name: 'Sincronizza' }) as HTMLButtonElement;
    expect(sync.disabled).toBe(true);
    expect(sync.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
  });

  it('linked and synced: a green tick on a grey cloud, "Collegato" by the "Google Drive" heading', async () => {
    const status = {
      available: true, connected: true, email: 'studente@example.com', needs_reconnect: false, syncing: false,
      waiting_for_run: false, last_sync_at: '2026-11-10T08:00:00.000Z', error: null,
    };
    window.pywebview = { api: { get_drive_status: async () => status } };
    render(<SidebarAccount />);
    // The button, read on its own, keeps the full state.
    const button = await screen.findByRole('button', { name: 'Google Drive: Sincronizzato' });
    // Only the tick is green: the rule picks it as lucide's first path, the cloud stays grey.
    const cloud = within(button).getByTestId('sidebar-drive-ok');
    expect(cloud.parentElement?.classList.contains('is-ok')).toBe(true);
    const paths = Array.from(cloud.querySelectorAll('path'));
    expect(paths).toHaveLength(2);
    expect(paths[0].getAttribute('d')).toBe('m17 15-5.5 5.5L9 18');
    expect(paths[1].getAttribute('d')).toBe(CLOUD_CHECK_OUTLINE);
    const css = readFileSync('src/index.css', 'utf8');
    expect(css).toMatch(/\.sidebar-drive-cloud\.is-ok svg path:first-child \{\s*stroke: var\(--success-text\);\s*\}/);
    expect(css).not.toMatch(/\.sidebar-drive-cloud\.is-ok \{/);
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });
    expect(within(menu).getByRole('heading', { name: 'Google Drive' }).nextElementSibling?.textContent).toBe('Collegato');
    expect(menu.textContent).not.toContain('Attiva');
  });

  it('closes with the short exit of the other menus instead of vanishing', async () => {
    setup(createFakeDrive(), { token: true, email: 'studente@example.com' });
    render(<SidebarAccount />);
    const button = await screen.findByRole('button', { name: /^Google Drive: / });
    fireEvent.click(button);
    const menu = screen.getByRole('dialog', { name: 'Account Google Drive' });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    // Still on the page while it plays its exit, then gone.
    expect(menu.isConnected).toBe(true);
    await waitFor(() => expect(menu.isConnected).toBe(false));
  });

  it('Esc closes the menu', async () => {
    const drive = createFakeDrive();
    setup(drive, { token: true, email: 'studente@example.com' });
    render(<SidebarAccount />);
    const button = await screen.findByRole('button', { name: /^Google Drive: / });

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../storageKeys';
import { DriveAuthError } from '../../../web/drive/auth';
import { createDriveApi } from '../../../web/drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from '../../../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../../../web/webHost';
import { createWebArchive } from '../../../web/webSessions';
import { WebDriveSection } from './WebDriveSection';

// The "Google Drive" panel of the web settings, on the real web host with a fake login and Drive.

function setup(drive: FakeDrive, initial: { token?: boolean; email?: string | null } = {}) {
  const factory = new IDBFactory();
  const login = createFakeAuth('pc', initial);
  const client = (getToken: () => string | null) => createDriveApi({ getToken, onUnauthorized: () => login.auth.expire(), fetchImpl: drive.fetch, sleep: async () => {} });
  const connection = { auth: login.auth, api: client(() => login.auth.token()), exportApi: (token: string) => client(() => token) };
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: factory, drive: connection, driveDelayMs: 20 }) };
  return { factory, login };
}

afterEach(() => {
  delete window.pywebview;
  localStorage.clear();
});

const choice = () => localStorage.getItem(STORAGE_KEYS.WEB_STORAGE_CHOICE_V1);
const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement;
const input = (name: string) => ({ name, completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'm', input_path: '' });
const emptyFolders = { format: 'el-sbobinator-sync-folders', version: 1, folders: [], deleted: {} };

describe('WebDriveSection', () => {
  it('starts on "Solo in questo browser" with the warning, and picking Drive links it from the tap', async () => {
    const drive = createFakeDrive();
    const { login, factory } = setup(drive);
    await createWebArchive(factory).create(input('Anatomia'), '<p>ossa</p>');
    render(<WebDriveSection />);
    await screen.findByRole('radio', { name: 'Solo in questo browser' });
    expect(radio('Solo in questo browser').checked).toBe(true);
    expect(screen.getByTestId('web-drive-local-only').textContent).toContain('Safari può cancellarle se non apri il sito per circa 7 giorni');
    expect(screen.queryByRole('button', { name: 'Elimina tutti i miei dati da Drive' })).toBeNull();

    fireEvent.click(radio('In questo browser + Google Drive'));
    expect(login.calls).toEqual([{ silent: false }]);
    expect(choice()).toBe('drive');
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Collegato come studente@example.com'));
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /));
    expect(drive.files()).toHaveLength(1);
    expect(screen.queryByTestId('web-drive-local-only')).toBeNull();
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

  it('going back to the browser only asks what to do with Drive, and "Disconnetti" deletes nothing', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { token: true, email: 'studente@example.com' });
    render(<WebDriveSection />);
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /), { timeout: 5000 });
    drive.setOffline(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizza ora' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Google Drive non raggiungibile'));
    drive.setOffline(false);

    fireEvent.click(radio('Solo in questo browser'));
    // Nothing happens before an answer.
    expect(login.disconnects).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(radio('In questo browser + Google Drive').checked).toBe(true);

    fireEvent.click(radio('Solo in questo browser'));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti' }));
    await waitFor(() => expect(radio('Solo in questo browser').checked).toBe(true));
    expect(login.disconnects).toHaveLength(1);
    expect(choice()).toBe('browser');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Disconnetti ed elimina da Drive" empties the hidden folder', async () => {
    const drive = createFakeDrive();
    drive.put('raccolte.json', emptyFolders);
    const { login } = setup(drive, { token: true, email: 'studente@example.com' });
    render(<WebDriveSection />);
    fireEvent.click(await screen.findByRole('radio', { name: 'Solo in questo browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti ed elimina da Drive' }));
    await waitFor(() => expect(choice()).toBe('browser'));
    expect(drive.files()).toEqual([]);
    expect(login.disconnects).toHaveLength(1);
  });

  it('"Elimina tutti i miei dati da Drive" asks first, with the other ways to do it', async () => {
    const drive = createFakeDrive();
    drive.put('raccolte.json', emptyFolders);
    setup(drive, { token: true, email: 'studente@example.com' });
    render(<WebDriveSection />);
    expect((await screen.findByRole('link', { name: 'myaccount.google.com/permissions' })).getAttribute('href')).toBe('https://myaccount.google.com/permissions');
    expect(screen.getByTestId('web-drive').textContent).toContain('Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti');

    fireEvent.click(await screen.findByRole('button', { name: 'Elimina tutti i miei dati da Drive' }));
    expect(screen.getByRole('group', { name: 'Elimina tutti i miei dati da Drive' }).textContent).toContain('Le sbobine in questo browser restano');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(drive.files()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Elimina tutti i miei dati da Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina da Drive' }));
    await waitFor(() => expect(choice()).toBe('browser'));
    expect(drive.files()).toEqual([]);
  });

  it('exports with progress and a link to the new folder, also from the browser only', async () => {
    const drive = createFakeDrive();
    const { login, factory } = setup(drive);
    const archive = createWebArchive(factory);
    await archive.create(input('Rene'), '<p>nefrone</p>');
    await archive.create(input('Cuore'), '<p>valvole</p>');
    render(<WebDriveSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta tutte le sbobine nel mio Drive' }));
    expect(login.calls).toEqual([{ silent: false, scope: 'https://www.googleapis.com/auth/drive.file' }]);
    const result = await screen.findByTestId('web-drive-export-result');
    expect(result.textContent).toMatch(/^2 sbobine esportate in “El Sbobinator – esportazione \d{4}-\d{2}-\d{2}”\./);
    expect(screen.getByRole('link', { name: 'Apri la cartella' }).getAttribute('href')).toContain('drive.google.com');
    expect(drive.visibleFiles().filter(file => file.name.endsWith('.html'))).toHaveLength(2);
    // Still not linked: the export does not turn the sync on.
    expect(radio('Solo in questo browser').checked).toBe(true);
  });

  it('says why an export could not start', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive);
    render(<WebDriveSection />);
    login.failures.push(new DriveAuthError('file_scope_missing'));
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta tutte le sbobine nel mio Drive' }));
    expect((await screen.findByTestId('web-drive-export-result')).textContent).toContain('permesso di creare file');
    expect(screen.queryByRole('link', { name: 'Apri la cartella' })).toBeNull();
  });
});

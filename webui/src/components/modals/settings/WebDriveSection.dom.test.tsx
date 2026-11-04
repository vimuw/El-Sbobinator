import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../../storageKeys';
import { DriveAuthError } from '../../../web/drive/auth';
import { createDriveApi } from '../../../web/drive/driveApi';
import { createFakeAuth, createFakeDrive, type FakeDrive } from '../../../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../../../web/webHost';
import { createWebArchive } from '../../../web/webSessions';
import { useDriveStatus } from '../../../hooks/useDriveStatus';
import { WebDriveEraseSection, WebDriveExportRow, WebDriveSection } from './WebDriveSection';

// The Drive parts of the web settings (the account and "Elimina i dati da Drive" sections of
// Impostazioni → Google Drive, and the "Esporta nel mio Drive" row of the backup), sharing one
// status, on the real web host with a fake login and Drive.

function DriveCards() {
  const drive = useDriveStatus();
  return (
    <>
      <WebDriveSection drive={drive} />
      <WebDriveEraseSection drive={drive} />
      <WebDriveExportRow drive={drive} />
    </>
  );
}

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
const input = (name: string) => ({ name, completed_at_iso: '2026-10-27T08:00:00.000Z', effective_model: 'm', input_path: '' });
const emptyFolders = { format: 'el-sbobinator-sync-folders', version: 1, folders: [], deleted: {} };

describe('WebDriveSection', () => {
  it('unlinked, says why to link and links in one tap, with no browser/Drive choice to make first', async () => {
    const drive = createFakeDrive();
    const { login, factory } = setup(drive);
    await createWebArchive(factory).create(input('Anatomia'), '<p>ossa</p>');
    render(<DriveCards />);
    const linkButton = await screen.findByRole('button', { name: 'Collega Google Drive' });
    await waitFor(() => expect((linkButton as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryAllByRole('radio')).toEqual([]);
    expect(screen.getByTestId('web-drive-reasons').textContent).toContain('le ritrovi sugli altri dispositivi');
    // The button answers the reasons on its left; what goes to Drive is the detail after it.
    expect(screen.getByTestId('web-drive-reasons').parentElement!.nextElementSibling).toBe(linkButton.parentElement);
    expect(linkButton.compareDocumentPosition(screen.getByTestId('web-drive-scope')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Elimina tutti i miei dati da Drive' })).toBeNull();

    fireEvent.click(linkButton);
    expect(login.calls).toEqual([{ silent: false }]);
    expect(choice()).toBe('drive');
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Collegato come studente@example.com'));
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /));
    expect(drive.files()).toHaveLength(1);
    expect(screen.queryByTestId('web-drive-reasons')).toBeNull();
  });

  it('offers the reconnect tap when the login of a remembered account is gone', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { email: 'studente@example.com' });
    render(<DriveCards />);
    const reconnect = await screen.findByRole('button', { name: 'Riconnetti' });
    // Said once, in the account box, beside the badge.
    const expired = screen.getByTestId('web-drive-last-sync');
    expect(expired.textContent).toContain('non vanno su Drive finché non riconnetti');
    expect(expired.className).toContain('--warning-text');
    expect(screen.queryByRole('button', { name: 'Sincronizza ora' })).toBeNull();
    fireEvent.click(reconnect);
    expect(login.calls).toEqual([{ silent: true }]);
    await screen.findByRole('button', { name: 'Sincronizza ora' });
  });

  it('disconnecting asks what to do with Drive first, and "Disconnetti" deletes nothing', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive, { token: true, email: 'studente@example.com' });
    render(<DriveCards />);
    await waitFor(() => expect(screen.getByTestId('web-drive-last-sync').textContent).toMatch(/^Ultima sincronizzazione: /), { timeout: 5000 });
    drive.setOffline(true);
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizza ora' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Google Drive non raggiungibile'));
    drive.setOffline(false);

    // The way out sits in the account box, beside "Sincronizza ora"; the question opens under the
    // box and nothing happens before an answer.
    const account = screen.getByTestId('web-drive-account');
    // Avatar and text form one block that keeps its width; the actions wrap under it on a phone
    // instead of squeezing the text to a word per line.
    const identity = within(account).getByTestId('web-drive-identity');
    expect(identity.className).toContain('flex-[1_1_14rem]');
    expect(identity.contains(screen.getByTestId('web-drive-last-sync'))).toBe(true);
    expect(identity.contains(within(account).getByRole('button', { name: 'Disconnetti questo browser' }))).toBe(false);
    fireEvent.click(within(account).getByRole('button', { name: 'Disconnetti questo browser' }));
    expect(login.disconnects).toHaveLength(0);
    // Under the box: when it syncs, then the question.
    expect(account.nextElementSibling).toBe(screen.getByTestId('web-drive-when'));
    expect(screen.getByTestId('web-drive-when').nextElementSibling).toBe(screen.getByRole('group', { name: 'Smetti di usare Google Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByTestId('web-drive-status').textContent).toBe('Collegato come studente@example.com');

    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti questo browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti' }));
    await screen.findByRole('button', { name: 'Collega Google Drive' });
    expect(login.disconnects).toHaveLength(1);
    expect(choice()).toBe('browser');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('"Disconnetti ed elimina" empties the hidden folder', async () => {
    const drive = createFakeDrive();
    drive.put('raccolte.json', emptyFolders);
    const { login } = setup(drive, { token: true, email: 'studente@example.com' });
    render(<DriveCards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnetti questo browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnetti ed elimina' }));
    await waitFor(() => expect(choice()).toBe('browser'));
    expect(drive.files()).toEqual([]);
    expect(login.disconnects).toHaveLength(1);
  });

  it('"Elimina tutti i miei dati da Drive" asks first, with the other ways to do it', async () => {
    const drive = createFakeDrive();
    drive.put('raccolte.json', emptyFolders);
    setup(drive, { token: true, email: 'studente@example.com' });
    render(<DriveCards />);
    expect((await screen.findByRole('link', { name: 'myaccount.google.com/permissions' })).getAttribute('href')).toBe('https://myaccount.google.com/permissions');
    expect(screen.getByTestId('web-drive-erase').textContent).toContain('Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti');

    fireEvent.click(await screen.findByRole('button', { name: 'Elimina tutti i miei dati da Drive' }));
    const confirm = screen.getByRole('group', { name: 'Elimina tutti i miei dati da Drive' });
    // Only what the section text doesn't already say: no repeat of "Le sbobine in questo browser restano".
    expect(confirm.textContent).toContain('Questo browser verrà scollegato da Drive');
    expect(confirm.textContent).toContain('scollegali prima');
    expect(confirm.textContent).not.toContain('Le sbobine in questo browser restano');
    expect(screen.getByTestId('web-drive-erase').textContent).toContain('Le sbobine in questo browser restano');
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(drive.files()).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Elimina tutti i miei dati da Drive' }));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(choice()).toBe('browser'));
    expect(drive.files()).toEqual([]);
  });

  it('exports with progress and a link to the new folder, also from the browser only', async () => {
    const drive = createFakeDrive();
    const { login, factory } = setup(drive);
    const archive = createWebArchive(factory);
    await archive.create(input('Rene'), '<p>nefrone</p>');
    await archive.create(input('Cuore'), '<p>valvole</p>');
    render(<DriveCards />);
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta tutte le sbobine nel mio Drive' }));
    expect(login.calls).toEqual([{ silent: false, scope: 'https://www.googleapis.com/auth/drive.file' }]);
    const result = await screen.findByTestId('web-drive-export-result');
    expect(result.textContent).toMatch(/^2 sbobine esportate in “El Sbobinator – esportazione \d{4}-\d{2}-\d{2}”\./);
    expect(screen.getByRole('link', { name: 'Apri la cartella' }).getAttribute('href')).toContain('drive.google.com');
    expect(drive.visibleFiles().filter(file => file.name.endsWith('.html'))).toHaveLength(2);
    // Still not linked: the export does not turn the sync on.
    expect(screen.getByRole('button', { name: 'Collega Google Drive' })).toBeTruthy();
  });

  it('says why an export could not start', async () => {
    const drive = createFakeDrive();
    const { login } = setup(drive);
    render(<DriveCards />);
    login.failures.push(new DriveAuthError('file_scope_missing'));
    fireEvent.click(await screen.findByRole('button', { name: 'Esporta tutte le sbobine nel mio Drive' }));
    expect((await screen.findByTestId('web-drive-export-result')).textContent).toContain('permesso di creare file');
    expect(screen.queryByRole('link', { name: 'Apri la cartella' })).toBeNull();
  });
});

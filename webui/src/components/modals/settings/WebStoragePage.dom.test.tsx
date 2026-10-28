import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDriveApi } from '../../../web/drive/driveApi';
import { createFakeAuth, createFakeDrive } from '../../../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../../../web/webHost';
import { WebDrivePage } from './WebDrivePage';
import { WebStoragePage } from './WebStoragePage';

// Impostazioni → Archiviazione of the web build, and Impostazioni → Sincronizzazione beside it.

const sessionInfo = { total_bytes: 1024 * 1024, total_sessions: 3, session_root: '', persisted: false };

function setup(withDrive: boolean) {
  const drive = createFakeDrive();
  const login = createFakeAuth('pc', { token: true, email: 'studente@example.com' });
  const client = (getToken: () => string | null) => createDriveApi({ getToken, onUnauthorized: () => login.auth.expire(), fetchImpl: drive.fetch, sleep: async () => {} });
  const connection = { auth: login.auth, api: client(() => login.auth.token()), exportApi: (token: string) => client(() => token) };
  window.pywebview = { api: createWebPywebviewApi(() => {}, { database: new IDBFactory(), ...(withDrive ? { drive: connection, driveDelayMs: 20 } : {}) }) };
}

afterEach(() => {
  delete window.pywebview;
  localStorage.clear();
});

const cardTitles = () => screen.getAllByRole('region').map(card => card.getAttribute('aria-label'));

describe('WebStoragePage', () => {
  it('groups the page in three sections, with the export to Drive as a row of the backup', async () => {
    setup(true);
    render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
    await waitFor(() => expect(screen.getByText('Salvate anche su Drive')).toBeTruthy());
    expect(cardTitles()).toEqual(['Le tue sbobine', 'Backup delle sbobine', 'Cestino']);
    expect(screen.queryByTestId('web-drive')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Backup delle sbobine' })).getByTestId('web-drive-export')).toBeTruthy();
  });

  it('the Sincronizzazione page goes account with what goes to Drive, then the erase', async () => {
    setup(true);
    render(<WebDrivePage />);
    await waitFor(() => expect(screen.getByTestId('web-drive-status').textContent).toBe('Collegato come studente@example.com'));
    expect(cardTitles()).toEqual(['Account Google', 'Elimina i dati da Drive']);
    // In view, not folded, in the account section: the audio stays in this browser.
    const scope = within(screen.getByRole('region', { name: 'Account Google' })).getByTestId('web-drive-scope');
    expect(scope.querySelector('details')).toBeNull();
    expect(scope.textContent).toContain('Audio delle lezioni e chiavi API: restano in questo browser');
    // The erase button sits on the description's line, not alone under it.
    const erase = screen.getByRole('button', { name: 'Elimina tutti i miei dati da Drive' });
    expect(erase.previousElementSibling?.textContent).toContain('Cancella da Google Drive');
  });

  it('an unlinked Drive is one tap away from the warning on the sbobine', async () => {
    setup(true);
    localStorage.clear();
    await window.pywebview!.api!.disconnect_drive!();
    const onOpenDrive = vi.fn();
    render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} onOpenDrive={onOpenDrive} />);
    const warning = await screen.findByTestId('storage-persist-warning');
    await waitFor(() => expect(within(warning).getByRole('button', { name: 'Attiva la sincronizzazione' })).toBeTruthy());
    const link = within(warning).getByRole('button', { name: 'Attiva la sincronizzazione' });
    // A link in the sentence, not a second "Collega" button beside the one on the Drive page.
    expect(link.closest('p')?.textContent).toContain('Attiva la sincronizzazione: le sbobine restano anche nel tuo Google Drive.');
    expect(within(warning).queryByRole('button', { name: 'Collega Google Drive' })).toBeNull();
    fireEvent.click(link);
    expect(onOpenDrive).toHaveBeenCalledTimes(1);
  });

  it('without Drive keeps the sections that work in this browser alone', () => {
    // Builds without a Google client ID have no trash either (web_backup.spec.ts).
    setup(false);
    render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
    expect(cardTitles()).toEqual(['Le tue sbobine', 'Backup delle sbobine']);
    expect(screen.queryByTestId('web-drive-export')).toBeNull();
  });

  it('folds the long explanations under "Più informazioni"-style toggles', () => {
    setup(false);
    render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
    const toggle = screen.getByText('Cosa c’è nel backup');
    const details = toggle.closest('details')!;
    expect(details.open).toBe(false);
    expect(screen.getByTestId('web-backup-scope').textContent).toContain('Le chiavi API non sono incluse');
    fireEvent.click(toggle);
    expect(details.open).toBe(true);
    // The warning keeps the short reason in view and folds the Safari detail.
    expect(screen.getByTestId('storage-persist-warning').querySelector('details')!.textContent).toContain('circa 7 giorni');
  });
});

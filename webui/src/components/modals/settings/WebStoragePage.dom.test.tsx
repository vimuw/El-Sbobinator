import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDriveApi } from '../../../web/drive/driveApi';
import { createFakeAuth, createFakeDrive } from '../../../web/drive/fakeDrive';
import { createWebPywebviewApi } from '../../../web/webHost';
import { WebDrivePage } from './WebDrivePage';
import { REVEAL_TIMEOUT_MS, WebStoragePage } from './WebStoragePage';

// Impostazioni → Archiviazione of the web build, and Impostazioni → Google Drive beside it.

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

  it('the Google Drive page goes account with what goes to Drive, then the erase', async () => {
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

  describe('first load', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>(done => { resolve = done; });
      return { promise, resolve };
    }

    // Each section asks the host on its own: the answers are held here and released one by one.
    function setupPending() {
      const drive = deferred<{ connected: boolean }>();
      const backup = deferred<Record<string, unknown>>();
      const trash = deferred<{ ok: boolean; sessions: [] }>();
      window.pywebview = {
        api: {
          get_drive_status: vi.fn(() => drive.promise),
          get_web_backup_info: vi.fn(() => backup.promise),
          list_trash: vi.fn(() => trash.promise),
        } as never,
      };
      return { drive, backup, trash };
    }

    const page = () => screen.getByTestId('web-storage-page');
    const backupInfo = { ok: true, sessions: 3, text_bytes: 2048, audio_bytes: 5 * 1024 * 1024, audio_files: 2, last_backup_at: null };

    it('shows the page at once, when space, Drive, backup and trash have all answered, and keeps it shown', async () => {
      const pending = setupPending();
      const view = render(<WebStoragePage sessionInfo={null} isLoadingSessionInfo onArchiveChanged={() => {}} />);
      expect(page().dataset.revealed).toBe('false');
      expect(page().getAttribute('aria-busy')).toBe('true');

      view.rerender(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
      await act(async () => pending.backup.resolve(backupInfo));
      await act(async () => pending.trash.resolve({ ok: true, sessions: [] }));
      // The badge would still flip from "Non protette" to "Salvate anche su Drive".
      expect(page().dataset.revealed).toBe('false');

      await act(async () => pending.drive.resolve({ connected: true }));
      expect(page().dataset.revealed).toBe('true');
      expect(screen.getByText('Salvate anche su Drive')).toBeTruthy();

      // A restore reads the space again: the page stays, with its loading line.
      view.rerender(<WebStoragePage sessionInfo={null} isLoadingSessionInfo onArchiveChanged={() => {}} />);
      expect(page().dataset.revealed).toBe('true');
    });

    it('does not hold the page hidden past the timeout when a section never answers', () => {
      vi.useFakeTimers();
      try {
        setupPending();
        render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
        act(() => vi.advanceTimersByTime(REVEAL_TIMEOUT_MS - 1));
        expect(page().dataset.revealed).toBe('false');
        act(() => vi.advanceTimersByTime(1));
        expect(page().dataset.revealed).toBe('true');
      } finally {
        vi.useRealTimers();
      }
    });

    it('draws the audio switch already on when the backup figures arrive, instead of sliding it on', async () => {
      const pending = setupPending();
      render(<WebStoragePage sessionInfo={sessionInfo} isLoadingSessionInfo={false} onArchiveChanged={() => {}} />);
      const loadingSwitch = screen.getByRole('switch', { name: 'Includi gli audio delle lezioni nel backup' });
      expect(loadingSwitch.getAttribute('aria-checked')).toBe('false');

      await act(async () => pending.backup.resolve(backupInfo));
      const knownSwitch = screen.getByRole('switch', { name: 'Includi gli audio delle lezioni nel backup' });
      expect(knownSwitch.getAttribute('aria-checked')).toBe('true');
      // A new element: its CSS transition has no "off" state to start from.
      expect(knownSwitch).not.toBe(loadingSwitch);
      expect(loadingSwitch.isConnected).toBe(false);
    });
  });
});

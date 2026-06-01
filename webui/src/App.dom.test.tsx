import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import App from './App';
import { useApiReady } from './hooks/useApiReady';
import { useBridgeCallbacks } from './hooks/useBridgeCallbacks';
import { useQueuePersistence } from './hooks/useQueuePersistence';
import { useUpdateChecker } from './hooks/useUpdateChecker';
import type { FileDonePayload } from './appState';

vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_: unknown, tag: string) => {
      return React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
        const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, variants: _v, layoutId: _li, whileTap: _wt, whileHover: _wh, ...rest } = props;
        return React.createElement(tag, { ...rest, ref: ref as React.Ref<unknown> });
      });
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn() }),
}));

vi.mock('./hooks/useApiReady');

const mockApiReadyDefault = {
  apiReady: false,
  bridgeDelayed: false,
  apiKey: '',
  setApiKey: vi.fn(),
  hasProtectedKey: false,
  apiKeyInsecure: false,
  setApiKeyInsecure: vi.fn(),
  apiKeyInsecureReason: '',
  setApiKeyInsecureReason: vi.fn(),
  configRecoveredFrom: '',
  fallbackKeys: [],
  setFallbackKeys: vi.fn(),
  preferredModel: 'gemini-2.5-flash',
  setPreferredModel: vi.fn(),
  fallbackModels: [],
  setFallbackModels: vi.fn(),
  availableModels: [],
  refreshSettings: vi.fn(),
};

const mockApiReadyWithKey = {
  ...mockApiReadyDefault,
  apiReady: true,
  apiKey: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
};

vi.mock('./hooks/useUpdateChecker');

vi.mock('./hooks/useQueuePersistence', () => ({
  useQueuePersistence: vi.fn(),
}));

vi.mock('./hooks/useBridgeCallbacks', () => ({
  useBridgeCallbacks: vi.fn().mockReturnValue(undefined),
}));

vi.mock('./hooks/usePreview', () => ({
  usePreview: () => ({
    preview: { content: null, title: '', path: '', audioSrc: null, fileId: null, sourcePath: '', sessionDir: '', audioRelinkNeeded: false, initAudio: {} },
    openPreview: vi.fn(),
    closePreview: vi.fn(),
    relinkPreviewAudio: vi.fn(),
    handleAudioStateChange: vi.fn(),
    handleScrollTopChange: vi.fn(),
  }),
}));

vi.mock('./components/EditorFullPage', () => ({
  EditorFullPage: () => null,
}));

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

function setElSbobinatorBridge() {
  const callbacks: Record<string, (...args: unknown[]) => void> = {};
  Object.defineProperty(window, 'elSbobinatorBridge', {
    value: {
      onSetCurrentFile: (cb: (...args: unknown[]) => void) => { callbacks['setCurrentFile'] = cb; },
      onFileDone: (cb: (...args: unknown[]) => void) => { callbacks['fileDone'] = cb; },
      onFileFailed: (cb: (...args: unknown[]) => void) => { callbacks['fileFailed'] = cb; },
      onProcessDone: (cb: (...args: unknown[]) => void) => { callbacks['processDone'] = cb; },
      onWorkTotals: (cb: (...args: unknown[]) => void) => { callbacks['workTotals'] = cb; },
      onWorkDone: (cb: (...args: unknown[]) => void) => { callbacks['workDone'] = cb; },
      onStepTime: (cb: (...args: unknown[]) => void) => { callbacks['stepTime'] = cb; },
      onAskNewKey: (cb: (...args: unknown[]) => void) => { callbacks['askNewKey'] = cb; },
    },
    writable: true,
    configurable: true,
  });
  return callbacks;
}

beforeEach(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  localStorage.clear();
  setPywebview({
    get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
    get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
  });
  setElSbobinatorBridge();
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')));
  vi.mocked(useApiReady).mockReturnValue(mockApiReadyDefault);
  vi.mocked(useUpdateChecker).mockReturnValue({
    updateAvailable: null,
    latestVersion: null,
    isDismissed: false,
    isCheckingUpdate: false,
    hasChecked: true,
    checkFailed: false,
    checkForUpdates: vi.fn(),
    dismissUpdate: vi.fn(),
  });
  vi.mocked(useBridgeCallbacks).mockReturnValue(undefined);
});

afterEach(() => {
  localStorage.clear();
  setPywebview(undefined);
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('renders the app header with logo', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByAltText('El Sbobinator')).toBeTruthy();
  });

  it('renders in setup mode when no API key is set', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText('Configura la tua API Key')).toBeTruthy();
  });

  it('renders footer with GitHub link', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText(/GitHub/)).toBeTruthy();
  });

  it('renders Ko-fi link in footer', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText(/caffè/)).toBeTruthy();
  });

  it('shows API key input in setup mode', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByPlaceholderText(/Incolla qui la tua API Key/)).toBeTruthy();
  });

  it('shows advanced settings link in setup mode', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText('Apri impostazioni avanzate')).toBeTruthy();
  });

  it('settings button opens settings modal', async () => {
    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Apri impostazioni'));
    });
    expect(screen.getByRole('heading', { name: /Impostazioni/ })).toBeTruthy();
  });

  it('console toggle button shows console panel', async () => {
    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mostra console'));
    });
    expect(screen.getByRole('heading', { name: 'Console' })).toBeTruthy();
  });

  it('shows config recovery warning without exposing the full path', async () => {
    localStorage.setItem('peakBannerDismissedUntil', String(Date.now() + 86_400_000));
    vi.mocked(useApiReady).mockReturnValue({
      ...mockApiReadyDefault,
      configRecoveredFrom: 'C:\\Users\\me\\AppData\\Roaming\\El Sbobinator\\config.json',
    });

    await act(async () => { render(<App />); });

    expect(screen.getByText(/file di configurazione era corrotto/i)).toBeTruthy();
    expect(screen.queryByText(/C:\\Users\\me/)).toBeNull();
  });

  it('does not show config recovery warning again after dismissal for same path', async () => {
    localStorage.setItem('peakBannerDismissedUntil', String(Date.now() + 86_400_000));
    const recoveredPath = 'C:\\broken\\config.json';
    vi.mocked(useApiReady).mockReturnValue({
      ...mockApiReadyDefault,
      configRecoveredFrom: recoveredPath,
    });

    let unmount: () => void = () => {};
    await act(async () => {
      ({ unmount } = render(<App />));
    });
    expect(await screen.findByText(/file di configurazione era corrotto/i)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Chiudi notifica'));
    });
    unmount();

    await act(async () => { render(<App />); });
    expect(screen.queryByText(/file di configurazione era corrotto/i)).toBeNull();
  });

  it('Settings install receives async checksum error and shows actionable fallback', async () => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
    vi.mocked(useUpdateChecker).mockReturnValue({
      updateAvailable: null,
      latestVersion: 'v2.0.0',
      isDismissed: false,
      isCheckingUpdate: false,
      hasChecked: true,
      checkFailed: false,
      checkForUpdates: vi.fn(),
      dismissUpdate: vi.fn(),
    });
    const downloadUpdate = vi.fn().mockResolvedValue({ ok: true, status: 'downloading' });
    const openUrl = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      download_and_install_update: downloadUpdate,
      open_url: openUrl,
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Apri impostazioni/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    expect(downloadUpdate).toHaveBeenCalledWith('v2.0.0');
    expect(await screen.findAllByText(/Download aggiornamento/i)).toHaveLength(2);
    const bridgeOptions = vi.mocked(useBridgeCallbacks).mock.calls.at(-1)?.[0];
    expect(bridgeOptions).toBeTruthy();
    await act(async () => {
      bridgeOptions?.onDownloadProgress?.({
        status: 'error',
        bytes_done: 10,
        bytes_total: 10,
        error: 'Verifica integrità fallita: il file scaricato non corrisponde al checksum atteso.',
      });
    });

    expect(await screen.findAllByText(/Verifica integrità fallita/i)).toHaveLength(2);
    expect(screen.getAllByText('Apri GitHub').length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(screen.getAllByText('Apri GitHub')[0]);
    });
    expect(openUrl).toHaveBeenCalledWith('https://github.com/vimuw/El-Sbobinator/releases/latest');
  });

  it('does not duplicate update install toast when progress arrives before first toast render', async () => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
    vi.mocked(useUpdateChecker).mockReturnValue({
      updateAvailable: null,
      latestVersion: 'v2.0.0',
      isDismissed: false,
      isCheckingUpdate: false,
      hasChecked: true,
      checkFailed: false,
      checkForUpdates: vi.fn(),
      dismissUpdate: vi.fn(),
    });
    const downloadUpdate = vi.fn().mockImplementation(() => {
      const bridgeOptions = vi.mocked(useBridgeCallbacks).mock.calls.at(-1)?.[0];
      bridgeOptions?.onDownloadProgress?.({
        status: 'downloading',
        bytes_done: 5,
        bytes_total: 10,
      });
      return Promise.resolve({ ok: true, status: 'downloading' });
    });
    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      download_and_install_update: downloadUpdate,
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Apri impostazioni/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    expect(downloadUpdate).toHaveBeenCalledWith('v2.0.0');
    expect(await screen.findAllByText(/Download aggiornamento/i)).toHaveLength(2);
  });

  it('recreates update install toast after GitHub fallback action dismisses it', async () => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
    vi.mocked(useUpdateChecker).mockReturnValue({
      updateAvailable: null,
      latestVersion: 'v2.0.0',
      isDismissed: false,
      isCheckingUpdate: false,
      hasChecked: true,
      checkFailed: false,
      checkForUpdates: vi.fn(),
      dismissUpdate: vi.fn(),
    });
    const downloadUpdate = vi.fn().mockResolvedValue({ ok: true, status: 'downloading' });
    const openUrl = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      download_and_install_update: downloadUpdate,
      open_url: openUrl,
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Apri impostazioni/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    const bridgeOptions = vi.mocked(useBridgeCallbacks).mock.calls.at(-1)?.[0];
    expect(bridgeOptions).toBeTruthy();
    await act(async () => {
      bridgeOptions?.onDownloadProgress?.({
        status: 'error',
        bytes_done: 10,
        bytes_total: 10,
        error: 'Verifica integrità fallita: il file scaricato non corrisponde al checksum atteso.',
      });
    });
    expect(await screen.findAllByText(/Verifica integrità fallita/i)).toHaveLength(2);

    const githubActions = screen.getAllByText('Apri GitHub');
    await act(async () => {
      fireEvent.click(githubActions[githubActions.length - 1]);
    });
    expect(openUrl).toHaveBeenCalledWith('https://github.com/vimuw/El-Sbobinator/releases/latest');
    expect(screen.getAllByText(/Verifica integrità fallita/i)).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    expect(downloadUpdate).toHaveBeenCalledTimes(2);
    expect(await screen.findAllByText(/Download aggiornamento/i)).toHaveLength(2);
  });

  it('Settings install success resolves and shows installer-started state', async () => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
    vi.mocked(useUpdateChecker).mockReturnValue({
      updateAvailable: null,
      latestVersion: 'v2.0.0',
      isDismissed: false,
      isCheckingUpdate: false,
      hasChecked: true,
      checkFailed: false,
      checkForUpdates: vi.fn(),
      dismissUpdate: vi.fn(),
    });
    const downloadUpdate = vi.fn().mockResolvedValue({ ok: true, status: 'downloading' });
    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      download_and_install_update: downloadUpdate,
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Apri impostazioni/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    expect(await screen.findAllByText(/Download aggiornamento/i)).toHaveLength(2);
    const bridgeOptions = vi.mocked(useBridgeCallbacks).mock.calls.at(-1)?.[0];
    expect(bridgeOptions).toBeTruthy();
    await act(async () => {
      bridgeOptions?.onDownloadProgress?.({ status: 'done', bytes_done: 10, bytes_total: 10 });
    });

    expect(await screen.findAllByText(/Installer avviato/i)).toHaveLength(2);
  });

  it('Settings install UAC denied leaves app open and explains the cancellation', async () => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
    vi.mocked(useUpdateChecker).mockReturnValue({
      updateAvailable: null,
      latestVersion: 'v2.0.0',
      isDismissed: false,
      isCheckingUpdate: false,
      hasChecked: true,
      checkFailed: false,
      checkForUpdates: vi.fn(),
      dismissUpdate: vi.fn(),
    });
    const downloadUpdate = vi.fn().mockResolvedValue({ ok: true, status: 'downloading' });
    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      download_and_install_update: downloadUpdate,
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Apri impostazioni/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Installa aggiornamento'));
    });

    expect(await screen.findAllByText(/Download aggiornamento/i)).toHaveLength(2);
    const bridgeOptions = vi.mocked(useBridgeCallbacks).mock.calls.at(-1)?.[0];
    expect(bridgeOptions).toBeTruthy();
    await act(async () => {
      bridgeOptions?.onDownloadProgress?.({ status: 'error', bytes_done: 0, bytes_total: 0, error: 'uac_denied' });
    });

    expect(await screen.findAllByText(/richiesta UAC è stata rifiutata/i)).toHaveLength(2);
    expect(screen.getByRole('heading', { name: /Impostazioni/ })).toBeTruthy();
  });
});

describe('App — ready-empty mode (valid API key, no files)', () => {
  beforeEach(() => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
  });

  it('shows DropZone when api key is valid and no files queued', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText('Trascina i file qui')).toBeTruthy();
  });

  it('shows API ready status in header', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByLabelText('API pronta')).toBeTruthy();
  });

  it('footer links are visible', async () => {
    await act(async () => { render(<App />); });
    expect(screen.getByText(/GitHub/)).toBeTruthy();
    expect(screen.getByText(/caffè/)).toBeTruthy();
  });

  it('console panel shows when console toggle is clicked', async () => {
    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Mostra console'));
    });
    expect(screen.getByRole('heading', { name: 'Console' })).toBeTruthy();
  });
});

describe('App ? low disk start warning', () => {
  beforeEach(() => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
  });

  it('shows a blocking low-disk modal and retries with override', async () => {
    const startProcessing = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        low_disk_warning: {
          needed_bytes: 2_147_483_648,
          free_bytes: 536_870_912,
          location: 'C:\\Temp',
          kind: 'combined',
          file_name: 'lesson.mp3',
        },
      })
      .mockResolvedValueOnce({ ok: true });

    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      check_path_exists: vi.fn().mockResolvedValue({ ok: true, exists: true }),
      start_processing: startProcessing,
    });

    vi.mocked(useQueuePersistence).mockImplementation((_files, _structuralVersion, dispatch) => {
      React.useEffect(() => {
        dispatch({
          type: 'queue/add',
          files: [{
            id: 'file-1',
            name: 'lesson.mp3',
            size: 123,
            duration: 60,
            path: 'C:\\Media\\lesson.mp3',
            status: 'queued',
            progress: 0,
            phase: 0,
          }],
        });
      }, [dispatch]);
    });

    await act(async () => { render(<App />); });
    await act(async () => {
      fireEvent.click(await screen.findByText('Avvia sbobinatura (1 file)'));
    });

    expect(await screen.findByRole('heading', { name: 'Spazio libero insufficiente' })).toBeTruthy();
    expect(screen.getAllByText(/lesson\.mp3/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByText('Continua comunque'));
    });

    expect(startProcessing).toHaveBeenCalledTimes(2);
    expect(startProcessing.mock.calls[0][5]).toBe(false);
    expect(startProcessing.mock.calls[1][5]).toBe(true);
  });
});

describe('App — executeRetryFromArchive concurrency protection', () => {
  beforeEach(() => {
    vi.mocked(useApiReady).mockReturnValue(mockApiReadyWithKey);
  });

  it('guards against concurrent retry triggers in executeRetryFromArchive', async () => {
    const testSession = {
      session_dir: 'C:\\sessions\\session-1',
      name: 'Lezione test',
      html_path: '', // Empty string to prevent filtering from Archive list
      input_path: 'C:\\audio\\test-session.mp3',
      input_size: 1000,
      duration_sec: 120,
      completed_at_iso: '2026-05-22T23:54:52+02:00',
      effective_model: 'gemini-2.5-flash',
      revision_failed_blocks: [1, 2],
    };

    const retryFailed = vi.fn().mockImplementation(() => new Promise(() => {}));

    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [testSession] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      retry_failed_revision_blocks: retryFailed,
    });

    await act(async () => {
      render(<App />);
    });

    // Switch to Archive page (second sidebar button)
    await act(async () => {
      const navButtons = document.querySelectorAll('.sidebar-nav-item');
      fireEvent.click(navButtons[1]);
    });

    // Verify session card is shown on Archive page
    expect(await screen.findByText('Lezione test')).toBeTruthy();

    // Click "Riprova revisione" button on the session card
    await act(async () => {
      fireEvent.click(screen.getByText('Riprova revisione'));
    });

    // Check that confirm modal is shown
    expect(await screen.findByRole('heading', { name: 'Ripristinare e riprovare la revisione?' })).toBeTruthy();

    // Click "Riprova revisione" in the confirm modal
    await act(async () => {
      const confirmButton = document.querySelector('.modal-action-button.is-danger');
      if (confirmButton) fireEvent.click(confirmButton);
    });

    // Verify "Riprovo…" spinner/text is shown (meaning the file item was added and isRetryingBlocks is true)
    expect(await screen.findByText('Riprovo…')).toBeTruthy();

    // Now go back to Archive page to trigger second retry
    await act(async () => {
      const navButtons = document.querySelectorAll('.sidebar-nav-item');
      fireEvent.click(navButtons[1]);
    });

    // Click "Riprova revisione" on the card again
    await act(async () => {
      fireEvent.click(screen.getByText('Riprova revisione'));
    });

    // Confirm dialog shown again
    expect(await screen.findByRole('heading', { name: 'Ripristinare e riprovare la revisione?' })).toBeTruthy();

    // Click "Riprova revisione" in the confirm modal again
    await act(async () => {
      const confirmButton = document.querySelector('.modal-action-button.is-danger');
      if (confirmButton) fireEvent.click(confirmButton);
    });

    // This will call executeRetryFromArchive again while the first one is still running.
    // Let's verify that the toast warning "Retry già in corso per questa sessione." is displayed!
    expect(await screen.findByText('Retry già in corso per questa sessione.')).toBeTruthy();
  });

  it('displays the general failure toast when retry fails with general error', async () => {
    const testSession = {
      session_dir: 'C:\\sessions\\session-2',
      name: 'Lezione errore generale',
      html_path: '',
      input_path: 'C:\\audio\\error-session.mp3',
      input_size: 1000,
      duration_sec: 120,
      completed_at_iso: '2026-05-22T23:54:52+02:00',
      effective_model: 'gemini-2.5-flash',
      revision_failed_blocks: [1],
    };

    const retryFailed = vi.fn().mockResolvedValue({
      ok: false,
      error: 'API key mancante sul disco',
    });

    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [testSession] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      retry_failed_revision_blocks: retryFailed,
    });

    await act(async () => {
      render(<App />);
    });

    // Switch to Archive page (second sidebar button)
    await act(async () => {
      const navButtons = document.querySelectorAll('.sidebar-nav-item');
      fireEvent.click(navButtons[1]);
    });

    // Verify session card is shown
    expect(await screen.findByText('Lezione errore generale')).toBeTruthy();

    // Click "Riprova revisione" button
    await act(async () => {
      fireEvent.click(screen.getByText('Riprova revisione'));
    });

    // Confirm dialog shown
    expect(await screen.findByRole('heading', { name: 'Ripristinare e riprovare la revisione?' })).toBeTruthy();

    // Click "Riprova revisione" in the confirm modal
    await act(async () => {
      const confirmButton = document.querySelector('.modal-action-button.is-danger');
      if (confirmButton) fireEvent.click(confirmButton);
    });

    // Verify "API key mancante sul disco" toast is displayed!
    expect(await screen.findByText('API key mancante sul disco')).toBeTruthy();
  });

  it('updates isRetryingBlocks and guards against concurrent retries when Toast "Riprova" is clicked', async () => {
    const testSession = {
      session_dir: 'C:\\sessions\\session-3',
      name: 'Lezione avvisi toast',
      html_path: '',
      input_path: 'C:\\audio\\toast-session.mp3',
      input_size: 1000,
      duration_sec: 120,
      completed_at_iso: '2026-05-22T23:54:52+02:00',
      effective_model: 'gemini-2.5-flash',
      revision_failed_blocks: [1, 2, 3],
    };

    const retryFailed = vi.fn().mockImplementation(() => new Promise(() => {}));

    setPywebview({
      get_completed_sessions: vi.fn().mockResolvedValue({ ok: true, sessions: [testSession] }),
      get_archive_folders: vi.fn().mockResolvedValue({ ok: true, folders: [] }),
      retry_failed_revision_blocks: retryFailed,
    });

    vi.mocked(useQueuePersistence).mockImplementation((_files, _structuralVersion, dispatch) => {
      React.useEffect(() => {
        dispatch({
          type: 'queue/add',
          files: [{
            id: 'file-toast-1',
            name: 'Lezione avvisi toast',
            size: 1000,
            duration: 120,
            path: 'C:\\audio\\toast-session.mp3',
            status: 'done',
            progress: 100,
            phase: 3,
            outputDir: 'C:\\sessions\\session-3',
            outputHtml: 'C:\\sessions\\session-3\\toast-session.html',
            completionStatus: 'completed_with_warnings',
            revisionFailedBlocks: [1, 2, 3],
          }],
        });
      }, [dispatch]);
    });

    let bridgeCallbacks: { onFileDone?: (data: FileDonePayload) => void } = {};
    vi.mocked(useBridgeCallbacks).mockImplementation((options) => {
      bridgeCallbacks = {
        onFileDone: (data: FileDonePayload) => options.onRevisionWarning?.(data),
      };
      return undefined;
    });

    await act(async () => {
      render(<App />);
    });

    // Verify file card is rendered in the queue
    expect(await screen.findByText('Lezione avvisi toast')).toBeTruthy();

    // Trigger the fileDone bridge event to show the warning toast
    await act(async () => {
      bridgeCallbacks.onFileDone?.({
        index: 0,
        id: 'file-toast-1',
        output_html: 'C:\\sessions\\session-3\\toast-session.html',
        output_dir: 'C:\\sessions\\session-3',
        revision_failed_blocks: [1, 2, 3],
        completion_status: 'completed_with_warnings',
      });
    });

    // Check that warning toast is displayed
    expect(await screen.findByText(/sezioni sono state incluse/i)).toBeTruthy();

    // Click "Riprova" action button on the toast
    await act(async () => {
      const riprovaToastBtn = screen.getByText('Riprova');
      fireEvent.click(riprovaToastBtn);
    });

    // The toast should show loading "Riprovo..."
    expect(await screen.findByText('Riprovo...')).toBeTruthy();

    // The queue card should now show loading/retrying spinner or disabled state
    expect(await screen.findByText('Riprovo…')).toBeTruthy();
  });
});

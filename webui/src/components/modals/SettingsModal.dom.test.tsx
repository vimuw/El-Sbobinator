import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsModal } from './SettingsModal';

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

const makeProps = () => ({
  isOpen: true,
  onClose: vi.fn(),
  apiKey: 'AIzaSyTest123456',
  setApiKey: vi.fn(),
  hasProtectedKey: false,
  fallbackKeys: [],
  setFallbackKeys: vi.fn(),
  preferredModel: 'gemini-3-flash-preview',
  setPreferredModel: vi.fn(),
  fallbackModels: [],
  setFallbackModels: vi.fn(),
  availableModels: [],
  appendConsole: vi.fn(),
  latestVersion: null,
  checkForUpdates: vi.fn(),
  isCheckingUpdate: false,
  hasChecked: true,
  checkFailed: false,
});

beforeEach(() => {
  setPywebview(undefined);
});

afterEach(() => {
  setPywebview(undefined);
});

describe('SettingsModal — diagnostica chunk display', () => {
  it('shows default_chunk_minutes from availableModels registry for the primary model', async () => {
    const models = [
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)', summary: '', default_chunk_minutes: 15 },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (Preview)', summary: '', default_chunk_minutes: 10 },
    ];
    const { rerender } = render(
      <SettingsModal {...makeProps()} availableModels={models} preferredModel="gemini-3-flash-preview" />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    expect(screen.getByText('15 min')).toBeDefined();

    rerender(<SettingsModal {...makeProps()} availableModels={models} preferredModel="gemini-3.1-flash-lite-preview" />);
    expect(screen.getByText('10 min')).toBeDefined();
  });
});

describe('SettingsModal — save behavior', () => {
  it('missing bridge: modal stays open, inline error displayed, console notified', async () => {
    const onClose = vi.fn();
    const appendConsole = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} appendConsole={appendConsole} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Salva e Chiudi'));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/non disponibile/i)).not.toBeNull();
    expect(appendConsole).toHaveBeenCalledTimes(1);
    expect(appendConsole).toHaveBeenCalledWith(
      expect.stringMatching(/❌.*non disponibile|non disponibile.*❌/s),
    );
  });

  it('save_settings returns {ok:false}: modal stays open and shows backend error', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: false, error: 'quota esaurita' });
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Salva e Chiudi'));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/quota esaurita/i)).not.toBeNull();
  });

  it('successful save: onClose called and no inline error shown', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Salva e Chiudi'));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/non disponibile/i)).toBeNull();
  });

  it('successful save: refreshes settings before closing', async () => {
    const mockSave = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();
    const onSettingsSaved = vi.fn().mockResolvedValue(undefined);

    render(<SettingsModal {...makeProps()} onClose={onClose} onSettingsSaved={onSettingsSaved} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Salva e Chiudi'));
    });

    expect(onSettingsSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSettingsSaved.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('double-click: save_settings called only once, onClose called only once', async () => {
    let resolveFirst!: (val: { ok: boolean }) => void;
    const firstPromise = new Promise<{ ok: boolean }>(res => { resolveFirst = res; });
    const mockSave = vi.fn().mockReturnValueOnce(firstPromise);
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} />);

    const button = screen.getByText('Salva e Chiudi');
    fireEvent.click(button);
    fireEvent.click(button);

    await act(async () => { resolveFirst({ ok: true }); });

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('backdrop click while saving: onClose NOT called', async () => {
    let resolveFirst!: (val: { ok: boolean }) => void;
    const firstPromise = new Promise<{ ok: boolean }>(res => { resolveFirst = res; });
    const mockSave = vi.fn().mockReturnValueOnce(firstPromise);
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    const { container } = render(<SettingsModal {...makeProps()} onClose={onClose} />);

    fireEvent.click(screen.getByText('Salva e Chiudi'));

    const backdrop = container.querySelector('.absolute.inset-0') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { resolveFirst({ ok: true }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('X button click while saving: onClose NOT called', async () => {
    let resolveFirst!: (val: { ok: boolean }) => void;
    const firstPromise = new Promise<{ ok: boolean }>(res => { resolveFirst = res; });
    const mockSave = vi.fn().mockReturnValueOnce(firstPromise);
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} />);

    fireEvent.click(screen.getByText('Salva e Chiudi'));

    const xButton = screen.getByLabelText('Chiudi impostazioni');
    fireEvent.click(xButton);
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { resolveFirst({ ok: true }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsModal — session info race condition', () => {
  it('stale fetch discarded on open→close→reopen: loading not cleared prematurely', async () => {
    let resolveFirst!: (val: unknown) => void;
    let resolveSecond!: (val: unknown) => void;
    const firstPromise = new Promise(res => { resolveFirst = res; });
    const secondPromise = new Promise(res => { resolveSecond = res; });
    const mockGetInfo = vi.fn()
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise);
    setPywebview({ get_session_storage_info: mockGetInfo });

    const { rerender } = render(<SettingsModal {...makeProps()} isOpen={true} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });

    rerender(<SettingsModal {...makeProps()} isOpen={false} />);
    rerender(<SettingsModal {...makeProps()} isOpen={true} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });

    await act(async () => { resolveFirst({ ok: true, total_bytes: 999999, total_sessions: 7777 }); });

    expect(screen.queryByText('Calcolo…')).not.toBeNull();   // loading NOT prematurely cleared
    expect(screen.queryByText(/7777/)).toBeNull();            // stale data NOT applied

    await act(async () => { resolveSecond({ ok: true, total_bytes: 1024, total_sessions: 3 }); });

    expect(screen.queryByText('Calcolo…')).toBeNull();
    expect(screen.queryByText(/3 sessioni/)).not.toBeNull();
  });
});

describe('SettingsModal — main-section interactions', () => {
  it('toggles showApiKeys on show/hide button click', async () => {
    render(<SettingsModal {...makeProps()} />);
    fireEvent.click(screen.getByTitle('Mostra chiave'));
    expect(screen.getByTitle('Nascondi chiave')).toBeTruthy();
  });

  it('calls setApiKey when API key input changes', async () => {
    const setApiKey = vi.fn();
    render(<SettingsModal {...makeProps()} setApiKey={setApiKey} />);
    const input = screen.getByPlaceholderText(/AIzaSy/);
    fireEvent.change(input, { target: { value: 'AIzaSy123' } });
    expect(setApiKey).toHaveBeenCalledWith('AIzaSy123');
  });

  it('calls setFallbackKeys when fallback textarea changes', async () => {
    const setFallbackKeys = vi.fn();
    render(<SettingsModal {...makeProps()} setFallbackKeys={setFallbackKeys} />);
    const textarea = screen.getByPlaceholderText(/Inserisci una API Key per riga/);
    fireEvent.change(textarea, { target: { value: 'key1\nkey2' } });
    expect(setFallbackKeys).toHaveBeenCalledWith(['key1', 'key2']);
  });

  it('toggles notifications when switch is clicked', async () => {
    render(<SettingsModal {...makeProps()} />);
    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);
    expect(localStorage.getItem('notifications_enabled')).toBeTruthy();
  });

  it('toggles fallback keys show/hide on Mostra chiavi click', async () => {
    render(<SettingsModal {...makeProps()} />);
    fireEvent.click(screen.getByTitle('Mostra chiavi'));
    expect(screen.getByTitle('Nascondi chiavi')).toBeTruthy();
  });

  it('calls open_url when aistudio link is clicked', async () => {
    const openUrl = vi.fn();
    setPywebview({ open_url: openUrl });
    render(<SettingsModal {...makeProps()} />);
    fireEvent.click(screen.getByText(/Ottieni gratis su aistudio/));
    expect(openUrl).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
  });
});

describe('SettingsModal — session folder and cleanup', () => {
  it('calls open_session_folder when folder button is clicked', async () => {
    const openFolder = vi.fn();
    setPywebview({ open_session_folder: openFolder });
    render(<SettingsModal {...makeProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    fireEvent.click(screen.getByTitle('Apri cartella sessioni'));
    expect(openFolder).toHaveBeenCalledTimes(1);
  });

  it('calls cleanup_old_sessions for incomplete cleanup and shows result', async () => {
    const cleanupFn = vi.fn().mockResolvedValue({ ok: true, removed: 3, freed_bytes: 1024, preserved_completed: 2 });
    setPywebview({ cleanup_old_sessions: cleanupFn });
    render(<SettingsModal {...makeProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Elimina solo elaborazioni incomplete/));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Elimina incomplete'));
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/Rimoss/)).toBeTruthy(),
    );
    expect(screen.getByText(/sbobine completate preservate/)).toBeTruthy();
    expect(cleanupFn).toHaveBeenCalledWith(14);
  });

  it('counts completed notes before dangerous cleanup and deletes only after confirmation', async () => {
    const cleanupCompletedFn = vi.fn()
      .mockResolvedValueOnce({ ok: true, removed: 0, candidates: 4, freed_bytes: 2048 })
      .mockResolvedValueOnce({ ok: true, removed: 4, candidates: 4, freed_bytes: 2048 });
    setPywebview({ cleanup_completed_sessions: cleanupCompletedFn });
    render(<SettingsModal {...makeProps()} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle(/Conta ed elimina sbobine completate/));
    });
    expect(await screen.findByText(/Sbobine interessate: 4/)).toBeTruthy();
    expect(cleanupCompletedFn).toHaveBeenCalledTimes(1);
    expect(cleanupCompletedFn).toHaveBeenCalledWith(14, true);

    await act(async () => {
      fireEvent.click(screen.getByText('Elimina sbobine completate'));
    });
    await vi.waitFor(() =>
      expect(screen.getByText(/Eliminate 4 sbobine completate/)).toBeTruthy(),
    );
    expect(cleanupCompletedFn).toHaveBeenCalledTimes(2);
    expect(cleanupCompletedFn).toHaveBeenLastCalledWith(14, false);
  });
});

describe('SettingsModal — fallback models list', () => {
  it('renders fallback model card when fallbackModels is populated', async () => {
    const models = [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', summary: 'Fast and capable', default_chunk_minutes: 12 },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (Preview)', summary: 'Lightweight', default_chunk_minutes: 10 },
    ];
    render(
      <SettingsModal
        {...makeProps()}
        availableModels={models}
        preferredModel="gemini-2.5-flash"
        fallbackModels={['gemini-3.1-flash-lite-preview']}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    expect(screen.getAllByText('Gemini 3.1 Flash Lite (Preview)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Lightweight').length).toBeGreaterThan(0);
  });

  it('calls setFallbackModels when remove fallback button is clicked', async () => {
    const models = [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', summary: 'Fast', default_chunk_minutes: 12 },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Lite', summary: 'Light', default_chunk_minutes: 10 },
    ];
    const setFallbackModels = vi.fn();
    render(
      <SettingsModal
        {...makeProps()}
        availableModels={models}
        preferredModel="gemini-2.5-flash"
        fallbackModels={['gemini-3.1-flash-lite-preview']}
        setFallbackModels={setFallbackModels}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    fireEvent.click(screen.getByTitle('Rimuovi fallback'));
    expect(setFallbackModels).toHaveBeenCalled();
  });

  it('calls setFallbackModels when move-down button clicked (with 2 fallbacks)', async () => {
    const models = [
      { id: 'gemini-2.5-flash', label: 'Flash', summary: 'F', default_chunk_minutes: 12 },
      { id: 'gemini-3.1-flash-lite-preview', label: 'Lite', summary: 'L', default_chunk_minutes: 10 },
      { id: 'gemini-2.5-pro', label: 'Pro', summary: 'P', default_chunk_minutes: 20 },
    ];
    const setFallbackModels = vi.fn();
    render(
      <SettingsModal
        {...makeProps()}
        availableModels={models}
        preferredModel="gemini-2.5-flash"
        fallbackModels={['gemini-3.1-flash-lite-preview', 'gemini-2.5-pro']}
        setFallbackModels={setFallbackModels}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    fireEvent.click(screen.getAllByTitle('Sposta giù')[0]);
    expect(setFallbackModels).toHaveBeenCalled();
  });
});

describe('SettingsModal — version status display', () => {
  it('checkFailed=true: shows network-error message, hides "✓ Sei aggiornato"', () => {
    render(<SettingsModal {...makeProps()} checkFailed={true} latestVersion={null} hasChecked={true} isCheckingUpdate={false} />);
    expect(screen.queryByText(/Sei aggiornato/)).toBeNull();
    expect(screen.getByText(/non riuscita/i)).toBeTruthy();
  });

  it('checkFailed=false, hasChecked=true: shows "✓ Sei aggiornato"', () => {
    render(<SettingsModal {...makeProps()} checkFailed={false} latestVersion={null} hasChecked={true} isCheckingUpdate={false} />);
    expect(screen.getByText(/Sei aggiornato/)).toBeTruthy();
    expect(screen.queryByText(/non riuscita/i)).toBeNull();
  });

  it('isCheckingUpdate=true: shows neither status row', () => {
    render(<SettingsModal {...makeProps()} checkFailed={false} latestVersion={null} hasChecked={true} isCheckingUpdate={true} />);
    expect(screen.queryByText(/Sei aggiornato/)).toBeNull();
    expect(screen.queryByText(/non riuscita/i)).toBeNull();
  });

  it('shows shared async install error with GitHub fallback action', () => {
    const openUrl = vi.fn();
    setPywebview({ open_url: openUrl });
    render(
      <SettingsModal
        {...makeProps()}
        latestVersion="v2.0.0"
        updateInstallState={{
          version: 'v2.0.0',
          status: 'error',
          bytesDone: 0,
          bytesTotal: 0,
          error: 'Verifica integrità fallita: il file scaricato non corrisponde al checksum atteso.',
        }}
      />,
    );

    expect(screen.getByText(/Verifica integrità fallita/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Apri GitHub'));
    expect(openUrl).toHaveBeenCalledWith('https://github.com/vimuw/El-Sbobinator/releases/latest');
  });

  it('shows shared async install success state', () => {
    render(
      <SettingsModal
        {...makeProps()}
        latestVersion="v2.0.0"
        updateInstallState={{
          version: 'v2.0.0',
          status: 'done',
          bytesDone: 10,
          bytesTotal: 10,
          error: null,
        }}
      />,
    );

    expect(screen.getByText(/Installer avviato/i)).toBeTruthy();
  });
});

describe('SettingsModal — validate environment', () => {
  it('shows validation summary after clicking Verifica ambiente', async () => {
    const models = [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', summary: 'Fast', default_chunk_minutes: 12 },
    ];
    const validateFn = vi.fn().mockResolvedValue({
      ok: true,
      result: {
        ok: true,
        summary: 'Ambiente OK',
        checks: [
          { id: 'ffmpeg', label: 'ffmpeg', status: 'ok', message: 'ffmpeg trovato' },
        ],
      },
    });
    setPywebview({ validate_environment: validateFn });
    render(
      <SettingsModal
        {...makeProps()}
        availableModels={models}
        preferredModel="gemini-2.5-flash"
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByText('Avanzati').closest('button')!);
    });
    await act(async () => {
      fireEvent.click(screen.getByTitle('Verifica ambiente'));
    });
    await vi.waitFor(() => expect(screen.getByText('Ambiente OK')).toBeTruthy());
    expect(screen.getByText('ffmpeg')).toBeTruthy();
  });
});

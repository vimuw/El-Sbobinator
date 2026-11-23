import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  SettingsModal,
  type SettingsAuthProps,
  type SettingsModelsProps,
  type SettingsStorageProps,
  type SettingsModalProps,
} from './SettingsModal';
import type { ModelOption } from '../../bridge';
import { STORAGE_KEYS } from '../../storageKeys';
import { DEFAULT_CAPABILITIES, setHostCapabilities } from '../../hostCapabilities';
import { IDBFactory } from 'fake-indexeddb';
import { createApiUsageStore } from '../../web/apiUsage';
import { createWebPywebviewApi } from '../../web/webHost';
import { APP_VERSION } from '../../branding';
import { BACKDROP_SHAKE_MS } from '../../hooks/useBackdropDismiss';
import { UNSAVED_CHANGES_HINT } from './UnsavedChangesHint';

const motionCache = new Map<string, React.ForwardRefExoticComponent<React.PropsWithoutRef<Record<string, unknown>> & React.RefAttributes<unknown>>>();
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_: unknown, tag: string | symbol) => {
      if (typeof tag !== 'string') return undefined;
      if (!motionCache.has(tag)) {
        motionCache.set(
          tag,
          React.forwardRef((props: Record<string, unknown>, ref: unknown) => {
            const { initial: _i, animate: _a, exit: _e, transition: _t, layout: _l, variants: _v, layoutId: _li, whileTap: _wt, whileHover: _wh, ...rest } = props;
            return React.createElement(tag, { ...rest, ref: ref as React.Ref<unknown> });
          })
        );
      }
      return motionCache.get(tag);
    },
  }),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn() }),
}));

function setPywebview(api: Record<string, unknown> | undefined) {
  Object.defineProperty(window, 'pywebview', {
    value: api === undefined ? undefined : { api },
    writable: true,
    configurable: true,
  });
}

interface MakePropsOverrides {
  isOpen?: boolean;
  onClose?: () => void;
  appendConsole?: (msg: string) => void;
  onSettingsSaved?: () => Promise<unknown> | unknown;
  auth?: Partial<SettingsAuthProps>;
  models?: Partial<SettingsModelsProps>;
  storage?: Partial<SettingsStorageProps>;
  apiKey?: string;
  setApiKey?: (key: string) => void;
  fallbackKeys?: string[];
  setFallbackKeys?: React.Dispatch<React.SetStateAction<string[]>>;
  preferredModel?: string;
  setPreferredModel?: (model: string) => void;

  availableModels?: ModelOption[];
}

const makeProps = (overrides: MakePropsOverrides = {}): SettingsModalProps => ({
  isOpen: overrides.isOpen ?? true,
  onClose: overrides.onClose ?? vi.fn(),
  appendConsole: overrides.appendConsole ?? vi.fn(),
  onSettingsSaved: overrides.onSettingsSaved,
  auth: {
    apiKey: overrides.apiKey ?? overrides.auth?.apiKey ?? 'AIzaSyTest123456',
    setApiKey: overrides.setApiKey ?? overrides.auth?.setApiKey ?? vi.fn(),
    fallbackKeys: overrides.fallbackKeys ?? overrides.auth?.fallbackKeys ?? [],
    setFallbackKeys: overrides.setFallbackKeys ?? overrides.auth?.setFallbackKeys ?? vi.fn(),
  },
  models: {
    preferredModel: overrides.preferredModel ?? overrides.models?.preferredModel ?? 'gemini-2.5-flash',
    setPreferredModel: overrides.setPreferredModel ?? overrides.models?.setPreferredModel ?? vi.fn(),

    availableModels: overrides.availableModels ?? overrides.models?.availableModels ?? [],
  },
  storage: {
  },
});

beforeEach(() => {
  setPywebview(undefined);
});

afterEach(() => {
  setPywebview(undefined);
});

describe('SettingsModal — model parameters chunk display', () => {
  it('does not display technical chunk duration or temperature parameters in UI', async () => {
    const models = [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', summary: '', default_chunk_minutes: 15 },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', summary: '', default_chunk_minutes: 15 },
    ];
    render(
      <SettingsModal {...makeProps({ availableModels: models, preferredModel: 'gemini-3.6-flash' })} />,
    );
    await act(async () => {
      fireEvent.click(screen.getAllByText('Generale')[0].closest('button')!);
    });
    expect(screen.queryByText('15 min')).toBeNull();
    expect(screen.queryByText(/Durata blocco/i)).toBeNull();
  });
});

describe('SettingsModal — API usage and support tab', () => {
  it('keeps the newer usage check when a slower earlier request finishes later', async () => {
    let resolveInitial!: (value: unknown) => void;
    const getUsage = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveInitial = resolve; }))
      .mockResolvedValue({ ok: true, result: { primary_status: 'operational', credentials: [{ id: 'k' }] } });
    setPywebview({ get_api_usage: getUsage });
    const props = makeProps();
    const { rerender } = render(<SettingsModal {...props} />);
    await act(async () => {
      rerender(<SettingsModal {...props} models={{ ...props.models, preferredModel: 'gemini-3.6-flash' }} />);
    });
    expect(getUsage.mock.lastCall?.[2]).toBe('gemini-3.6-flash');
    await act(async () => {
      resolveInitial({ ok: true, result: { primary_status: 'credential_error', credentials: [{ id: 'k' }] } });
    });
    expect(screen.queryByText('Verifica la chiave API')).toBeNull();
  });

  it('does not poll API usage or show activity counters in the support tab', async () => {
    vi.useFakeTimers();
    const getUsage = vi.fn().mockResolvedValue({ ok: true, result: { telemetry: { requests_sent: 7 } } });
    setPywebview({ get_api_usage: getUsage });
    const { unmount } = render(<SettingsModal {...makeProps()} />);
    try {
      await act(async () => {});
      getUsage.mockClear();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Assistenza' })); });
      await act(async () => { vi.advanceTimersByTime(30_000); });
      expect(getUsage).not.toHaveBeenCalled();
      expect(screen.queryByText('Attività di oggi')).toBeNull();
      expect(screen.queryByText('Ritentativi')).toBeNull();
    } finally {
      unmount();
      vi.useRealTimers();
    }
  });

});

describe('SettingsModal — save behavior', () => {
  it('restores unsaved keys and models when Annulla closes and reopens the modal', () => {
    const primaryKey = 'AIzaABCDEFGHIJKLMNOPQRST';
    const originalFallback = 'AIzaBBBBBBBBBBBBBBBBBBBB';
    const addedFallback = 'AIzaCCCCCCCCCCCCCCCCCCCC';
    const availableModels = [
      { id: 'gemini-primary', label: 'Gemini Primary', summary: '', default_chunk_minutes: 15 },
      { id: 'gemini-alternate', label: 'Gemini Alternate', summary: '', default_chunk_minutes: 15 },
    ];

    function StatefulSettingsHarness() {
      const [isOpen, setIsOpen] = React.useState(true);
      const [apiKey, setApiKey] = React.useState(primaryKey);
      const [fallbackKeys, setFallbackKeys] = React.useState([originalFallback]);
      const [preferredModel, setPreferredModel] = React.useState('gemini-primary');

      return (
        <>
          <button type="button" onClick={() => setIsOpen(true)}>Riapri</button>
          <SettingsModal
            {...makeProps({
              isOpen,
              onClose: () => setIsOpen(false),
              apiKey,
              setApiKey,
              fallbackKeys,
              setFallbackKeys,
              preferredModel,
              setPreferredModel,

              availableModels,
            })}
          />
        </>
      );
    }

    render(<StatefulSettingsHarness />);

    const input = screen.getByLabelText('Nuova chiave di riserva');
    fireEvent.change(input, { target: { value: addedFallback } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('Riserva 2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Gemini Primary/i }));
    fireEvent.click(screen.getByRole('option', { name: /Gemini Alternate/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Riapri' }));

    expect(screen.queryByText('Riserva 2')).toBeNull();
    expect(screen.queryByText('...CCCC')).toBeNull();
    expect(screen.getByRole('button', { name: /Gemini Primary/i })).toBeTruthy();
  });

  it('lets the mobile content column shrink so the footer remains inside the modal', () => {
    render(<SettingsModal {...makeProps()} />);

    const footer = screen.getByText('Salva e Chiudi').closest('.modal-footer');
    const contentColumn = footer?.parentElement;

    expect(contentColumn?.className).toContain('min-h-0');
    expect(contentColumn?.className).not.toMatch(/(?:^|\s)h-full(?:\s|$)/);
  });

  it('keeps the page title and close button outside the scrolling content', () => {
    render(<SettingsModal {...makeProps()} />);
    const content = screen.getByTestId('settings-content');

    expect(content.contains(screen.getByRole('button', { name: 'Chiudi finestra' }))).toBe(false);
    expect(content.contains(screen.getByRole('heading', { name: 'Generale' }))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Archiviazione' }));
    expect(screen.getByRole('heading', { name: 'Archiviazione', level: 2 })).toBeTruthy();
  });

  it('names the settings navigation in sentence case, not shouted caps', () => {
    render(<SettingsModal {...makeProps()} />);
    const title = screen.getByRole('heading', { name: 'Impostazioni' });

    expect(title.className).not.toContain('uppercase');
    expect(title.className).not.toContain('tracking-wide');
  });

  it('holds the card entrance until the mounted tree has painted a frame', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 0;
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.set(++nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => {
      frames.delete(id);
    });
    onTestFinished(() => {
      requestFrame.mockRestore();
      cancelFrame.mockRestore();
    });
    const runFrame = () => act(() => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach(callback => callback(performance.now()));
    });

    render(<SettingsModal {...makeProps()} />);
    const card = document.querySelector('.modal-card');
    expect(card?.getAttribute('data-entered')).toBe('false');

    // The first frame carries the expensive layout of the new tree; the entrance starts after it.
    runFrame();
    expect(card?.getAttribute('data-entered')).toBe('false');
    runFrame();
    expect(card?.getAttribute('data-entered')).toBe('true');
  });

  it('starts each settings tab at the top after scrolling the previous tab', () => {
    render(<SettingsModal {...makeProps()} />);
    const content = screen.getByTestId('settings-content');
    content.scrollTop = 250;
    fireEvent.click(screen.getByRole('button', { name: 'Assistenza' }));
    expect(content.scrollTop).toBe(0);
    expect(screen.getByRole('button', { name: 'Assistenza' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Generale' }).getAttribute('aria-current')).toBeNull();
  });

  it('missing bridge: modal stays open, inline error displayed, console notified', async () => {
    const onClose = vi.fn();
    const appendConsole = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} appendConsole={appendConsole} />);

    await act(async () => {
      fireEvent.click(screen.getByText('Salva e Chiudi'));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/Salvataggio non disponibile/i)).not.toBeNull();
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
    expect(screen.queryByText(/Salvataggio non disponibile/i)).toBeNull();
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

  it('a click outside closes the settings when nothing waits to be saved', () => {
    const onClose = vi.fn();
    render(<SettingsModal {...makeProps()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('settings-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click outside with unsaved edits keeps them: the card shakes and "Salva e Chiudi" lights up', () => {
    vi.useFakeTimers();
    onTestFinished(() => { vi.useRealTimers(); });
    const onClose = vi.fn();
    const props = makeProps({ onClose });
    const { container, rerender } = render(<SettingsModal {...props} />);
    rerender(<SettingsModal {...props} models={{ ...props.models, preferredModel: 'gemini-3.6-flash' }} />);

    fireEvent.click(screen.getByTestId('settings-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('.modal-card')?.classList.contains('is-shaking')).toBe(true);
    expect(screen.getByRole('button', { name: 'Salva e Chiudi' }).classList.contains('is-attention')).toBe(true);

    // A line beside the buttons says why, and stays once the shake is over.
    expect(screen.getByText(UNSAVED_CHANGES_HINT).getAttribute('role')).toBe('status');
    act(() => { vi.advanceTimersByTime(BACKDROP_SHAKE_MS); });
    expect(screen.getByText(UNSAVED_CHANGES_HINT).getAttribute('role')).toBe('status');
    expect(container.querySelector('.modal-card')?.classList.contains('is-shaking')).toBe(false);
    expect(screen.getByRole('button', { name: 'Salva e Chiudi' }).classList.contains('is-attention')).toBe(false);
    // The draft model is still there: nothing restored the saved one.
    expect(props.models.setPreferredModel).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a click outside does nothing while the settings are being saved', async () => {
    let resolveSave!: (value: { ok: boolean }) => void;
    setPywebview({ save_settings: vi.fn(() => new Promise(resolve => { resolveSave = resolve; })) });
    const onClose = vi.fn();
    render(<SettingsModal {...makeProps()} onClose={onClose} />);
    await act(async () => { fireEvent.click(screen.getByText('Salva e Chiudi')); });

    fireEvent.click(screen.getByTestId('settings-backdrop'));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => { resolveSave({ ok: true }); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape key when idle', () => {
    const onClose = vi.fn();
    render(<SettingsModal {...makeProps()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it('Annulla button click while saving: onClose NOT called', async () => {
    let resolveFirst!: (val: { ok: boolean }) => void;
    const firstPromise = new Promise<{ ok: boolean }>(res => { resolveFirst = res; });
    const mockSave = vi.fn().mockReturnValueOnce(firstPromise);
    setPywebview({ save_settings: mockSave });
    const onClose = vi.fn();

    render(<SettingsModal {...makeProps()} onClose={onClose} />);

    fireEvent.click(screen.getByText('Salva e Chiudi'));

    const cancelButton = screen.getByRole('button', { name: 'Annulla' });
    fireEvent.click(cancelButton);
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
      fireEvent.click(screen.getByText('Archiviazione').closest('button')!);
    });

    rerender(<SettingsModal {...makeProps()} isOpen={false} />);
    rerender(<SettingsModal {...makeProps()} isOpen={true} />);
    await act(async () => {
      fireEvent.click(screen.getByText('Archiviazione').closest('button')!);
    });

    await act(async () => { resolveFirst({ ok: true, total_bytes: 999999, total_sessions: 7777 }); });

    expect(screen.queryByText('Calcolo dello spazio occupato…')).not.toBeNull();   // loading NOT prematurely cleared
    expect(screen.queryByText(/7777/)).toBeNull();            // stale data NOT applied

    await act(async () => { resolveSecond({ ok: true, total_bytes: 1024, total_sessions: 3 }); });

    expect(screen.queryByText('Calcolo dello spazio occupato…')).toBeNull();
    expect(screen.getByTestId('storage-usage').textContent).toContain('3 sbobine');
  });
});

describe('SettingsModal — main-section interactions', () => {
  it('offers copying the saved primary key without revealing it', () => {
    render(<SettingsModal {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni chiave principale' }));
    expect(screen.getByRole('button', { name: 'Copia chiave' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mostra in chiaro' })).toBeNull();
  });

  it('calls setApiKey when API key is added to empty settings', async () => {
    const setApiKey = vi.fn();
    render(<SettingsModal {...makeProps({ apiKey: '', setApiKey })} />);
    const input = screen.getByPlaceholderText(/Inserisci chiave principale/);
    fireEvent.change(input, { target: { value: 'AIzaSy1234567890123456789' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(setApiKey).toHaveBeenCalledWith('AIzaSy1234567890123456789');
  });

  it('calls setFallbackKeys when a fallback key is added', async () => {
    const setFallbackKeys = vi.fn();
    render(<SettingsModal {...makeProps({ setFallbackKeys })} />);
    const input = screen.getByLabelText('Nuova chiave di riserva');
    fireEvent.change(input, { target: { value: 'AIzaSyFallbackKey123456789' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(setFallbackKeys).toHaveBeenCalledWith(['AIzaSyFallbackKey123456789']);
  });

  it('only allows revealing the new key input', () => {
    render(<SettingsModal {...makeProps()} />);
    expect(screen.queryByRole('button', { name: 'Mostra chiavi' })).toBeNull();
    const input = screen.getByLabelText('Nuova chiave di riserva');
    expect(input.getAttribute('type')).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Mostra nuova chiave' }));
    expect(input.getAttribute('type')).toBe('text');
  });

  it('calls open_url when aistudio link is clicked', async () => {
    const openUrl = vi.fn();
    setPywebview({ open_url: openUrl });
    render(<SettingsModal {...makeProps()} />);
    fireEvent.click(screen.getByText(/Ottieni gratis su aistudio/));
    expect(openUrl).toHaveBeenCalledWith('https://aistudio.google.com/apikey');
  });

  it('opens confirmation modal and removes API key when confirmed', async () => {
    const setApiKey = vi.fn();
    const setFallbackKeys = vi.fn();
    render(
      <SettingsModal
        {...makeProps({
          apiKey: 'AIzaSyPrimary1234567890',
          fallbackKeys: ['AIzaSyReserve1111111111'],
          setApiKey,
          setFallbackKeys,
        })}
      />
    );

    const kebab = screen.getByRole('button', { name: 'Opzioni chiave principale' });
    fireEvent.click(kebab);

    const removeBtn = screen.getByRole('button', { name: 'Rimuovi chiave' });
    fireEvent.click(removeBtn);

    expect(screen.getByText('Rimuovi chiave API')).toBeTruthy();
    expect(screen.getByText(/La Chiave Riserva 1 verrà promossa automaticamente a nuova chiave principale/i)).toBeTruthy();

    const confirmBtn = screen.getByRole('button', { name: 'Rimuovi' });
    fireEvent.click(confirmBtn);

    expect(setApiKey).toHaveBeenCalledWith('AIzaSyReserve1111111111');
    expect(setFallbackKeys).toHaveBeenCalledWith([]);
  });
});

describe('SettingsModal — model section', () => {
  it('shows the 3.6 Flash default badge and the "Più lento" note of the slower models', async () => {
    const models = [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', summary: '', default_chunk_minutes: 15, is_default: true },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', summary: 'Più lento', default_chunk_minutes: 15 },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', summary: 'Più lento', default_chunk_minutes: 15 },
    ];
    const { rerender } = render(
      <SettingsModal
        {...makeProps({
          availableModels: models,
          preferredModel: 'gemini-3.6-flash',
        })}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getAllByText('Generale')[0].closest('button')!);
    });
    expect(screen.getByText('Modello di trascrizione')).toBeTruthy();
    const trigger = screen.getByRole('button', { name: /Gemini 3.6 Flash/i });
    // The closed select shows only the choice; the Default badge appears while choosing
    expect(trigger.textContent).not.toContain('Default');
    fireEvent.click(trigger);
    const selectedOption = screen.getByRole('option', { name: /^Gemini 3.6 Flash.*Default/i });
    expect(selectedOption.getAttribute('aria-selected')).toBe('true');
    expect(selectedOption.textContent).not.toContain('Più lento');
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByRole('option', { name: /Gemini 2\.5 Flash/i })).toBeNull();
    // Written out, not a tooltip: touch screens show it too.
    expect(screen.getByRole('option', { name: /^Gemini 3.8 Flash/i }).textContent).toContain('(Più lento)');
    expect(screen.getByRole('option', { name: /^Gemini 4 Hydrogen/i }).textContent).toContain('(Più lento)');
    fireEvent.click(trigger);
    rerender(<SettingsModal {...makeProps({ availableModels: models, preferredModel: 'gemini-4-hydrogen' })} />);
    expect(screen.getByRole('button', { name: /Gemini 4 Hydrogen/i }).textContent).toContain('(Più lento)');
  });

  it('calls setPreferredModel when another model is selected', async () => {
    const models = [
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', summary: '', default_chunk_minutes: 15 },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', summary: 'Più lento', default_chunk_minutes: 15 },
    ];
    const setPreferredModel = vi.fn();
    render(
      <SettingsModal
        {...makeProps({
          availableModels: models,
          preferredModel: 'gemini-3.6-flash',
          setPreferredModel,
        })}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getAllByText('Generale')[0].closest('button')!);
    });
    const trigger = screen.getByRole('button', { name: /Gemini 3.6 Flash/i });
    fireEvent.click(trigger);
    const option = screen.getByRole('option', { name: /^Gemini 3.8 Flash/i });
    fireEvent.click(option);
    expect(setPreferredModel).toHaveBeenCalledWith('gemini-3.8-flash');
  });
});

describe('SettingsModal — tabs and footer', () => {
  it.each([
    ['Assistenza', 'Assistenza'],
    ['Archiviazione', 'Archiviazione'],
  ])('shows only Chiudi in %s when nothing is pending', async (tab, heading) => {
    render(<SettingsModal {...makeProps({ apiKey: 'test-api-key' })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: tab }));
    });

    expect(screen.getByRole('heading', { name: heading, level: 2 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Chiudi' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Salva e Chiudi' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Annulla' })).toBeNull();
    expect(screen.queryByText(/effetto immediato/)).toBeNull();
  });

  it('keeps save and cancel in the support tab when general settings have pending changes', async () => {
    const props = makeProps();
    const { rerender } = render(<SettingsModal {...props} />);
    rerender(<SettingsModal {...props} models={{ ...props.models, preferredModel: 'gemini-3.6-flash' }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Assistenza' }));
    });
    expect(screen.getByRole('button', { name: 'Salva e Chiudi' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Annulla' })).toBeTruthy();
  });

  it('renders sidebar tabs in the correct order: Generale, Archiviazione, Assistenza', () => {
    const { container } = render(
      <SettingsModal
        {...makeProps({
          apiKey: 'test-api-key',
        })}
      />,
    );

    const sidebar = container.querySelector('nav[aria-label="Sezioni delle impostazioni"]');
    expect(sidebar).toBeTruthy();
    // The close button shares the tab row on the compact card: count the tabs only.
    const buttons = sidebar ? Array.from(sidebar.querySelectorAll('button.settings-nav-item')) : [];
    const buttonTexts = buttons.map(b => b.textContent?.trim() || '');
    expect(buttonTexts).toHaveLength(3);
    expect(buttonTexts[0]).toContain('Generale');
    expect(buttonTexts[1]).toContain('Archiviazione');
    expect(buttonTexts[2]).toContain('Assistenza');
  });
});

describe('SettingsModal on the web host', () => {
  beforeEach(() => {
  });
  afterEach(() => {
    setHostCapabilities(DEFAULT_CAPABILITIES);
  });

  it('lists the keys with the shared-device warning and no app-only sections', () => {
    render(<SettingsModal {...makeProps({ apiKey: 'AIzaSyPrimary1234567890123', fallbackKeys: ['AIzaSyReserve1234567890456'] })} />);

    // Same key section as the desktop: rows with a menu and the add field, not a free text box.
    expect(screen.queryByLabelText('Chiavi API Gemini, una per riga')).toBeNull();
    expect(screen.getByText('Principale')).toBeTruthy();
    expect(screen.getByText('...0123')).toBeTruthy();
    expect(screen.getByText('Riserva 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Opzioni chiave principale' })).toBeTruthy();
    expect(screen.getByLabelText('Nuova chiave di riserva')).toBeTruthy();
    expect(screen.queryByText('Protetta')).toBeNull();
    expect(screen.getByTestId('shared-device-warning').textContent).toContain('solo in questo browser');
    // The one-go removal sits in the shared-device notice that explains it, not in the section header.
    expect(within(screen.getByTestId('shared-device-warning')).getByRole('button', { name: 'Rimuovi tutte le chiavi' })).toBeTruthy();
    // Beside the text on every width: on a phone it used to wrap alone into the bottom-left corner.
    expect(screen.getByTestId('shared-device-warning').className).not.toContain('flex-wrap');
    expect(screen.queryByText('Notifiche di sistema')).toBeNull();
    expect(screen.queryByText('Versione e aggiornamenti')).toBeNull();
    // No updater on the web: the version is shown, updates arrive with the next load.
    expect(screen.getByTestId('web-version').textContent).toContain(`${APP_VERSION}. Gli aggiornamenti arrivano da soli`);

    fireEvent.click(screen.getByRole('button', { name: /Assistenza/ }));
    expect(screen.getByRole('button', { name: 'Copia report diagnostico' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verifica ambiente' })).toBeNull();
  });

  it('links the privacy notice of the site from the version section', () => {
    render(<SettingsModal {...makeProps()} />);

    const link = within(screen.getByTestId('web-version')).getByRole('link', { name: 'informativa sulla privacy' });
    expect(link.getAttribute('href')).toBe('/privacy');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('re-reads the space on Archiviazione when a Drive sync changed the archive, keeping the old figures meanwhile', async () => {
    let resolveSecond: (value: unknown) => void = () => {};
    const getInfo = vi.fn()
      .mockResolvedValueOnce({ ok: true, total_bytes: 2048, total_sessions: 5, session_root: 'browser' })
      .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
    setPywebview({ get_session_storage_info: getInfo });
    const props = makeProps({ isOpen: false });
    const { rerender } = render(<SettingsModal {...props} storage={{ archiveRevision: 0 }} />);
    rerender(<SettingsModal {...props} isOpen storage={{ archiveRevision: 0 }} initialTab="storage" />);
    await vi.waitFor(() => expect(screen.getByTestId('storage-count').textContent).toBe('5'));

    // A sbobina restored on another device arrived with the sync while the page is open.
    rerender(<SettingsModal {...props} isOpen storage={{ archiveRevision: 1 }} initialTab="storage" />);
    expect(getInfo).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('storage-count').textContent).toBe('5');
    await act(async () => { resolveSecond({ ok: true, total_bytes: 4096, total_sessions: 6, session_root: 'browser' }); });
    expect(screen.getByTestId('storage-count').textContent).toBe('6');
  });

  it('reads Archiviazione on opening, so the tab shows at once like the others and keeps its figures on return', async () => {
    let resolveReturn: (value: unknown) => void = () => {};
    const getInfo = vi.fn()
      .mockResolvedValueOnce({ ok: true, total_bytes: 2048, total_sessions: 5, session_root: 'browser', persisted: false })
      .mockReturnValueOnce(new Promise(resolve => { resolveReturn = resolve; }));
    const getBackup = vi.fn().mockResolvedValue({ ok: true, sessions: 5, text_bytes: 2048, audio_bytes: 4096, audio_files: 1, last_backup_at: null });
    const listTrash = vi.fn().mockResolvedValue({ ok: true, sessions: [] });
    setPywebview({ get_session_storage_info: getInfo, get_web_backup_info: getBackup, list_trash: listTrash });
    const props = makeProps({ isOpen: false });
    const { rerender } = render(<SettingsModal {...props} />);
    rerender(<SettingsModal {...props} isOpen />);

    // Still on Generale: the figures are read already, once each.
    await vi.waitFor(() => expect(listTrash).toHaveBeenCalled());
    await act(async () => {});
    expect(getInfo).toHaveBeenCalledTimes(1);
    expect(getBackup).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Archiviazione' }));
    // Shown on the tab's first frame, with what was read, not after a wait.
    expect(screen.getByTestId('web-storage-page').dataset.revealed).toBe('true');
    expect(screen.getByTestId('storage-count').textContent).toBe('5');
    expect(screen.getByRole('switch', { name: 'Includi gli audio delle lezioni nel backup' }).getAttribute('aria-checked')).toBe('true');

    // Back on the tab later: the last figures show while the space is read again.
    fireEvent.click(screen.getByRole('button', { name: /Generale/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Archiviazione' }));
    expect(screen.getByTestId('web-storage-page').dataset.revealed).toBe('true');
    expect(screen.getByTestId('storage-count').textContent).toBe('5');
    expect(screen.queryByText('Calcolo dello spazio occupato…')).toBeNull();
    await act(async () => { resolveReturn({ ok: true, total_bytes: 4096, total_sessions: 6, session_root: 'browser', persisted: false }); });
    expect(screen.getByTestId('storage-count').textContent).toBe('6');
  });

  it('opens on Archiviazione when asked, e.g. from the moved-address notice', () => {
    const props = makeProps({ isOpen: false });
    const { rerender } = render(<SettingsModal {...props} />);
    rerender(<SettingsModal {...props} isOpen initialTab="storage" />);

    expect(screen.getByRole('heading', { name: 'Archiviazione', level: 2 })).toBeTruthy();
    expect(screen.getByText('Backup delle sbobine')).toBeTruthy();
  });

  it('describes only what each tab holds on the web', () => {
    render(<SettingsModal {...makeProps()} />);

    // The desktop headers promised system preferences and an environment check the web does not have.
    expect(screen.getByText('Modello di trascrizione e chiavi API Google Gemini salvate in questo browser.')).toBeTruthy();
    expect(screen.queryByText(/preferenze di sistema/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Assistenza/ }));
    expect(screen.getByText('Segnala un problema e allega il report con gli errori registrati.')).toBeTruthy();
    expect(screen.queryByText(/pronta a trascrivere/)).toBeNull();
  });

  it('adds a reserve key from the add field', () => {
    const setFallbackKeys = vi.fn();
    render(<SettingsModal {...makeProps({ apiKey: 'AIzaSyPrimary1234567890123', setFallbackKeys })} />);

    fireEvent.change(screen.getByLabelText('Nuova chiave di riserva'), { target: { value: 'AIzaSyTwo12345678901234567' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiungi chiave di riserva' }));

    expect(setFallbackKeys).toHaveBeenLastCalledWith(['AIzaSyTwo12345678901234567']);
  });

  it('shows from the web host which key is exhausted today and which takes over', async () => {
    const values = new Map<string, string>();
    const usage = createApiUsageStore({ getItem: key => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) });
    usage.markQuotaExhausted('AIzaSyPrimary1234567890123', 'gemini-3.8-flash');
    localStorage.setItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1, 'AIzaSyPrimary1234567890123\nAIzaSyReserve1234567890456');
    setPywebview(createWebPywebviewApi(() => {}, { database: new IDBFactory(), usage }) as unknown as Record<string, unknown>);
    onTestFinished(() => localStorage.removeItem(STORAGE_KEYS.WEB_GEMINI_KEYS_V1));

    render(<SettingsModal {...makeProps({ apiKey: 'AIzaSyPrimary1234567890123', fallbackKeys: ['AIzaSyReserve1234567890456'], preferredModel: 'gemini-3.8-flash' })} />);

    expect(await screen.findByText('Esaurita oggi')).toBeTruthy();
    expect(screen.getByText('Attiva')).toBeTruthy();
    expect(screen.getByTestId('api-key-availability').textContent).toContain('1 di 2 disponibili oggi · si ricaricano alle 09:00');
    expect(screen.getByTestId('api-key-availability').getAttribute('title')).toContain('Reset quote: ore 09:00 (ora italiana / 00:00 PT)');
    expect(screen.getByRole('table', { name: 'Disponibilità delle chiavi per modello' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Chiave Principale: non disponibile per Gemini 3.8 Flash' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'Chiave Principale: disponibile per Gemini 3.6 Flash' })).toBeTruthy();
  });

  it('removes all the keys from the browser right away, after asking', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ ok: true });
    const setApiKey = vi.fn();
    const setFallbackKeys = vi.fn();
    const onSettingsSaved = vi.fn();
    setPywebview({ save_settings: saveSettings });
    render(<SettingsModal {...makeProps({ apiKey: 'AIzaSyPrimary1234567890123', setApiKey, setFallbackKeys, onSettingsSaved, preferredModel: 'gemini-3.6-flash' })} />);

    // The trash only asks: "Annulla" keeps the key.
    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi la chiave' }));
    expect(screen.getByRole('group', { name: 'Rimuovi la chiave' }).textContent).toContain('Rimuovere la chiave da questo browser?');
    fireEvent.click(within(screen.getByRole('group', { name: 'Rimuovi la chiave' })).getByRole('button', { name: 'Annulla' }));
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: 'Rimuovi la chiave' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rimuovi la chiave' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Rimuovi' }));
    });

    expect(saveSettings).toHaveBeenCalledWith('', [], 'gemini-3.6-flash');
    expect(setApiKey).toHaveBeenCalledWith('');
    expect(setFallbackKeys).toHaveBeenCalledWith([]);
    expect(onSettingsSaved).toHaveBeenCalledTimes(1);
  });

  it('copies the diagnostic report with the site version from Assistenza', async () => {
    const getReport = vi.fn().mockResolvedValue({ ok: true, report: 'REPORT' });
    setPywebview({ get_diagnostic_report: getReport });
    const writeText = vi.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    onTestFinished(() => {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    });
    const appendConsole = vi.fn();
    render(<SettingsModal {...makeProps({ appendConsole })} />);

    fireEvent.click(screen.getByRole('button', { name: /Assistenza/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Copia report diagnostico' }));

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('REPORT'));
    expect(getReport).toHaveBeenCalledWith(undefined, undefined, undefined, undefined, APP_VERSION);
    expect(appendConsole).toHaveBeenCalledWith('📋 Report diagnostico copiato negli appunti.');
  });

  it('re-reads the space and tells the app when a sbobina comes back from the trash', async () => {
    const trashed = { session_dir: 'web-session://cestino', html_path: 'web-session://cestino/sbobina.html', name: 'Fisiologia', trashed_at: new Date().toISOString() };
    const getInfo = vi.fn().mockResolvedValue({ ok: true, total_bytes: 2048, total_sessions: 5, session_root: 'browser' });
    const listTrash = vi.fn()
      .mockResolvedValueOnce({ ok: true, sessions: [trashed] })
      .mockResolvedValue({ ok: true, sessions: [] });
    const restore = vi.fn().mockResolvedValue({ ok: true });
    setPywebview({
      get_session_storage_info: getInfo,
      get_web_backup_info: vi.fn().mockResolvedValue({ ok: true, sessions: 5, text_bytes: 2048, audio_bytes: 0, audio_files: 0, last_backup_at: null }),
      list_trash: listTrash,
      restore_session: restore,
    });
    const onArchiveImported = vi.fn();
    render(<SettingsModal {...makeProps()} storage={{ onArchiveImported }} initialTab="storage" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ripristina Fisiologia' }));

    await vi.waitFor(() => expect(onArchiveImported).toHaveBeenCalledTimes(1));
    expect(restore).toHaveBeenCalledWith('web-session://cestino');
    expect(getInfo.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

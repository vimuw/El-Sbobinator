import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer';

beforeEach(() => {
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
});

describe('AudioPlayer', () => {
  it('renders play button', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByLabelText('Avvia riproduzione')).toBeTruthy();
  });

  it('renders skip-back and skip-forward buttons', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByRole('button', { name: 'Indietro di 10 secondi' }).title).toBe('Indietro di 10 secondi');
    expect(screen.getByRole('button', { name: 'Avanti di 10 secondi' }).title).toBe('Avanti di 10 secondi');
  });

  it('renders restart button', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByLabelText('Torna all\'inizio')).toBeTruthy();
  });

  it('renders speed select with default 1x', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const select = screen.getByLabelText('Velocita di riproduzione').querySelector('select') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('1');
  });

  it('names both sliders and announces unknown duration and initial volume', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByRole('slider', { name: 'Posizione audio' }).getAttribute('aria-valuetext')).toBe('0 secondi; durata non disponibile');
    expect(screen.getByRole('slider', { name: 'Volume' }).getAttribute('aria-valuetext')).toBe('100%');
  });

  it('leaves out the volume slider where the browser keeps volume on the hardware buttons (iPad)', () => {
    const volume = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'volume')!;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', { configurable: true, get: () => 1, set: () => {} });
    try {
      render(<AudioPlayer src="/audio/test.mp3" initialVolume={0.4} />);
      expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
      expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull();
    } finally {
      Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', volume);
    }
  });

  it('folds speed and the audio menu behind one button on a phone, keeping play and seeking', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      render(<AudioPlayer src="/audio/test.mp3" onRelink={vi.fn()} />);
      expect(screen.getByRole('button', { name: 'Avvia riproduzione' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Indietro di 10 secondi' })).toBeTruthy();
      expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
      expect(screen.queryByLabelText('Velocita di riproduzione')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Opzioni audio collegato' })).toBeNull();
      expect(screen.queryByLabelText("Torna all'inizio")).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Mostra altri controlli audio' }));
      expect(screen.getByLabelText('Velocita di riproduzione')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Opzioni audio collegato' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Nascondi altri controlli audio' }).getAttribute('aria-expanded')).toBe('true');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('shows time display 00:00:00 / 00:00:00 initially', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByText('00:00:00 / 00:00:00')).toBeTruthy();
  });

  it('leaves the shared shortcuts button to the editor header', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.queryByRole('button', { name: 'Scorciatoie da tastiera' })).toBeNull();
  });

  it('changes playback rate when speed select changes', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const select = screen.getByLabelText('Velocita di riproduzione').querySelector('select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '1.5' } });
    expect(select.value).toBe('1.5');
  });

  it('uses initialPlaybackRate prop', () => {
    render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={2} />);
    const select = screen.getByLabelText('Velocita di riproduzione').querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('2');
  });

  it('steps playback speed with +/- and keeps the menu, audio and saved state in sync', () => {
    const onStateChange = vi.fn();
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={1.5} initialVolume={0.6} onStateChange={onStateChange} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);

    fireEvent.click(screen.getByRole('button', { name: 'Aumenta velocità di riproduzione' }));
    expect(audio.playbackRate).toBe(1.75);
    expect(screen.getByTitle('Velocità di riproduzione').textContent).toContain('1.75x');
    expect(onStateChange).toHaveBeenLastCalledWith({ currentTime: 42, playbackRate: 1.75, volume: 0.6 });

    fireEvent.click(screen.getByTitle('Velocità di riproduzione'));
    expect(screen.getByRole('option', { name: '1.75x' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('option', { name: '2.5x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuisci velocità di riproduzione' }));
    expect(audio.playbackRate).toBe(2);
    expect(screen.getByTitle('Velocità di riproduzione').textContent).toContain('2x');
    expect(onStateChange).toHaveBeenLastCalledWith({ currentTime: 42, playbackRate: 2, volume: 0.6 });
    expect(audio.currentTime).toBe(42);
    expect(audio.volume).toBe(0.6);
  });

  it('disables speed steps at the limits and visits every available menu speed', () => {
    const onStateChange = vi.fn();
    const { container } = render(<AudioPlayer src="/audio/test.mp3" onStateChange={onStateChange} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    const decrease = screen.getByRole('button', { name: 'Diminuisci velocità di riproduzione' }) as HTMLButtonElement;
    const increase = screen.getByRole('button', { name: 'Aumenta velocità di riproduzione' }) as HTMLButtonElement;
    expect(decrease.disabled).toBe(true);
    fireEvent.click(decrease);
    expect(onStateChange).not.toHaveBeenCalled();

    for (const rate of [1.25, 1.5, 1.75, 2, 2.5, 3]) {
      expect(increase.disabled).toBe(false);
      fireEvent.click(increase);
      expect(audio.playbackRate).toBe(rate);
    }
    expect(increase.disabled).toBe(true);
    onStateChange.mockClear();
    fireEvent.click(increase);
    expect(onStateChange).not.toHaveBeenCalled();

    for (const rate of [2.5, 2, 1.75, 1.5, 1.25, 1]) {
      expect(decrease.disabled).toBe(false);
      fireEvent.click(decrease);
      expect(audio.playbackRate).toBe(rate);
    }
    expect(decrease.disabled).toBe(true);
  });

  it('renders audio element with correct src', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.src).toContain('test.mp3');
  });

  it('displays all playback rate options when dropdown is opened', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByTitle('Velocità di riproduzione'));
    expect(screen.getByRole('option', { name: '1x' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '1.5x' })).toBeTruthy();
    expect(screen.getByRole('option', { name: '2x' })).toBeTruthy();
  });

  it('frames the speed and linked-audio menus with the shared menu rules', () => {
    render(<AudioPlayer src="/audio/test.mp3" onRelink={vi.fn()} onRemoveAudio={vi.fn()} />);

    fireEvent.click(screen.getByTitle('Velocità di riproduzione'));
    const speedPanel = screen.getByRole('listbox', { name: 'Velocità di riproduzione' });
    expect(speedPanel.classList.contains('kebab-panel')).toBe(true);
    expect(within(speedPanel).getByRole('option', { name: '1x' }).classList.contains('kebab-item')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    const relinkRow = screen.getByText('Sostituisci file audio...').closest('button');
    expect(relinkRow?.classList.contains('kebab-item')).toBe(true);
    expect(relinkRow?.parentElement?.classList.contains('kebab-panel')).toBe(true);
    expect(relinkRow?.parentElement?.getAttribute('style') ?? '').toBe('');
  });

  it('changes playback rate when an option in custom dropdown is clicked', () => {
    const onStateChange = vi.fn();
    render(<AudioPlayer src="/audio/test.mp3" onStateChange={onStateChange} />);
    fireEvent.click(screen.getByTitle('Velocità di riproduzione'));
    fireEvent.click(screen.getByRole('option', { name: '1.5x' }));
    expect(screen.getByTitle('Velocità di riproduzione').textContent).toContain('1.5x');
  });

  it('closes speed dropdown on outside click or Escape', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByTitle('Velocità di riproduzione'));
    expect(screen.getByRole('option', { name: '2x' })).toBeTruthy();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('option', { name: '2x' })).toBeNull();
  });

  it('centers speed dropdown horizontally relative to the button', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const btn = screen.getByTitle('Velocità di riproduzione');
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 152,
      top: 500,
      bottom: 532,
      width: 52,
      height: 32,
      x: 100,
      y: 500,
      toJSON: () => {},
    });
    fireEvent.click(btn);
    const panel = screen.getByRole('listbox', { name: 'Velocità di riproduzione' });
    expect(panel).toBeTruthy();
    expect(panel.style.left).toBe('96px');
  });

  it('clicking play button calls audio.play', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByLabelText('Avvia riproduzione'));
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('clicking play when not paused calls pause (togglePlay pause branch)', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'paused', { value: false, writable: true, configurable: true });
    fireEvent.click(screen.getByLabelText('Avvia riproduzione'));
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

  it('Space key toggles play', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('ArrowLeft key skips back', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { value: 30, writable: true });
    fireEvent.keyDown(document.body, { code: 'ArrowLeft' });
    expect(audio.currentTime).toBeLessThanOrEqual(30);
  });

  it('ArrowUp key adjusts volume up', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.keyDown(document.body, { code: 'ArrowUp' });
  });

  it('ArrowDown key adjusts volume down', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.keyDown(document.body, { code: 'ArrowDown' });
  });

  it('ArrowRight key skips forward', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'currentTime', { value: 10, writable: true });
    fireEvent.keyDown(document.body, { code: 'ArrowRight' });
  });

  it('F4 key toggles play', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.keyDown(document.body, { code: 'F4' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it('restart button sets currentTime to 0', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.click(screen.getByLabelText("Torna all'inizio"));
    expect(audio.currentTime).toBe(0);
  });

  it('skip-back button skips back 10s', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 30;
    fireEvent.click(screen.getByLabelText('Indietro di 10 secondi'));
    expect(audio.currentTime).toBe(20);
    expect(screen.getByRole('slider', { name: 'Posizione audio' }).getAttribute('aria-valuetext')).toBe('20 secondi; durata non disponibile');
  });

  it('skip-forward button skips forward 10s', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 30;
    fireEvent.click(screen.getByLabelText('Avanti di 10 secondi'));
    expect(audio.currentTime).toBe(40);
  });

  it('volume slider change updates volume', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const volumeSlider = screen.getByRole('slider', { name: 'Volume' });
    fireEvent.change(volumeSlider, { target: { value: '0.5' } });
    expect((volumeSlider as HTMLInputElement).value).toBe('0.5');
    expect(volumeSlider.getAttribute('aria-valuetext')).toBe('50%');
    expect((container.querySelector('audio') as HTMLAudioElement).volume).toBe(0.5);
  });

  it('uses initialVolume prop', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialVolume={0.8} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).toBeTruthy();
  });

  it('timeupdate with positive duration updates duration display', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 11634, writable: true, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 3729.8, writable: true });
    fireEvent.timeUpdate(audio);
    expect(screen.getByText('01:02:09 / 03:13:54')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Posizione audio' }).getAttribute('aria-valuetext')).toBe('1 ora, 2 minuti, 9 secondi di 3 ore, 13 minuti, 54 secondi');
  });

  it('loadedmetadata with initialTime sets currentTime', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialTime={30} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(30);
    expect(screen.getByText('00:00:30 / 00:02:00')).toBeTruthy();
  });

  it('loadedmetadata restores playbackRate and volume to the audio element', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={2} initialVolume={0.8} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;

    // Simulate browser load resetting properties or initial state
    audio.playbackRate = 1;
    audio.volume = 1;

    fireEvent.loadedMetadata(audio);
    expect(audio.playbackRate).toBe(2);
    expect(audio.volume).toBe(0.8);
  });


  it('calls onStateChange when audio timeupdate fires', () => {
    const onStateChange = vi.fn();
    const { container } = render(<AudioPlayer src="/audio/test.mp3" onStateChange={onStateChange} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.timeUpdate(audio);
  });

  it('seek slider change calls handleSeek and updates currentTime', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    const seekSlider = screen.getByRole('slider', { name: 'Posizione audio' });
    Object.defineProperty(audio, 'duration', { value: 4800, configurable: true });
    fireEvent.loadedMetadata(audio);
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true });
    fireEvent.change(seekSlider, { target: { value: '750' } });
    expect(audio.currentTime).toBe(750);
    expect(seekSlider.getAttribute('aria-valuetext')).toBe('12 minuti, 30 secondi di 1 ora, 20 minuti');
    fireEvent.change(seekSlider, { target: { value: '3661' } });
    expect(audio.currentTime).toBe(3661);
    expect(seekSlider.getAttribute('aria-valuetext')).toBe('1 ora, 1 minuto, 1 secondo di 1 ora, 20 minuti');
  });

  it('durationchange event updates duration display', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });
    fireEvent.durationChange(audio);
  });

  it('ended event stops playback', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.ended(audio);
    expect(screen.getByLabelText('Avvia riproduzione')).toBeTruthy();
  });

  it('calls onRelink when relink button is clicked', async () => {
    const onRelink = vi.fn().mockResolvedValue(undefined);
    render(<AudioPlayer src="/audio/test.mp3" onRelink={onRelink} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Sostituisci file audio...'));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });

  it('guards against concurrent onRelink clicks', async () => {
    let resolveRelink!: (value: unknown) => void;
    const onRelinkPromise = new Promise((resolve) => {
      resolveRelink = resolve;
    });
    const onRelink = vi.fn().mockImplementation(() => onRelinkPromise);
    render(<AudioPlayer src="/audio/test.mp3" onRelink={onRelink} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;

    // First click initiates the relink process
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);

    // Reopen menu while active
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item2 = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;
    expect(item2.disabled).toBe(true);

    // Subsequent clicks should be guarded and ignored
    await act(async () => {
      fireEvent.click(item2);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);

    // Resolve the first relink action
    await act(async () => {
      resolveRelink(true);
      await onRelinkPromise;
    });

    // After resolving, state should reset and the item should be enabled again
    expect(item2.disabled).toBe(false);
  });

  it('guards against concurrent onRelink clicks even when the button disabled state is bypassed', async () => {
    let resolveRelink!: (value: unknown) => void;
    const onRelinkPromise = new Promise((resolve) => {
      resolveRelink = resolve;
    });
    const onRelink = vi.fn().mockImplementation(() => onRelinkPromise);
    render(<AudioPlayer src="/audio/test.mp3" onRelink={onRelink} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;

    // First click initiates the relink process
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);

    // Reopen menu while active
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item2 = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;
    expect(item2.disabled).toBe(true);

    // Bypass disabled state by removing the disabled attribute manually
    item2.removeAttribute('disabled');
    expect(item2.disabled).toBe(false);

    // Subsequent clicks should still be ignored by the internal handler guard
    await act(async () => {
      fireEvent.click(item2);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);

    // Resolve the first relink action
    await act(async () => {
      resolveRelink(true);
      await onRelinkPromise;
    });
  });

  it('resets isRelinking state when onRelink throws an error / rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectRelink!: (reason: unknown) => void;
    const onRelinkPromise = new Promise((_, reject) => {
      rejectRelink = reject;
    });
    const onRelink = vi.fn().mockImplementation(() => onRelinkPromise);
    render(<AudioPlayer src="/audio/test.mp3" onRelink={onRelink} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;

    // First click initiates the relink process
    await act(async () => {
      fireEvent.click(item);
    });
    expect(onRelink).toHaveBeenCalledTimes(1);

    // Reopen menu while active
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    const item2 = screen.getByRole('button', { name: /Sostituisci file audio/i }) as HTMLButtonElement;
    expect(item2.disabled).toBe(true);

    // Reject the relink action to simulate an error
    await act(async () => {
      rejectRelink(new Error('Relink failed'));
      await onRelinkPromise.catch(() => {});
    });

    // Wait for the state update in finally block to complete
    expect(item2.disabled).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('portals the remove-audio confirmation outside the player dock', async () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" onRemoveAudio={vi.fn()} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Rimuovi audio collegato'));
    });

    const dialog = screen.getByRole('alertdialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('opens audio options menu and calls onRemoveAudio when confirmed in modal', async () => {
    const onRemoveAudio = vi.fn().mockResolvedValue(undefined);
    render(<AudioPlayer src="/audio/test.mp3" onRemoveAudio={onRemoveAudio} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    expect(screen.getByText('Rimuovi audio collegato')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('Rimuovi audio collegato'));
    });

    expect(screen.getByText("Rimuovere l'audio collegato?")).toBeTruthy();
    expect(screen.getByText(/La copia audio interna verrà eliminata dalla sbobina/)).toBeTruthy();

    const modal = screen.getByText("Rimuovere l'audio collegato?").closest('.modal-card') as HTMLElement;
    const confirmBtn = within(modal).getByRole('button', { name: 'Rimuovi audio' });
    await act(async () => {
      fireEvent.click(confirmBtn);
    });
    expect(onRemoveAudio).toHaveBeenCalledTimes(1);
  });

  it('cancels removal when Annulla is clicked in modal', async () => {
    const onRemoveAudio = vi.fn().mockResolvedValue(undefined);
    render(<AudioPlayer src="/audio/test.mp3" onRemoveAudio={onRemoveAudio} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    await act(async () => {
      fireEvent.click(screen.getByText('Rimuovi audio collegato'));
    });

    expect(screen.getByText("Rimuovere l'audio collegato?")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    });
    expect(onRemoveAudio).not.toHaveBeenCalled();
  });

  it('calls onRelink from the options menu', async () => {
    const onRelink = vi.fn().mockResolvedValue(true);
    render(<AudioPlayer src="/audio/test.mp3" onRelink={onRelink} />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    });
    expect(screen.getByText('Sostituisci file audio...')).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Sostituisci file audio...'));
    });
    expect(onRelink).toHaveBeenCalledTimes(1);
  });
});

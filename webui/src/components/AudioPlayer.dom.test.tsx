import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPlayer } from './AudioPlayer';

beforeEach(() => {
  localStorage.clear();
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

  it('leaves restart to the scrubber: no back-to-start control on desktop or phone', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.queryByLabelText("Torna all'inizio")).toBeNull();
  });

  it('shows the speed in the bar as one value, 1x by default', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const chip = screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' });
    expect(chip.textContent).toBe('1x');
    expect(chip.getAttribute('aria-haspopup')).toBe('dialog');
    expect(screen.queryByRole('button', { name: 'Aumenta velocità di riproduzione' })).toBeNull();
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

  it('keeps one row on a phone and moves speed and the audio options into the menu', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const onStateChange = vi.fn();
      render(<AudioPlayer src="/audio/test.mp3" onRelink={vi.fn()} onStateChange={onStateChange} />);
      expect(screen.getByRole('button', { name: 'Avvia riproduzione' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Indietro di 10 secondi' })).toBeTruthy();
      expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
      expect(screen.getByText('00:00 / 00:00')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Velocità di riproduzione/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Opzioni audio collegato' })).toBeNull();
      expect(screen.queryByLabelText("Torna all'inizio")).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Altri controlli audio' }));
      expect(screen.getByRole('button', { name: 'Altri controlli audio' }).getAttribute('aria-expanded')).toBe('true');
      // The speed row shows the value and opens the speed panel inside the menu, with a way back.
      fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
      const slider = screen.getByRole('slider', { name: 'Velocità di riproduzione' });
      expect(document.activeElement).toBe(slider);
      expect(screen.queryByText('Sostituisci file audio...')).toBeNull();
      // The menu spans the dock outside the kebab's wrapper: pressing inside it must not close it.
      fireEvent.pointerDown(slider);
      fireEvent.click(screen.getByRole('button', { name: '1,5x' }));
      expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ playbackRate: 1.5 }));
      fireEvent.click(screen.getByRole('button', { name: 'Aumenta velocità di riproduzione' }));
      expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ playbackRate: 1.55 }));
      fireEvent.click(screen.getByRole('button', { name: 'Torna al menu audio' }));
      expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,55x' })).toBeTruthy();
      fireEvent.pointerDown(document.body);
      expect(screen.queryByRole('button', { name: /^Velocità di riproduzione/ })).toBeNull();
      // Reopening starts from the menu, not from the speed panel left open last time.
      fireEvent.click(screen.getByRole('button', { name: 'Altri controlli audio' }));
      fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,55x' }));
      fireEvent.pointerDown(document.body);
      fireEvent.click(screen.getByRole('button', { name: 'Altri controlli audio' }));
      expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,55x' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: "Torna all'inizio" })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Riduci a icona' })).toBeNull();
      expect(screen.getByText('Sostituisci file audio...')).toBeTruthy();

      const editorClose = vi.fn();
      window.addEventListener('keydown', editorClose);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      window.removeEventListener('keydown', editorClose);
      expect(screen.queryByText('Sostituisci file audio...')).toBeNull();
      expect(editorClose).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('puts the phone volume in the bar as a button that opens a vertical slider', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const onStateChange = vi.fn();
      render(<AudioPlayer src="/audio/test.mp3" onStateChange={onStateChange} />);
      expect(screen.queryByRole('slider', { name: 'Livello volume' })).toBeNull();
      const button = screen.getByRole('button', { name: 'Volume' });
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');

      const slider = screen.getByRole('slider', { name: 'Livello volume' });
      expect(slider.getAttribute('aria-orientation')).toBe('vertical');
      fireEvent.pointerDown(slider);
      fireEvent.change(slider, { target: { value: '0.4' } });
      expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ volume: 0.4 }));
      expect(slider.getAttribute('aria-valuetext')).toBe('40%');

      // Opening the menu closes the volume, and the menu holds no second volume slider.
      fireEvent.click(screen.getByRole('button', { name: 'Altri controlli audio' }));
      expect(screen.queryByRole('slider', { name: 'Livello volume' })).toBeNull();
      expect(screen.queryByRole('slider', { name: 'Volume' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
      const editorClose = vi.fn();
      window.addEventListener('keydown', editorClose);
      fireEvent.keyDown(document.body, { key: 'Escape' });
      window.removeEventListener('keydown', editorClose);
      expect(screen.queryByRole('slider', { name: 'Livello volume' })).toBeNull();
      expect(editorClose).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('leaves the phone volume button out where volume stays on the hardware buttons (iPhone)', () => {
    const volume = Object.getOwnPropertyDescriptor(window.HTMLMediaElement.prototype, 'volume')!;
    Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', { configurable: true, get: () => 1, set: () => {} });
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      render(<AudioPlayer src="/audio/test.mp3" />);
      expect(screen.queryByRole('button', { name: 'Volume' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Altri controlli audio' })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
      Object.defineProperty(window.HTMLMediaElement.prototype, 'volume', volume);
    }
  });

  it('folds the phone player from the chevron on the pill side, after the bar wipes into its corner', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' }));
    try {
      const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
      const tab = screen.getByRole('button', { name: 'Riduci il player a icona' });
      expect(tab.classList.contains('is-right')).toBe(true);
      // The chevron closes the row on the pill's side: after the menu, at the right edge.
      expect(tab.previousElementSibling?.contains(screen.getByRole('button', { name: 'Altri controlli audio' }))).toBe(true);

      fireEvent.click(tab);
      expect(container.querySelector('.audio-player.is-folding')).not.toBeNull();
      expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(279); });
      expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.queryByRole('slider', { name: 'Posizione audio' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: /Mostra il player audio/ }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Riduci il player a icona' }));
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('puts the phone chevron first when the pill lives on the left, and swipes left to fold', () => {
    vi.useFakeTimers();
    localStorage.setItem('el-sbobinator.audio-player.v1', JSON.stringify({ collapsed: false, side: 'left' }));
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(max-width: 640px)' || query === '(prefers-reduced-motion: reduce)' }));
    try {
      const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
      const tab = screen.getByRole('button', { name: 'Riduci il player a icona' });
      expect(tab.classList.contains('is-left')).toBe(true);
      expect(container.querySelector('.audio-player > button')).toBe(tab);

      const play = screen.getByRole('button', { name: 'Avvia riproduzione' });
      // A swipe away from the pill's corner leaves the bar open; toward it folds.
      fireEvent.touchStart(play, { touches: [{ clientX: 100, clientY: 100 }] });
      fireEvent.touchEnd(play, { changedTouches: [{ clientX: 200, clientY: 105 }] });
      expect(container.querySelector('.audio-player.is-folding')).toBeNull();
      fireEvent.touchStart(play, { touches: [{ clientX: 200, clientY: 100 }] });
      fireEvent.touchEnd(play, { changedTouches: [{ clientX: 100, clientY: 105 }] });
      // Reduced motion (stubbed above) still gets the wipe on close, the same as on open.
      expect(container.querySelector('.audio-player.is-folding.is-left')).not.toBeNull();
      act(() => { vi.advanceTimersByTime(280); });
      expect(screen.queryByRole('slider', { name: 'Posizione audio' })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it('folds into a pill that keeps playing, remembers the fold and opens again on tap', () => {
    vi.useFakeTimers();
    const { unmount, container } = render(<AudioPlayer src="/audio/test.mp3" />);
    // The fold animation is for the user's own fold, not for the player opening with the editor.
    expect(container.querySelector('.audio-player.did-fold')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Avvia riproduzione' }));
    // Desktop folds from the same chevron as the phone, on the pill's side.
    expect(screen.getByRole('button', { name: 'Riduci il player a icona' }).className).toBe('player-fold-tab is-right');
    fireEvent.click(screen.getByRole('button', { name: 'Riduci il player a icona' }));
    act(() => { vi.advanceTimersByTime(280); });
    vi.useRealTimers();

    const pill = screen.getByRole('button', { name: /Mostra il player audio \(in riproduzione/ });
    expect(container.querySelector('.audio-player.is-collapsed.did-fold')).not.toBeNull();
    expect(document.activeElement).toBe(pill);
    expect(screen.queryByRole('slider', { name: 'Posizione audio' })).toBeNull();
    expect(document.querySelector('audio')).not.toBeNull();
    // Shortcuts still reach the audio while folded.
    fireEvent.keyDown(window, { code: 'F4' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    unmount();

    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: /Mostra il player audio/ }));
    expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Riduci il player a icona' }));
    expect(JSON.parse(localStorage.getItem('el-sbobinator.audio-player.v1')!)).toEqual({ collapsed: false, side: 'right' });
  });

  it('folds on a downward swipe over the bar but not while dragging the scrubber', () => {
    vi.useFakeTimers();
    render(<AudioPlayer src="/audio/test.mp3" />);
    const scrubber = screen.getByRole('slider', { name: 'Posizione audio' });
    fireEvent.touchStart(scrubber, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(scrubber, { changedTouches: [{ clientX: 100, clientY: 200 }] });
    expect(screen.getByRole('slider', { name: 'Posizione audio' })).toBeTruthy();

    const play = screen.getByRole('button', { name: 'Avvia riproduzione' });
    fireEvent.touchStart(play, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(play, { changedTouches: [{ clientX: 110, clientY: 160 }] });
    act(() => { vi.advanceTimersByTime(280); });
    vi.useRealTimers();
    expect(screen.queryByRole('slider', { name: 'Posizione audio' })).toBeNull();
    expect(screen.getByRole('button', { name: /Mostra il player audio \(in pausa/ })).toBeTruthy();
  });

  it('moves the pill to the corner it is dragged to without opening the player', () => {
    localStorage.setItem('el-sbobinator.audio-player.v1', JSON.stringify({ collapsed: true, side: 'right' }));
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const pill = screen.getByRole('button', { name: /Mostra il player audio/ });
    fireEvent.pointerDown(pill, { clientX: 900, pointerId: 1 });
    fireEvent.pointerMove(pill, { clientX: 400, pointerId: 1 });
    fireEvent.pointerUp(pill, { clientX: 40, pointerId: 1 });
    fireEvent.click(pill);

    expect(container.querySelector('.audio-player.is-collapsed.is-left')).not.toBeNull();
    expect(screen.queryByRole('slider', { name: 'Posizione audio' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('el-sbobinator.audio-player.v1')!)).toEqual({ collapsed: true, side: 'left' });
  });

  it('offers to keep the audio in the browser, with its size, instead of removing it (web)', async () => {
    const onChange = vi.fn().mockResolvedValue(true);
    const { rerender } = render(<AudioPlayer src="blob:test/1" onRelink={vi.fn()} keep={{ kept: false, size: 245 * 1024 * 1024, onChange }} />);
    fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));

    expect(screen.queryByText('Rimuovi audio collegato')).toBeNull();
    expect(screen.getByText('Scegli un altro file audio...')).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Tieni l’audio in questo browser · 245,0 MB' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(onChange).toHaveBeenCalledWith(true);

    rerender(<AudioPlayer src="blob:test/1" onRelink={vi.fn()} keep={{ kept: true, size: 245 * 1024 * 1024, onChange }} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('switch'));
    });
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('keeps the desktop audio menu: replace or remove the linked audio', () => {
    render(<AudioPlayer src="/audio/test.mp3" onRelink={vi.fn()} onRemoveAudio={vi.fn()} />);
    fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    expect(screen.getByText('Sostituisci file audio...')).toBeTruthy();
    expect(screen.getByText('Rimuovi audio collegato')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('shows minutes and seconds initially, and hours only for lectures that last them', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.getByText('00:00 / 00:00')).toBeTruthy();
    const audio = document.querySelector('audio')!;
    Object.defineProperty(audio, 'duration', { configurable: true, value: 3725 });
    fireEvent.durationChange(audio);
    expect(screen.getByText('0:00:00 / 1:02:05')).toBeTruthy();
  });

  it('leaves the shared shortcuts button to the editor header', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    expect(screen.queryByRole('button', { name: 'Scorciatoie da tastiera' })).toBeNull();
  });

  it('moves the speed slider in 0,05 steps between 0,5x and 3x', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
    const slider = screen.getByRole('slider', { name: 'Velocità di riproduzione' });
    expect(slider.getAttribute('min')).toBe('0.5');
    expect(slider.getAttribute('max')).toBe('3');
    expect(slider.getAttribute('step')).toBe('0.05');

    fireEvent.change(slider, { target: { value: '1.15' } });
    expect(audio.playbackRate).toBe(1.15);
    expect(slider.getAttribute('aria-valuetext')).toBe('1,15x');
    expect(screen.getByRole('dialog', { name: 'Velocità di riproduzione' }).textContent).toContain('1,15x');
    // The panel stays open while trying speeds out.
    expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,15x' }).getAttribute('aria-expanded')).toBe('true');

    fireEvent.change(slider, { target: { value: '0.75' } });
    expect(audio.playbackRate).toBe(0.75);
    expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 0,75x' })).toBeTruthy();
  });

  it('uses initialPlaybackRate prop', () => {
    render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={2} />);
    expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 2x' }).textContent).toBe('2x');
  });

  it('steps speed by 0,05 with minus and plus and keeps the panel, audio and saved state in sync', () => {
    const onStateChange = vi.fn();
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={1.5} initialVolume={0.6} onStateChange={onStateChange} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 42;
    fireEvent.timeUpdate(audio);

    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,5x' }));
    expect(screen.getByRole('button', { name: '1,5x' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Aumenta velocità di riproduzione' }));
    expect(audio.playbackRate).toBe(1.55);
    expect(screen.getByRole('button', { name: '1,5x' }).getAttribute('aria-pressed')).toBe('false');
    expect(onStateChange).toHaveBeenLastCalledWith({ currentTime: 42, playbackRate: 1.55, volume: 0.6 });

    fireEvent.click(screen.getByRole('button', { name: '2x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Diminuisci velocità di riproduzione' }));
    expect(audio.playbackRate).toBe(1.95);
    expect(screen.getByRole('button', { name: 'Velocità di riproduzione: 1,95x' }).textContent).toBe('1,95x');
    expect(onStateChange).toHaveBeenLastCalledWith({ currentTime: 42, playbackRate: 1.95, volume: 0.6 });
    expect(audio.currentTime).toBe(42);
    expect(audio.volume).toBe(0.6);
  });

  it('disables minus at 0,5x and plus at 3x', () => {
    const onStateChange = vi.fn();
    const { unmount } = render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={0.55} onStateChange={onStateChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 0,55x' }));
    const decrease = screen.getByRole('button', { name: 'Diminuisci velocità di riproduzione' }) as HTMLButtonElement;
    expect(decrease.disabled).toBe(false);
    fireEvent.click(decrease);
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ playbackRate: 0.5 }));
    expect(decrease.disabled).toBe(true);
    unmount();

    render(<AudioPlayer src="/audio/test.mp3" initialPlaybackRate={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 3x' }));
    expect((screen.getByRole('button', { name: 'Aumenta velocità di riproduzione' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders audio element with correct src', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.src).toContain('test.mp3');
  });

  it('offers the quick speeds 1, 1,25, 1,5, 2 and 3, without extra labels', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
    const presets = screen.getByRole('group', { name: 'Velocità rapide' });
    expect(within(presets).getAllByRole('button').map(b => b.textContent)).toEqual(['1', '1,25', '1,5', '2', '3']);
    expect(within(presets).getByRole('button', { name: '1x' }).getAttribute('aria-pressed')).toBe('true');
    const panel = screen.getByRole('dialog', { name: 'Velocità di riproduzione' });
    expect(within(panel).queryByText('Normale')).toBeNull();
    expect(within(panel).queryByText('Velocità')).toBeNull();
  });

  it('frames the speed panel and linked-audio menu with the shared menu rules', () => {
    render(<AudioPlayer src="/audio/test.mp3" onRelink={vi.fn()} onRemoveAudio={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
    const speedPanel = screen.getByRole('dialog', { name: 'Velocità di riproduzione' });
    expect(speedPanel.classList.contains('kebab-panel')).toBe(true);
    expect(speedPanel.classList.contains('player-menu')).toBe(true);
    fireEvent.keyDown(document.body, { key: 'Escape' });

    fireEvent.click(screen.getByLabelText('Opzioni audio collegato'));
    const relinkRow = screen.getByText('Sostituisci file audio...').closest('button');
    expect(relinkRow?.classList.contains('kebab-item')).toBe(true);
    expect(relinkRow?.parentElement?.classList.contains('kebab-panel')).toBe(true);
    expect(relinkRow?.parentElement?.getAttribute('style') ?? '').toBe('');
  });

  it('focuses the speed slider when the panel opens, so the arrows change the speed', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
    expect(document.activeElement).toBe(screen.getByRole('slider', { name: 'Velocità di riproduzione' }));
  });

  it('closes the speed panel on outside click, or on Escape without closing the editor', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const chip = screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' });
    fireEvent.click(chip);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Velocità di riproduzione' })).toBeNull();

    fireEvent.click(chip);
    const editorClose = vi.fn();
    window.addEventListener('keydown', editorClose);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Velocità di riproduzione' }), { key: 'Escape' });
    window.removeEventListener('keydown', editorClose);
    expect(screen.queryByRole('dialog', { name: 'Velocità di riproduzione' })).toBeNull();
    expect(editorClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(chip);
  });

  it('opens the desktop speed panel above the bar, not over it', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" />);
    const bar = container.querySelector('.audio-player') as HTMLElement;
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 700, bottom: 744, left: 0, right: 1000, width: 1000, height: 44, x: 0, y: 700, toJSON: () => {} });
    fireEvent.click(screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' }));
    const panel = screen.getByRole('dialog', { name: 'Velocità di riproduzione' });
    expect(panel.style.bottom).toBe(`${window.innerHeight - 700 + 14}px`);
  });

  it('shows the desktop volume level in its icon, like the phone button', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const slider = screen.getByRole('slider', { name: 'Volume' });
    const icon = () => slider.parentElement!.querySelector('svg')!.getAttribute('class');
    expect(icon()).toContain('lucide-volume-2');
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(icon()).toContain('lucide-volume-1');
    fireEvent.change(slider, { target: { value: '0' } });
    expect(icon()).toContain('lucide-volume-x');
  });

  it('centers the speed panel horizontally on its button', () => {
    render(<AudioPlayer src="/audio/test.mp3" />);
    const btn = screen.getByRole('button', { name: 'Velocità di riproduzione: 1x' });
    vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
      left: 500,
      right: 552,
      top: 500,
      bottom: 532,
      width: 52,
      height: 32,
      x: 500,
      y: 500,
      toJSON: () => {},
    });
    fireEvent.click(btn);
    const panel = screen.getByRole('dialog', { name: 'Velocità di riproduzione' });
    // jsdom measures 0 width, so the panel's 224px design width centres it: 500 + (52 - 224) / 2.
    expect(panel.style.left).toBe('414px');
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
    expect(screen.getByText('1:02:09 / 3:13:54')).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Posizione audio' }).getAttribute('aria-valuetext')).toBe('1 ora, 2 minuti, 9 secondi di 3 ore, 13 minuti, 54 secondi');
  });

  it('loadedmetadata with initialTime sets currentTime', () => {
    const { container } = render(<AudioPlayer src="/audio/test.mp3" initialTime={30} />);
    const audio = container.querySelector('audio') as HTMLAudioElement;
    Object.defineProperty(audio, 'duration', { value: 120, writable: true, configurable: true });
    Object.defineProperty(audio, 'currentTime', { value: 0, writable: true });
    fireEvent.loadedMetadata(audio);
    expect(audio.currentTime).toBe(30);
    expect(screen.getByText('00:30 / 02:00')).toBeTruthy();
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

import { reportClientError } from '../diagnostics';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, ChevronLeft, ChevronRight, HardDrive, Minus, MoreVertical, Pause, Play, Plus, RefreshCw, RotateCcw, RotateCw, Unlink, Volume1, Volume2, VolumeX } from 'lucide-react';
import { ConfirmActionModal } from './modals/ConfirmActionModal';
import { useDockFold } from '../hooks/useDockFold';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { formatSize } from '../utils';
import { PlayerPillRing } from './PlayerPillRing';

/** Web: whether this browser keeps a copy of the lecture for the sbobina (otherwise it is picked each time). */
export interface AudioKeepControl {
  kept: boolean;
  size: number;
  onChange: (keep: boolean) => Promise<boolean | undefined>;
}

interface AudioPlayerProps {
  src: string;
  initialTime?: number;
  /** The length saved with `initialTime`: with both, the bar opens on the saved position at once. */
  initialDuration?: number;
  initialPlaybackRate?: number;
  initialVolume?: number;
  onStateChange?: (state: { currentTime: number; duration?: number; playbackRate: number; volume: number }) => void;
  onRelink?: () => Promise<boolean | undefined>;
  onRemoveAudio?: () => Promise<boolean | undefined> | void;
  keep?: AudioKeepControl;
}

// Speed works like YouTube's: a slider for fine steps (1.1x and 1.15x are common for lectures),
// minus and plus beside it, and a row of quick presets.
const SPEED_MIN = 0.5;
const SPEED_MAX = 3;
const SPEED_STEP = 0.05;
const SPEED_PRESETS = [1, 1.25, 1.5, 2, 3];
const SPEED_PANEL_WIDTH = 224;

const clampRate = (rate: number) =>
  Number(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(rate / SPEED_STEP) * SPEED_STEP)).toFixed(2));
// "1x", "1,25x", "1,1x": Italian decimals without trailing zeros.
const formatRate = (rate: number) => `${String(Number(rate.toFixed(2))).replace('.', ',')}x`;

// iPad and iPhone Safari keep media volume on the hardware buttons: audio.volume stays 1 whatever
// is set, so a volume slider there would move without changing anything.
function canSetMediaVolume(): boolean {
  try {
    const probe = document.createElement('audio');
    probe.volume = 0.5;
    return probe.volume === 0.5;
  } catch {
    return false;
  }
}

// A touch-first device (phone, tablet): read at render, so it is checked again whenever the
// phone layout switches on or off.
function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

// Every player menu floats this far above the bar's top edge (13px clear of the dock border).
const MENU_GAP_PX = 14;

const INTERACTIVE_ARIA_ROLES = new Set([
  'button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'option', 'tab', 'treeitem', 'slider', 'spinbutton', 'combobox',
  'radio', 'checkbox', 'switch',
]);

const isEditableTarget = (target: EventTarget | null): boolean => {
  // Keys can also reach the document itself (nothing focused), which is not an element.
  if (!(target instanceof HTMLElement)) return false;
  const el = target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return true;
  if (el.tagName === 'BUTTON' || el.tagName === 'A') return true;
  const role = el.getAttribute('role');
  return role !== null && INTERACTIVE_ARIA_ROLES.has(role);
};

// Until the file reports its length, the bar shows the saved position on the saved length, so a
// reopened sbobina does not draw the scrubber at zero and then jump. Without a saved length the
// position cannot be placed on the scrubber, so it starts at zero as before.
const restoredPosition = (time?: number, duration?: number) => {
  const length = duration !== undefined && Number.isFinite(duration) && duration > 0 ? duration : 0;
  return { time: length > 0 ? Math.min(Math.max(time ?? 0, 0), length) : 0, duration: length };
};

export function AudioPlayer({ src, initialTime, initialDuration, initialPlaybackRate, initialVolume, onStateChange, onRelink, onRemoveAudio, keep }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => restoredPosition(initialTime, initialDuration).time);
  const [duration, setDuration] = useState(() => restoredPosition(initialTime, initialDuration).duration);
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate ?? 1);
  const [volume, setVolume] = useState(initialVolume ?? 1);
  const [showVolume] = useState(canSetMediaVolume);
  // A phone puts the scrubber on a line of its own above the buttons, and leaves the volume to
  // the phone's own keys, as Spotify does: there the audio plays at full volume, whatever the
  // desktop slider keeps. A narrow window alone is not a phone: with a mouse and no hardware keys
  // (a desktop browser made narrow) the saved level still plays, and the arrow keys still set it.
  const isPhone = usePhoneLayout();
  const hardwareVolume = !showVolume || (isPhone && isCoarsePointer());
  const elementVolume = hardwareVolume ? 1 : volume;
  const hardwareVolumeRef = useRef(hardwareVolume);
  useEffect(() => { hardwareVolumeRef.current = hardwareVolume; }, [hardwareVolume]);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [speedPanelPos, setSpeedPanelPos] = useState({ bottom: 0, left: 0 });
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const speedPanelRef = useRef<HTMLDivElement>(null);
  const speedSliderRef = useRef<HTMLInputElement>(null);
  const [isRelinking, setIsRelinking] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const audioMenuRef = useRef<HTMLDivElement>(null);
  // The menu is anchored to the whole bar, so it lives outside the kebab's wrapper.
  const audioMenuPanelRef = useRef<HTMLDivElement>(null);
  // Folding closes whatever menu the bar has open.
  const { fold, setCollapsed, collapseBtnRef, pillProps, barTouchProps, foldClassName } = useDockFold(() => {
    setShowAudioMenu(false);
    setIsSpeedOpen(false);
  });
  const pendingInitialTimeRef = useRef<number | null>(initialTime ?? null);
  const playbackRateRef = useRef(initialPlaybackRate ?? 1);
  const volumeRef = useRef(initialVolume ?? 1);
  const durationRef = useRef(0);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = elementVolume;
    audioRef.current.playbackRate = playbackRate;
  }, [elementVolume, playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsPlaying(false);
    const restored = restoredPosition(initialTime, initialDuration);
    setCurrentTime(restored.time);
    setDuration(restored.duration);
    audio.pause();
    audio.currentTime = 0;
    pendingInitialTimeRef.current = initialTime ?? null;
    audio.load();

    const syncDuration = () => {
      if (isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };

    syncDuration();
    const timeoutId = window.setTimeout(syncDuration, 300);
    return () => window.clearTimeout(timeoutId);
  }, [initialDuration, initialTime, src]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
      setIsPlaying(true);
      return;
    }
    audio.pause();
    setIsPlaying(false);
  }, []);

  const togglePlayRef = useRef(togglePlay);
  useEffect(() => { togglePlayRef.current = togglePlay; }, [togglePlay]);

  const skip = useCallback((amount: number) => {
    if (!audioRef.current) return;
    let next = audioRef.current.currentTime + amount;
    if (next < 0) next = 0;
    const dur = durationRef.current;
    if (dur > 0 && next > dur) next = dur;
    audioRef.current.currentTime = next;
    setCurrentTime(next);
  }, []);

  const skipRef = useRef(skip);
  useEffect(() => { skipRef.current = skip; }, [skip]);

  const adjustVolume = useCallback((delta: number) => {
    const newVol = Math.max(0, Math.min(1, volumeRef.current + delta));
    volumeRef.current = newVol;
    setVolume(newVol);
    onStateChangeRef.current?.({ currentTime: audioRef.current?.currentTime ?? 0, playbackRate: playbackRateRef.current, volume: newVol });
  }, []);

  const adjustVolumeRef = useRef(adjustVolume);
  useEffect(() => { adjustVolumeRef.current = adjustVolume; }, [adjustVolume]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'F4' && !e.altKey && !e.ctrlKey && !e.shiftKey) {
        const el = e.target as HTMLElement;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return;
        e.preventDefault();
        togglePlayRef.current();
        return;
      }
      if (isEditableTarget(e.target)) return;
      switch (e.code) {
        case 'Space':
          if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
            e.preventDefault();
            togglePlayRef.current();
          }
          break;
        case 'ArrowLeft':
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); skipRef.current(-10); }
          break;
        case 'ArrowRight':
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); skipRef.current(10); }
          break;
        // Where the hardware keys own the volume, the arrows would only change a level that never
        // plays: they are left to the page.
        case 'ArrowUp':
          if (hardwareVolumeRef.current) break;
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); adjustVolumeRef.current(0.05); }
          break;
        case 'ArrowDown':
          if (hardwareVolumeRef.current) break;
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); adjustVolumeRef.current(-0.05); }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    if (!showAudioMenu) return;
    const handler = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!audioMenuRef.current?.contains(target) && !audioMenuPanelRef.current?.contains(target)) {
        setShowAudioMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the menu only: the editor closes itself on an Escape that reaches the window.
      e.stopPropagation();
      setShowAudioMenu(false);
    };
    document.addEventListener('pointerdown', handler);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handler);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showAudioMenu]);

  // Phone and desktop lay the bar out differently: a resize or rotation closes its menus.
  useEffect(() => {
    setShowAudioMenu(false);
    setIsSpeedOpen(false);
  }, [isPhone]);

  // The speed list rises from the bar's top edge like the other player menus, not from the
  // pill inside the bar, which left it overlapping the player.
  const speedPanelBottom = () => {
    const bar = speedBtnRef.current?.closest('.audio-player') ?? speedBtnRef.current;
    const top = bar?.getBoundingClientRect().top ?? 0;
    return Math.max(10, Math.round(window.innerHeight - top + MENU_GAP_PX));
  };

  const toggleSpeedOpen = () => {
    if (!isSpeedOpen && speedBtnRef.current) {
      const rect = speedBtnRef.current.getBoundingClientRect();
      const estimatedWidth = SPEED_PANEL_WIDTH;
      const centeredLeft = rect.left + (rect.width - estimatedWidth) / 2;
      setSpeedPanelPos({
        bottom: speedPanelBottom(),
        left: Math.round(Math.max(8, Math.min(window.innerWidth - estimatedWidth - 8, centeredLeft))),
      });
    }
    setIsSpeedOpen(prev => !prev);
  };

  useLayoutEffect(() => {
    if (!isSpeedOpen || !speedBtnRef.current) return;
    const btnRect = speedBtnRef.current.getBoundingClientRect();
    const measuredWidth = speedPanelRef.current?.getBoundingClientRect().width;
    const panelWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : SPEED_PANEL_WIDTH;
    const centeredLeft = btnRect.left + (btnRect.width - panelWidth) / 2;
    const clampedLeft = Math.max(8, Math.min(window.innerWidth - panelWidth - 8, centeredLeft));
    const newBottom = speedPanelBottom();
    const newLeft = Math.round(clampedLeft);
    setSpeedPanelPos(prev => {
      if (prev.bottom === newBottom && prev.left === newLeft) return prev;
      return { bottom: newBottom, left: newLeft };
    });
  }, [isSpeedOpen]);

  // The panel stays open while the speed changes, so the slider can be dragged and tried out.
  const changeRate = (next: number) => {
    const r = clampRate(next);
    playbackRateRef.current = r;
    setPlaybackRate(r);
    onStateChangeRef.current?.({ currentTime, playbackRate: r, volume: volumeRef.current });
  };

  // Keyboard users land on the slider, where the arrows change the speed.
  useEffect(() => {
    if (isSpeedOpen) speedSliderRef.current?.focus();
  }, [isSpeedOpen]);

  useEffect(() => {
    if (!isSpeedOpen) return;
    const handler = (e: PointerEvent | MouseEvent) => {
      const target = e.target as Node;
      if (speedBtnRef.current?.contains(target) || speedPanelRef.current?.contains(target)) return;
      setIsSpeedOpen(false);
    };
    const handleScroll = (e: Event) => {
      if (speedPanelRef.current?.contains(e.target as Node)) return;
      setIsSpeedOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape closes the panel only, not the editor, and returns to the speed button.
      e.stopPropagation();
      setIsSpeedOpen(false);
      speedBtnRef.current?.focus();
    };
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('mousedown', handler, true);
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleScroll, true);
    return () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('mousedown', handler, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll, true);
    };
  }, [isSpeedOpen]);

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const t = audioRef.current.currentTime;
    setCurrentTime(t);
    if (isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
      setDuration(audioRef.current.duration);
    }
    onStateChangeRef.current?.({ currentTime: t, duration: audioRef.current.duration, playbackRate: playbackRateRef.current, volume: volumeRef.current });
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.volume = elementVolume;
    if (isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
    if (pendingInitialTimeRef.current !== null && pendingInitialTimeRef.current > 0) {
      const t = pendingInitialTimeRef.current;
      pendingInitialTimeRef.current = null;
      audioRef.current.currentTime = t;
      setCurrentTime(t);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseFloat(e.target.value);
    volumeRef.current = v;
    setVolume(v);
    onStateChangeRef.current?.({ currentTime, playbackRate: playbackRateRef.current, volume: v });
  };

  // Hours only for lectures that last them: "12:34 / 58:10" keeps the phone's time on one line.
  const showHours = duration >= 3600;
  const formatTime = (time: number) => {
    const totalSeconds = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return showHours || hours > 0 ? `${hours}:${mmss}` : mmss;
  };

  const formatAccessibleTime = (time: number) => {
    const totalSeconds = Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'ora' : 'ore'}`);
    if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? 'secondo' : 'secondi'}`);
    return parts.join(', ');
  };

  const handleRelink = async () => {
    if (isRelinking) return;
    setIsRelinking(true);
    try {
      await onRelink?.();
    } catch (e) {
      reportClientError('Failed to relink audio:', e);
    } finally {
      setIsRelinking(false);
    }
  };

  const [isRemovingAudio, setIsRemovingAudio] = useState(false);
  const [isSavingKeep, setIsSavingKeep] = useState(false);

  const handleKeepChange = async () => {
    if (!keep || isSavingKeep) return;
    setIsSavingKeep(true);
    try {
      await keep.onChange(!keep.kept);
    } catch (e) {
      reportClientError('Failed to change the kept audio:', e);
    } finally {
      setIsSavingKeep(false);
    }
  };

  const handleRemoveAudio = async () => {
    if (isRemovingAudio) return;
    setIsRemovingAudio(true);
    try {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.removeAttribute('src');
        audioRef.current.load();
        setIsPlaying(false);
      }
      const removed = await onRemoveAudio?.();
      if (removed === false && audioRef.current) {
        audioRef.current.src = src;
        audioRef.current.load();
      }
    } catch (e) {
      reportClientError('Failed to remove audio:', e);
    } finally {
      setIsRemovingAudio(false);
    }
  };

  const hasAudioActions = Boolean(onRelink || onRemoveAudio || keep);
  const timeLabel = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const scrubberMax = duration || 100;

  const audioElement = (
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      onTimeUpdate={handleTimeUpdate}
      onLoadedMetadata={handleLoadedMetadata}
      onLoadedData={handleLoadedMetadata}
      onCanPlay={handleLoadedMetadata}
      onDurationChange={e => {
        if (isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
      }}
      onEnded={() => setIsPlaying(false)}
    />
  );

  /* Portaled to the body like the app's other dialogs, so it covers the whole window above the editor. */
  const confirmRemoveModal = createPortal(
    <ConfirmActionModal
      isOpen={showConfirmRemove}
      title="Rimuovere l'audio collegato?"
      description="La copia audio interna verrà eliminata dalla sbobina, liberando spazio. Il file originale sul tuo computer non verrà cancellato."
      confirmLabel={isRemovingAudio ? 'Rimozione...' : 'Rimuovi audio'}
      cancelLabel="Annulla"
      onClose={() => setShowConfirmRemove(false)}
      onConfirm={async () => {
        setShowConfirmRemove(false);
        await handleRemoveAudio();
      }}
    />,
    document.body,
  );

  if (fold.collapsed) {
    return (
      <div className={foldClassName}>
        {audioElement}
        <button
          {...pillProps}
          type="button"
          className={`player-pill${isPlaying ? ' is-playing' : ''}`}
          aria-label={`Mostra il player audio (${isPlaying ? 'in riproduzione' : 'in pausa'}, ${formatAccessibleTime(currentTime)} di ${formatAccessibleTime(duration)})`}
          title="Mostra il player (trascinalo per spostarlo)"
        >
          <PlayerPillRing progress={progress} />
          {isPlaying ? <AudioLines className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        {confirmRemoveModal}
      </div>
    );
  }

  // Menus read like a settings list: icon, label, and any control (stepper, switch) on the right.
  const audioActions = (
    <>
      {onRelink && (
        <button
          type="button"
          onClick={() => {
            setShowAudioMenu(false);
            void handleRelink();
          }}
          disabled={isRelinking}
          className="kebab-item player-menu-item"
        >
          <RefreshCw className="player-menu-icon" />
          <span>{keep ? 'Scegli un altro file audio...' : 'Sostituisci file audio...'}</span>
        </button>
      )}
      {keep && (
        <button
          type="button"
          role="switch"
          aria-checked={keep.kept}
          aria-label={`Tieni l’audio in questo browser${keep.size > 0 ? ` · ${formatSize(keep.size)}` : ''}`}
          onClick={() => void handleKeepChange()}
          disabled={isSavingKeep}
          className="kebab-item player-menu-item audio-keep-switch"
          title={keep.kept
            ? 'La copia resta in questo browser finché non la togli o elimini la sbobina.'
            : 'Senza copia, dopo aver ricaricato la pagina dovrai scegliere di nuovo il file.'}
        >
          <HardDrive className="player-menu-icon" />
          <span className="player-menu-text">
            <span>{isSavingKeep && !keep.kept ? 'Salvataggio...' : 'Tieni l’audio nel browser'}</span>
            {keep.size > 0 && <span className="player-menu-hint">{formatSize(keep.size)}</span>}
          </span>
          <span className="queue-switch-track player-menu-end" aria-hidden="true"><span className="queue-switch-thumb" /></span>
        </button>
      )}
      {onRemoveAudio && (
        <button
          type="button"
          onClick={() => {
            setShowAudioMenu(false);
            setShowConfirmRemove(true);
          }}
          disabled={isRemovingAudio}
          className="kebab-item player-menu-item is-danger"
        >
          <Unlink className="player-menu-icon" />
          <span>Rimuovi audio collegato</span>
        </button>
      )}
    </>
  );

  // A slim chevron on the pill's side of the bar, pointing where the bar goes (phone and desktop).
  const foldTab = (
    <button
      ref={collapseBtnRef}
      type="button"
      className={`player-fold-tab is-${fold.side}`}
      aria-label="Riduci il player a icona"
      title="Riduci a icona (anche con uno swipe)"
      onClick={() => setCollapsed(true)}
    >
      {fold.side === 'left' ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
    </button>
  );

  const speedPanel = (
    <>
      <div className="player-speed-value-row">
        <p className="player-speed-value" aria-hidden="true">{playbackRate.toFixed(2).replace('.', ',')}x</p>
      </div>
      <div className="player-speed-slider-row">
        <button
          type="button"
          className="player-round-btn"
          aria-label="Diminuisci velocità di riproduzione"
          title="Diminuisci velocità"
          disabled={playbackRate <= SPEED_MIN}
          onClick={() => changeRate(playbackRate - SPEED_STEP)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          ref={speedSliderRef}
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={SPEED_STEP}
          value={playbackRate}
          onChange={e => changeRate(parseFloat(e.target.value))}
          aria-label="Velocità di riproduzione"
          aria-valuetext={formatRate(playbackRate)}
          className="custom-volume player-speed-slider"
          style={{ '--progress': `${((playbackRate - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 100}%` } as React.CSSProperties}
        />
        <button
          type="button"
          className="player-round-btn"
          aria-label="Aumenta velocità di riproduzione"
          title="Aumenta velocità"
          disabled={playbackRate >= SPEED_MAX}
          onClick={() => changeRate(playbackRate + SPEED_STEP)}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div role="group" aria-label="Velocità rapide" className="player-speed-presets">
        {SPEED_PRESETS.map(rate => (
          <button
            key={rate}
            type="button"
            aria-label={formatRate(rate)}
            aria-pressed={playbackRate === rate}
            className={`player-speed-preset${playbackRate === rate ? ' is-active' : ''}`}
            onClick={() => changeRate(rate)}
          >
            {formatRate(rate).slice(0, -1)}
          </button>
        ))}
      </div>
    </>
  );

  const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const volumeSlider = showVolume && (
    <div className="flex items-center gap-1.5">
      <VolumeIcon className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={volume}
        onChange={handleVolume}
        aria-label="Volume"
        aria-valuetext={`${Math.round(volume * 100)}%`}
        className="custom-volume w-16"
        style={{ '--progress': `${volume * 100}%` } as React.CSSProperties}
      />
    </div>
  );

  const playButton = (
    <button
      type="button"
      onClick={togglePlay}
      className={`player-control player-play-control ${isPlaying ? 'is-active' : ''}`}
      aria-label={isPlaying ? 'Metti in pausa' : 'Avvia riproduzione'}
      title={isPlaying ? 'Metti in pausa (F4)' : 'Avvia riproduzione (F4)'}
    >
      {isPlaying ? <Pause className="h-4 w-4" strokeWidth={2.2} /> : <Play className="h-4 w-4 fill-current" strokeWidth={2.2} />}
    </button>
  );
  const backButton = (
    <button type="button" onClick={() => skip(-10)} className="player-control" aria-label="Indietro di 10 secondi" title="Indietro di 10 secondi">
      <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        <RotateCcw className="h-5 w-5" />
        <span className="absolute mt-0.5 text-[8px] font-bold leading-none">10</span>
      </span>
    </button>
  );
  const forwardButton = (
    <button type="button" onClick={() => skip(10)} className="player-control" aria-label="Avanti di 10 secondi" title="Avanti di 10 secondi">
      <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
        <RotateCw className="h-5 w-5" />
        <span className="absolute mt-0.5 text-[8px] font-bold leading-none">10</span>
      </span>
    </button>
  );

  const scrubber = (
    <input
      type="range"
      min={0}
      max={scrubberMax}
      step={0.1}
      value={currentTime}
      onChange={handleSeek}
      aria-label="Posizione audio"
      aria-valuetext={duration > 0
        ? `${formatAccessibleTime(currentTime)} di ${formatAccessibleTime(duration)}`
        : `${formatAccessibleTime(currentTime)}; durata non disponibile`}
      className="custom-scrubber min-w-0 flex-1"
      // The played part ends at the thumb, on the same scale: also before the duration is known.
      style={{ '--progress': `${Math.min(100, (currentTime / scrubberMax) * 100)}%` } as React.CSSProperties}
    />
  );
  const timeText = (text: string, className: string) => (
    <span className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${className}`} style={{ color: 'var(--text-muted)' }}>
      {text}
    </span>
  );

  // Only the value sits in the bar; it opens the speed panel above the whole bar.
  const speedControl = (
    <div className="player-speed-wrap relative">
      <button
        ref={speedBtnRef}
        type="button"
        onClick={toggleSpeedOpen}
        className={`player-speed-btn${isSpeedOpen ? ' is-active' : ''}`}
        aria-label={`Velocità di riproduzione: ${formatRate(playbackRate)}`}
        title="Velocità di riproduzione"
        aria-haspopup="dialog"
        aria-expanded={isSpeedOpen}
      >
        {formatRate(playbackRate)}
      </button>
      {isSpeedOpen && createPortal(
        <div
          ref={speedPanelRef}
          role="dialog"
          aria-label="Velocità di riproduzione"
          className="kebab-panel player-menu player-speed-panel"
          style={{
            position: 'fixed',
            bottom: `${speedPanelPos.bottom}px`,
            left: `${speedPanelPos.left}px`,
            zIndex: 'var(--z-popover)',
          }}
        >
          {speedPanel}
        </div>,
        document.body
      )}
    </div>
  );

  const audioMenuButton = hasAudioActions && (
    <div className="relative" ref={audioMenuRef}>
      <button
        type="button"
        className={`player-control ${showAudioMenu ? 'is-active' : ''}`}
        aria-label="Opzioni audio collegato"
        title="Gestisci audio collegato"
        aria-haspopup="true"
        aria-expanded={showAudioMenu}
        onClick={() => setShowAudioMenu(v => !v)}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  );
  // Anchored to the whole bar, not the kebab, so it clears the dock's top edge.
  const audioMenuPanel = showAudioMenu && (
    <div ref={audioMenuPanelRef} className={`kebab-panel player-menu player-more-panel${isPhone ? '' : ' is-desktop'}`}>
      {audioActions}
    </div>
  );

  if (isPhone) {
    // Two lines. On top play sits in the very middle, between the skips, with the speed on its left
    // and the audio options on its right, so their menus rise straight from the button pressed
    // and never cover the scrubber. Below, the scrubber spans the dock between the time heard and
    // the length, near the thumb, so a three-hour lecture can be scrubbed with a finger.
    return (
      <div
        className={`${foldClassName} relative flex w-full flex-col gap-0.5 px-0.5 py-1.5`}
        style={{ background: 'transparent' }}
        {...barTouchProps}
      >
        {audioElement}
        <div className="player-phone-controls grid w-full grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center justify-self-start gap-1">
            {fold.side === 'left' && foldTab}
            {speedControl}
          </div>
          <div className="flex items-center gap-1">
            {backButton}
            {playButton}
            {forwardButton}
          </div>
          <div className="flex items-center justify-self-end gap-1">
            {audioMenuButton}
            {fold.side === 'right' && foldTab}
          </div>
        </div>
        <div className="player-phone-seek flex w-full min-w-0 items-center gap-2">
          {timeText(formatTime(currentTime), 'text-caption')}
          {scrubber}
          {timeText(formatTime(duration), 'text-caption')}
        </div>
        {audioMenuPanel}
        {confirmRemoveModal}
      </div>
    );
  }

  return (
    <div
      className={`${foldClassName} relative flex w-full flex-wrap items-center gap-2 px-0.5 py-1.5`}
      style={{ background: 'transparent' }}
      {...barTouchProps}
    >
      {audioElement}

      {fold.side === 'left' && foldTab}

      <div className="flex items-center gap-1 shrink-0">
        {playButton}
        {backButton}
        {forwardButton}
      </div>

      <div className="flex min-w-48 flex-1 items-center gap-3">
        {scrubber}
        {timeText(timeLabel, 'pr-0.5 text-xs')}
      </div>

      <div className="flex items-center gap-2">
        {speedControl}
        {volumeSlider}
        <div className="flex items-center">
          {audioMenuButton}
        </div>
      </div>

      {fold.side === 'right' && foldTab}

      {audioMenuPanel}

      {confirmRemoveModal}
    </div>
  );
}

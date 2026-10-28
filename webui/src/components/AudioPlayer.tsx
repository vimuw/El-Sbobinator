import { reportClientError } from '../diagnostics';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AudioLines, ChevronLeft, ChevronRight, Gauge, HardDrive, Minus, MoreVertical, Pause, Play, Plus, RefreshCw, RotateCcw, RotateCw, Unlink, Volume1, Volume2, VolumeX } from 'lucide-react';
import { ConfirmActionModal } from './modals/ConfirmActionModal';
import { usePhoneLayout } from '../hooks/usePhoneLayout';
import { formatSize } from '../utils';

/** Web: whether this browser keeps a copy of the lecture for the sbobina (otherwise it is picked each time). */
export interface AudioKeepControl {
  kept: boolean;
  size: number;
  onChange: (keep: boolean) => Promise<boolean | undefined>;
}

interface AudioPlayerProps {
  src: string;
  initialTime?: number;
  initialPlaybackRate?: number;
  initialVolume?: number;
  onStateChange?: (state: { currentTime: number; playbackRate: number; volume: number }) => void;
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

// Folded into a round button that sits in a bottom corner, so the player can leave the text alone.
type PillSide = 'left' | 'right';
interface FoldState { collapsed: boolean; side: PillSide }
const FOLD_STORAGE_KEY = 'el-sbobinator.audio-player.v1';

function readFoldState(): FoldState {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLD_STORAGE_KEY) ?? '{}') as Partial<FoldState>;
    return { collapsed: saved.collapsed === true, side: saved.side === 'left' ? 'left' : 'right' };
  } catch {
    return { collapsed: false, side: 'right' };
  }
}

function saveFoldState(state: FoldState): void {
  try {
    localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private windows may refuse storage: the player still folds, it just opens unfolded next time.
  }
}

const SWIPE_MIN_PX = 40;
// Every player menu floats this far above the bar's top edge (13px clear of the dock border).
const MENU_GAP_PX = 14;
// Folding first wipes the bar into its corner (index.css, player-dock-close-*), then shows the pill.
// The wipe runs even with reduced motion: it is short, only follows the user's own fold, and
// skipping it on close alone made the two directions look different.
const FOLD_WIPE_MS = 280;
const DRAG_MIN_PX = 8;
const PILL_RING_RADIUS = 19;
const PILL_RING_LENGTH = 2 * Math.PI * PILL_RING_RADIUS;

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

export function AudioPlayer({ src, initialTime, initialPlaybackRate, initialVolume, onStateChange, onRelink, onRemoveAudio, keep }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(initialPlaybackRate ?? 1);
  const [volume, setVolume] = useState(initialVolume ?? 1);
  const [showVolume] = useState(canSetMediaVolume);
  // A phone keeps one row over the text: speed, restart and the audio options move into the menu.
  const isPhone = usePhoneLayout();
  const [fold, setFold] = useState(readFoldState);
  const pillRef = useRef<HTMLButtonElement>(null);
  const collapseBtnRef = useRef<HTMLButtonElement>(null);
  const focusAfterFoldRef = useRef(false);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const pillDragRef = useRef<{ x: number; moved: boolean } | null>(null);
  const [pillOffset, setPillOffset] = useState(0);
  const [isSpeedOpen, setIsSpeedOpen] = useState(false);
  const [speedPanelPos, setSpeedPanelPos] = useState({ bottom: 0, left: 0 });
  const speedBtnRef = useRef<HTMLButtonElement>(null);
  const speedPanelRef = useRef<HTMLDivElement>(null);
  const speedSliderRef = useRef<HTMLInputElement>(null);
  // Phone: the ⋮ menu swaps its list for the speed panel, with a back arrow.
  const [menuView, setMenuView] = useState<'main' | 'speed'>('main');
  const [isRelinking, setIsRelinking] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  // Phone: the volume sits in the bar as an icon that opens a vertical slider above it.
  const [showVolumePopover, setShowVolumePopover] = useState(false);
  const volumePopoverRef = useRef<HTMLDivElement>(null);
  const [showConfirmRemove, setShowConfirmRemove] = useState(false);
  const audioMenuRef = useRef<HTMLDivElement>(null);
  // The phone menu spans the whole dock, so it lives outside the kebab's wrapper.
  const audioMenuPanelRef = useRef<HTMLDivElement>(null);
  // Animate only a fold the user asked for, not the player appearing with the editor.
  const [foldAnimated, setFoldAnimated] = useState(false);
  const [isFolding, setIsFolding] = useState(false);
  const foldTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (foldTimerRef.current !== null) window.clearTimeout(foldTimerRef.current);
  }, []);
  const pendingInitialTimeRef = useRef<number | null>(initialTime ?? null);
  const playbackRateRef = useRef(initialPlaybackRate ?? 1);
  const volumeRef = useRef(initialVolume ?? 1);
  const durationRef = useRef(0);
  const onStateChangeRef = useRef(onStateChange);
  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
    audioRef.current.playbackRate = playbackRate;
  }, [volume, playbackRate]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
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
  }, [initialTime, src]);

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
    if (audioRef.current) audioRef.current.volume = newVol;
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
        case 'ArrowUp':
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); adjustVolumeRef.current(0.05); }
          break;
        case 'ArrowDown':
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

  useEffect(() => {
    if (!showVolumePopover) return;
    const handler = (e: PointerEvent) => {
      if (!volumePopoverRef.current?.contains(e.target as Node)) setShowVolumePopover(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setShowVolumePopover(false);
    };
    document.addEventListener('pointerdown', handler);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handler);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showVolumePopover]);

  // Phone and desktop place the menus differently: a resize or rotation closes them.
  useEffect(() => {
    setShowAudioMenu(false);
    setShowVolumePopover(false);
  }, [isPhone]);

  const setCollapsed = useCallback((collapsed: boolean, moveFocus = true) => {
    if (foldTimerRef.current !== null) return;
    focusAfterFoldRef.current = moveFocus;
    setFoldAnimated(true);
    setShowAudioMenu(false);
    setShowVolumePopover(false);
    setIsSpeedOpen(false);
    const commit = () => setFold(prev => {
      const next = { ...prev, collapsed };
      saveFoldState(next);
      return next;
    });
    if (!collapsed) {
      commit();
      return;
    }
    setIsFolding(true);
    foldTimerRef.current = window.setTimeout(() => {
      foldTimerRef.current = null;
      setIsFolding(false);
      commit();
    }, FOLD_WIPE_MS);
  }, []);

  // Keyboard users land on the control that undoes the fold, not on the page body.
  useEffect(() => {
    if (!focusAfterFoldRef.current) return;
    focusAfterFoldRef.current = false;
    (fold.collapsed ? pillRef.current : collapseBtnRef.current)?.focus();
  }, [fold.collapsed]);

  const handleBarTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // The scrubber and volume drag on their own; a swipe there is a seek, not a fold.
    if (e.touches.length !== 1 || target.closest('input')) {
      swipeStartRef.current = null;
      return;
    }
    swipeStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleBarTouchEnd = (e: React.TouchEvent) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    // Down, or sideways toward the pill's corner, folds the bar.
    const towardPill = fold.side === 'left' ? -dx : dx;
    const swipedDown = dy > SWIPE_MIN_PX && Math.abs(dx) < dy;
    const swipedToCorner = towardPill > SWIPE_MIN_PX && Math.abs(dy) < towardPill;
    if (swipedDown || swipedToCorner) setCollapsed(true, false);
  };

  // Dragging the pill sideways moves it to the other bottom corner; a plain tap opens the player.
  const handlePillPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    pillDragRef.current = { x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePillPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pillDragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < DRAG_MIN_PX) return;
    drag.moved = true;
    setPillOffset(dx);
  };

  const handlePillPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = pillDragRef.current;
    if (!drag?.moved) return;
    const side: PillSide = e.clientX < window.innerWidth / 2 ? 'left' : 'right';
    setPillOffset(0);
    setFold(prev => {
      const next = { ...prev, side };
      saveFoldState(next);
      return next;
    });
  };

  const handlePillClick = () => {
    const dragged = pillDragRef.current?.moved;
    pillDragRef.current = null;
    if (dragged) return;
    setCollapsed(false);
  };

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
    if (isSpeedOpen || menuView === 'speed') speedSliderRef.current?.focus();
  }, [isSpeedOpen, menuView]);

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
    onStateChangeRef.current?.({ currentTime: t, playbackRate: playbackRateRef.current, volume: volumeRef.current });
  };

  const handleLoadedMetadata = () => {
    if (!audioRef.current) return;
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.volume = volume;
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

  /* Portaled: the glass dock's backdrop-filter would otherwise trap the fixed overlay inside it. */
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
      <div className={`audio-player is-collapsed${foldAnimated ? ' did-fold' : ''}${fold.side === 'left' ? ' is-left' : ''}`}>
        {audioElement}
        <button
          ref={pillRef}
          type="button"
          className={`player-pill${isPlaying ? ' is-playing' : ''}`}
          aria-label={`Mostra il player audio (${isPlaying ? 'in riproduzione' : 'in pausa'}, ${formatAccessibleTime(currentTime)} di ${formatAccessibleTime(duration)})`}
          title="Mostra il player (trascinalo per spostarlo)"
          onClick={handlePillClick}
          onPointerDown={handlePillPointerDown}
          onPointerMove={handlePillPointerMove}
          onPointerUp={handlePillPointerUp}
          onPointerCancel={() => { pillDragRef.current = null; setPillOffset(0); }}
          style={pillOffset ? { transform: `translateX(${pillOffset}px)` } : undefined}
        >
          <svg className="player-pill-ring" viewBox="0 0 44 44" aria-hidden="true">
            <circle className="player-pill-track" cx="22" cy="22" r={PILL_RING_RADIUS} />
            <circle
              className="player-pill-progress"
              cx="22"
              cy="22"
              r={PILL_RING_RADIUS}
              strokeDasharray={PILL_RING_LENGTH}
              strokeDashoffset={PILL_RING_LENGTH * (1 - progress)}
            />
          </svg>
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

  // `back` puts the phone menu's return arrow beside the value, so the panel needs no title row.
  const renderSpeedPanel = (back?: React.ReactNode) => (
    <>
      <div className="player-speed-value-row">
        {back}
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

  return (
    <div
      className={`audio-player relative flex w-full flex-wrap items-center gap-2 px-0.5 py-1.5${foldAnimated ? ' did-fold' : ''}${isFolding ? ' is-folding' : ''}${fold.side === 'left' ? ' is-left' : ''}`}
      style={{ background: 'transparent' }}
      onTouchStart={handleBarTouchStart}
      onTouchEnd={handleBarTouchEnd}
    >
      {audioElement}

      {fold.side === 'left' && foldTab}

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={togglePlay}
          className={`player-control player-play-control ${isPlaying ? 'is-active' : ''}`}
          aria-label={isPlaying ? 'Metti in pausa' : 'Avvia riproduzione'}
          title={isPlaying ? 'Metti in pausa (F4)' : 'Avvia riproduzione (F4)'}
        >
          {isPlaying ? <Pause className="h-4 w-4" strokeWidth={2.2} /> : <Play className="h-4 w-4 fill-current" strokeWidth={2.2} />}
        </button>
        <button type="button" onClick={() => skip(-10)} className="player-control" aria-label="Indietro di 10 secondi" title="Indietro di 10 secondi">
          <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
            <RotateCcw className="h-5 w-5" />
            <span className="absolute mt-0.5 text-[8px] font-bold leading-none">10</span>
          </span>
        </button>
        <button type="button" onClick={() => skip(10)} className="player-control" aria-label="Avanti di 10 secondi" title="Avanti di 10 secondi">
          <span className="relative inline-flex h-5 w-5 items-center justify-center" aria-hidden="true">
            <RotateCw className="h-5 w-5" />
            <span className="absolute mt-0.5 text-[8px] font-bold leading-none">10</span>
          </span>
        </button>
      </div>

      <div className={`flex ${isPhone ? 'min-w-0 gap-2' : 'min-w-48 gap-3'} flex-1 items-center`}>
        <input
          type="range"
          min={0}
          max={duration || 100}
          step={0.1}
          value={currentTime}
          onChange={handleSeek}
          aria-label="Posizione audio"
          aria-valuetext={duration > 0
            ? `${formatAccessibleTime(currentTime)} di ${formatAccessibleTime(duration)}`
            : `${formatAccessibleTime(currentTime)}; durata non disponibile`}
          className="custom-scrubber min-w-0 flex-1"
          style={{ '--progress': duration ? `${(currentTime / duration) * 100}%` : '0%' } as React.CSSProperties}
        />
        <span
          className={`shrink-0 whitespace-nowrap font-semibold tabular-nums ${isPhone ? 'text-[11px]' : 'pr-0.5 text-xs'}`}
          style={{ color: 'var(--text-muted)' }}
        >
          {timeLabel}
        </span>
      </div>

      {isPhone ? (
        <>
        {showVolume && (
          <div className="relative shrink-0" ref={volumePopoverRef}>
            <button
              type="button"
              className={`player-control ${showVolumePopover ? 'is-active' : ''}`}
              aria-label="Volume"
              title="Volume"
              aria-haspopup="true"
              aria-expanded={showVolumePopover}
              onClick={() => {
                setShowAudioMenu(false);
                setShowVolumePopover(v => !v);
              }}
            >
              <VolumeIcon className="h-4 w-4" />
            </button>
            {showVolumePopover && (
              <div className="kebab-panel player-menu player-volume-popover">
                <span className="player-volume-value" aria-hidden="true">{Math.round(volume * 100)}</span>
                <div className="player-volume-vertical">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={volume}
                    onChange={handleVolume}
                    aria-label="Livello volume"
                    aria-orientation="vertical"
                    aria-valuetext={`${Math.round(volume * 100)}%`}
                    className="custom-volume"
                    style={{ '--progress': `${volume * 100}%` } as React.CSSProperties}
                  />
                </div>
              </div>
            )}
          </div>
        )}
        <div className="relative shrink-0" ref={audioMenuRef}>
          <button
            type="button"
            className={`player-control ${showAudioMenu ? 'is-active' : ''}`}
            aria-label="Altri controlli audio"
            title="Velocità e altri controlli"
            aria-haspopup="true"
            aria-expanded={showAudioMenu}
            onClick={() => {
              setShowVolumePopover(false);
              setMenuView('main');
              setShowAudioMenu(v => !v);
            }}
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
        {showAudioMenu && (
          <div ref={audioMenuPanelRef} className="kebab-panel player-menu player-more-panel">
            {menuView === 'speed' ? (
              <>
                {renderSpeedPanel(
                  <button
                    type="button"
                    className="player-round-btn is-plain player-speed-back"
                    aria-label="Torna al menu audio"
                    onClick={() => setMenuView('main')}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>,
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="kebab-item player-menu-item"
                  aria-label={`Velocità di riproduzione: ${formatRate(playbackRate)}`}
                  onClick={() => setMenuView('speed')}
                >
                  <Gauge className="player-menu-icon" />
                  <span>Velocità</span>
                  <span className="player-menu-end player-menu-value">{formatRate(playbackRate)}</span>
                  <ChevronRight className="player-menu-icon" />
                </button>
                {hasAudioActions && <div className="kebab-separator" />}
                {audioActions}
              </>
            )}
          </div>
        )}
        </>
      ) : (
      <div className="flex items-center gap-2">
        {/* Only the value sits in the bar; it opens the speed panel above the bar. */}
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
                zIndex: 9999,
              }}
            >
              {renderSpeedPanel()}
            </div>,
            document.body
          )}
        </div>
        {volumeSlider}
        <div className="flex items-center">
          {hasAudioActions && (
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
          )}
        </div>
      </div>
      )}

      {fold.side === 'right' && foldTab}

      {/* Anchored to the whole bar, not the kebab, so it clears the dock's top edge like the phone menu. */}
      {!isPhone && showAudioMenu && (
        <div ref={audioMenuPanelRef} className="kebab-panel player-menu player-more-panel is-desktop">
          {audioActions}
        </div>
      )}

      {confirmRemoveModal}
    </div>
  );
}

import { Loader2, Play } from 'lucide-react';
import { useDockFold } from '../hooks/useDockFold';
import { PlayerPillRing } from './PlayerPillRing';

interface AudioDockLoadingProps {
  /** The position and length saved when the sbobina was last closed, if known. */
  initialTime?: number;
  initialDuration?: number;
}

/**
 * The dock while the sbobina's audio gets ready. It takes the player's place in the same fold:
 * folded it is already the player's pill, open it keeps the player's height, so a quick load
 * swaps in the player without the bar flashing open or the page resizing.
 */
export function AudioDockLoading({ initialTime, initialDuration }: AudioDockLoadingProps) {
  const { fold, pillProps, foldClassName } = useDockFold();
  const progress = initialDuration && initialDuration > 0 ? Math.min(1, (initialTime ?? 0) / initialDuration) : 0;

  if (fold.collapsed) {
    return (
      <div className={foldClassName}>
        <button
          {...pillProps}
          type="button"
          className="player-pill"
          aria-label="Mostra il player audio (preparazione audio della sbobina in corso)"
          title="Mostra il player (trascinalo per spostarlo)"
        >
          <PlayerPillRing progress={progress} />
          <Play className="h-4 w-4 fill-current" />
        </button>
      </div>
    );
  }

  return (
    <div role="status" className={`${foldClassName} audio-dock-loading flex items-center gap-2 py-1.5 text-sm`}>
      <span className="audio-dock-loading-label">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Preparazione audio della sbobina...
      </span>
    </div>
  );
}

const PILL_RING_RADIUS = 19;
const PILL_RING_LENGTH = 2 * Math.PI * PILL_RING_RADIUS;

/** The folded player's progress ring: how much of the lecture has been heard, from 0 to 1. */
export function PlayerPillRing({ progress }: { progress: number }) {
  return (
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
  );
}

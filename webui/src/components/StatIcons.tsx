import { motion } from 'motion/react';
import { EASE_OUT } from '../motion';

// Dashboard stat icons that act out what they count: they play once when the
// card appears and again on hover (`run` changes), then rest. Each run remounts
// the moving parts so the animation restarts from its first frame.
interface StatIconProps {
  run: number;
  delay?: number;
}

const svgProps = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

// Lines of text write themselves onto the page, one after another.
export function WritingDocIcon({ run, delay = 0 }: StatIconProps) {
  const lines = ['M8 9h2', 'M8 13h8', 'M8 17h6'];
  return (
    <svg {...svgProps} data-testid="stat-icon-doc">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      {lines.map((d, i) => (
        <motion.path
          key={`${run}-${i}`}
          d={d}
          data-run={run}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.32, ease: EASE_OUT, delay: delay + i * 0.18 }}
        />
      ))}
    </svg>
  );
}

// A short burst of sound: the bars jump, then settle into a resting waveform.
const BARS = [
  { x: 4, half: 2, peak: 3.5 },
  { x: 8, half: 5, peak: 2.6 },
  { x: 12, half: 8, peak: 1.4 },
  { x: 16, half: 4, peak: 2.2 },
  { x: 20, half: 2, peak: 3.8 },
];

export function WaveformIcon({ run, delay = 0 }: StatIconProps) {
  return (
    <svg {...svgProps} data-testid="stat-icon-wave">
      {BARS.map(({ x, half, peak }, i) => (
        <motion.line
          key={`${run}-${i}`}
          x1={x} x2={x} y1={12 - half} y2={12 + half}
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
          initial={{ scaleY: 0.2 }}
          animate={{ scaleY: [0.2, peak, 0.6, 1] }}
          transition={{ duration: 0.9, times: [0, 0.35, 0.7, 1], ease: 'easeInOut', delay: delay + i * 0.06 }}
        />
      ))}
    </svg>
  );
}

// The calendar's rings dip as if a page were turned, then the day gets ticked off.
export function CalendarTickIcon({ run, delay = 0 }: StatIconProps) {
  return (
    <svg {...svgProps} data-testid="stat-icon-calendar">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
      <motion.g
        key={`rings-${run}`}
        initial={{ y: 0 }}
        animate={{ y: [0, 1.5, 0] }}
        transition={{ duration: 0.36, ease: 'easeInOut', delay }}
      >
        <path d="M8 2v4" />
        <path d="M16 2v4" />
      </motion.g>
      <motion.path
        key={`tick-${run}`}
        d="m9 16 2 2 4-4"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.36, ease: EASE_OUT, delay: delay + 0.3 }}
      />
    </svg>
  );
}

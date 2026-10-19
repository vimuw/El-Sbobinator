import { useEffect, useRef } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import './BrandLogo.css';

// The app ignores Windows "Riduci animazioni" everywhere (see MotionConfig in App.tsx),
// so the mascot does not consult prefers-reduced-motion either.

let sessionGreetingPlayed = false;

/** Test-only: lets each test start from a fresh app session. */
// eslint-disable-next-line react-refresh/only-export-components
export function resetBrandLogoSessionGreeting() {
  sessionGreetingPlayed = false;
}

interface BrandLogoProps {
  size: 36 | 52;
  /** Hop once on mount (setup welcome). */
  welcome?: boolean;
  /** Hop once per app session, not on every re-render or navigation back. */
  greetOncePerSession?: boolean;
  /** Celebratory hop each time this flips to true (a transcription just completed). */
  celebrate?: boolean;
  /** Replaces the click greet, e.g. sidebar navigation. */
  onClick?: () => void;
  ariaLabel?: string;
}

const REST = { y: 0, rotate: 0, scaleX: 1, scaleY: 1 };

export function BrandLogo({
  size,
  welcome = false,
  greetOncePerSession = false,
  celebrate = false,
  onClick,
  ariaLabel = 'Saluta El Sbobinator',
}: BrandLogoProps) {
  const controls = useAnimationControls();
  const wasCelebrating = useRef(false);

  useEffect(() => {
    const hop = () => controls.start({
      y: [0, 0, -size * 0.09, 0, 0],
      rotate: [0, -3, 4, -2, 0],
      scaleX: [1, 1.05, 0.98, 1.03, 1],
      scaleY: [1, 0.94, 1.03, 0.97, 1],
      transition: { duration: 0.5, delay: 0.2, ease: 'easeInOut' },
    });
    if (welcome) {
      void hop();
      return () => controls.stop();
    }
    if (greetOncePerSession && !sessionGreetingPlayed) {
      sessionGreetingPlayed = true;
      let finished = false;
      void hop().then(() => { finished = true; });
      return () => {
        // Interrupted before it finished (unmount, StrictMode re-run): let it play next time.
        if (!finished) sessionGreetingPlayed = false;
        controls.stop();
      };
    }
    controls.set(REST);
    return () => controls.stop();
  }, [controls, size, welcome, greetOncePerSession]);

  useEffect(() => {
    const rising = celebrate && !wasCelebrating.current;
    wasCelebrating.current = celebrate;
    if (!rising) return;
    controls.stop();
    void controls.start({
      y: [0, 0, -size * 0.32, 0, -size * 0.08, 0, 0],
      rotate: [0, -4, 8, -6, 3, -1, 0],
      scaleX: [1, 1.12, 0.94, 1.1, 0.98, 1.02, 1],
      scaleY: [1, 0.86, 1.08, 0.9, 1.03, 0.98, 1],
      transition: { duration: 0.9, ease: 'easeInOut' },
    });
  }, [celebrate, controls, size]);

  const greet = () => {
    controls.stop();
    void controls.start({
      y: [0, 0, -size * 0.18, 0, 0, 0],
      rotate: [0, -8, 10, -6, 3, 0],
      scaleX: [1, 1.08, 0.97, 1.06, 1, 1],
      scaleY: [1, 0.9, 1.04, 0.94, 1, 1],
      transition: { duration: 0.55, ease: 'easeInOut' },
    });
  };

  return (
    <motion.button
      type="button"
      className="brand-logo"
      style={{ width: size, height: size }}
      aria-label={ariaLabel}
      onClick={onClick ?? greet}
      whileHover={{ rotate: -5, y: -1 }}
      whileTap={{ scale: 0.95 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
      <motion.img
        src="./icon.png"
        alt="El Sbobinator"
        draggable={false}
        animate={controls}
        style={{ transformOrigin: '50% 90%' }}
      />
    </motion.button>
  );
}

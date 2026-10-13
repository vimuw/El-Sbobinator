import { useEffect, useSyncExternalStore } from 'react';
import { motion, useAnimationControls } from 'motion/react';
import './BrandLogo.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

function subscribeToMotionPreference(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener('change', onChange);
  return () => preference.removeEventListener('change', onChange);
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia(reducedMotionQuery).matches;
}

interface BrandLogoProps {
  size: 36 | 52;
  welcome?: boolean;
}

export function BrandLogo({ size, welcome = false }: BrandLogoProps) {
  const controls = useAnimationControls();
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, () => false);

  useEffect(() => {
    if (welcome && !reducedMotion) {
      void controls.start({
        y: [0, 0, -size * 0.09, 0, 0],
        rotate: [0, -3, 4, -2, 0],
        scaleX: [1, 1.05, 0.98, 1.03, 1],
        scaleY: [1, 0.94, 1.03, 0.97, 1],
        transition: { duration: 0.5, delay: 0.2, ease: 'easeInOut' },
      });
    } else {
      controls.set({ y: 0, rotate: 0, scaleX: 1, scaleY: 1 });
    }
    return () => controls.stop();
  }, [controls, reducedMotion, size, welcome]);

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
      aria-label="Saluta El Sbobinator"
      onClick={greet}
      whileHover={{ scale: 1.08, rotate: -6, y: -2 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 380, damping: 20 }}
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

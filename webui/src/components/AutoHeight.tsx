import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { DURATION, enterTransition } from '../motion';

// Eases a slot's height toward its content's measured height, so content
// swapped inside it can crossfade in place while the page settles once below.
// Clipping is limited to the resize itself: tooltips and focus rings stay visible.
export function AutoHeight({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  const [isResizing, setIsResizing] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(() => setHeight(content.offsetHeight));
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={className}
      data-testid={testId}
      initial={false}
      animate={{ height }}
      transition={enterTransition(DURATION.slow)}
      onAnimationStart={() => setIsResizing(true)}
      onAnimationComplete={() => setIsResizing(false)}
      style={{ overflow: isResizing ? 'hidden' : 'visible' }}
    >
      <div ref={contentRef}>{children}</div>
    </motion.div>
  );
}

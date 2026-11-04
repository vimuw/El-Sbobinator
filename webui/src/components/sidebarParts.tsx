import { useState, type ReactNode } from 'react';
import { motion, AnimatePresence, type Variants } from 'motion/react';
import { DURATION } from '../motion';

// Pieces shared by the sidebar's own buttons and by the account button beside them.

export type SidebarBadgeTone = 'processing' | 'alert' | 'accent' | 'success' | 'warning' | 'neutral';

// A status dot on a sidebar icon. Its halo runs on the banner's beat (--processing-beat),
// so a live run never shows dots pulsing at different speeds.
export function SidebarBadge({ tone }: { tone: SidebarBadgeTone }) {
  return (
    <span className={`sidebar-badge tone-${tone}`} aria-hidden="true" data-testid={`sidebar-badge-${tone}`}>
      <span className="sidebar-badge-halo" />
      <span className="sidebar-badge-dot" />
    </span>
  );
}

export function SidebarTooltip({
  label,
  children,
  disabled,
  placement = 'right',
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  placement?: 'right' | 'top';
}) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="sidebar-tooltip-anchor"
      onMouseEnter={() => {
        if (!disabled) setVisible(true);
      }}
      onMouseLeave={() => setVisible(false)}
      onClick={() => setVisible(false)}
      style={{ position: 'relative', display: 'block' }}
    >
      {children}
      <AnimatePresence>
        {visible && !disabled && (
          <motion.span
            className={`sidebar-tooltip ${placement === 'top' ? 'placement-top' : ''}`.trim()}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -4 }}
            transition={{ duration: DURATION.fast }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// The pointer of a panel opened from a sidebar button: 12×18px on the panel's left edge, its tip
// at `centerFromBottom` px above the panel's bottom. Fill and stroke match the panel frame
// (--bg-floating, --border-floating), the fill running past the edge to cover the frame's border.
export const POPOVER_CARET_HEIGHT = 18;

export function PopoverCaret({ centerFromBottom, variants }: { centerFromBottom: number; variants?: Variants }) {
  return (
    <motion.div
      variants={variants}
      className="absolute -left-[8px] pointer-events-none z-30 flex items-center"
      style={{ bottom: centerFromBottom - POPOVER_CARET_HEIGHT / 2, transformOrigin: 'right center' }}
      aria-hidden="true"
      data-testid="popover-caret"
    >
      <svg width="12" height={POPOVER_CARET_HEIGHT} viewBox="0 0 12 18" fill="none" xmlns="http://www.w3.org/2000/svg">
        <polygon points="12,0.5 8.5,0.5 0.5,9 8.5,17.5 12,17.5" fill="var(--bg-floating)" />
        <path
          d="M 8.5 0.5 L 0.5 9 L 8.5 17.5"
          stroke="var(--border-floating)"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </motion.div>
  );
}

/**
 * How far above the bottom of a panel pinned `panelBottom` px from the viewport's bottom the
 * middle of `anchor` sits, kept `margin` px clear of the panel's rounded corners.
 */
export function caretCenterFromBottom(anchor: Element | null, panelBottom: number, fallback: number, margin = 20): number {
  if (!anchor) return fallback;
  const rect = anchor.getBoundingClientRect();
  if (rect.height === 0) return fallback;
  const center = window.innerHeight - panelBottom - (rect.top + rect.height / 2);
  return Math.max(margin, Math.round(center));
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { MoreVertical } from 'lucide-react';

export type KebabMenuItem =
  | { label: string; icon?: React.ReactNode; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { separator: true };

interface KebabMenuProps {
  items: KebabMenuItem[];
  align?: 'left' | 'right';
  buttonClassName?: string;
}

interface DropdownPos {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  maxHeight?: number;
  opensUp?: boolean;
}

export function KebabMenu({ items, align = 'right', buttonClassName }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;

    const computePos = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const menuHeight = dropdownRef.current
        ? dropdownRef.current.offsetHeight
        : items.reduce((acc, item) => acc + ('separator' in item ? 5 : 36), 8);

      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const spaceAbove = rect.top - 12;

      const opensUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
      const maxHeight = Math.max(120, opensUp ? spaceAbove : spaceBelow);

      const newPos: DropdownPos = {
        maxHeight,
        opensUp,
      };

      if (opensUp) {
        newPos.bottom = Math.max(8, window.innerHeight - rect.top + 4);
      } else {
        newPos.top = Math.max(8, rect.bottom + 4);
      }

      if (align === 'right') {
        newPos.right = Math.max(8, window.innerWidth - rect.right);
      } else {
        newPos.left = Math.max(8, rect.left);
      }

      setPos(newPos);
    };

    computePos();
    const rafId = requestAnimationFrame(computePos);
    return () => cancelAnimationFrame(rafId);
  }, [open, items, align]);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      if (dropdownRef.current && dropdownRef.current.contains(target)) return;
      setOpen(false);
    };
    const handleClose = () => setOpen(false);

    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleClose, { capture: true, passive: true });
    window.addEventListener('resize', handleClose, { passive: true });

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleClose, { capture: true });
      window.removeEventListener('resize', handleClose);
    };
  }, [open]);

  const opensUp = pos?.opensUp ?? false;

  return (
    <>
      <button
        ref={buttonRef}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className={buttonClassName}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 4,
          background: open ? 'var(--sidebar-active-bg)' : 'transparent',
          border: 'none',
          borderRadius: 8,
          color: 'var(--text-muted)',
          opacity: open ? 1 : 0.6,
          cursor: 'pointer',
          transition: 'background 150ms ease, opacity 150ms ease',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--sidebar-active-bg)'; }}
        onMouseLeave={e => { if (!open) { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; } }}
        aria-label="Altre opzioni"
        title="Altre opzioni"
      >
        <MoreVertical className="w-4 h-4" />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              ref={dropdownRef}
              initial={{ opacity: 0, y: opensUp ? 4 : -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: opensUp ? 4 : -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'fixed',
                ...(pos.top !== undefined ? { top: pos.top } : { bottom: pos.bottom }),
                ...(pos.right !== undefined ? { right: pos.right } : { left: pos.left }),
                maxHeight: pos.maxHeight,
                overflowY: 'auto',
                zIndex: 9999,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                minWidth: 210,
                padding: 4,
              }}
              onClick={e => e.stopPropagation()}
            >
              {items.map((item, i) => {
                if ('separator' in item) {
                  return <div key={i} style={{ height: 1, background: 'var(--border-subtle)', margin: '2px 0' }} />;
                }
                return (
                  <button
                    key={i}
                    disabled={item.disabled}
                    onClick={e => { e.stopPropagation(); item.onClick(); setOpen(false); }}
                    className={`kebab-item ${item.danger ? 'is-danger' : ''}`}
                    style={item.disabled ? { opacity: 0.4, cursor: 'default' } : undefined}
                  >
                    {item.icon && <span className="shrink-0 w-4 h-4 flex items-center justify-center">{item.icon}</span>}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

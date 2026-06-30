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
  top: number;
  left?: number;
  right?: number;
}

export function KebabMenu({ items, align = 'right', buttonClassName }: KebabMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<DropdownPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const computePos = () => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    if (align === 'right') {
      setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    } else {
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
  };

  useLayoutEffect(() => {
    if (open) computePos();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && buttonRef.current.contains(target)
      ) return;
      if (
        dropdownRef.current && dropdownRef.current.contains(target)
      ) return;
      setOpen(false);
    };
    const handleScroll = () => setOpen(false);
    document.addEventListener('mousedown', handleOutside);
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('scroll', handleScroll, { capture: true });
    };
  }, [open]);

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
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              style={{
                position: 'fixed',
                top: pos.top,
                ...(pos.right !== undefined ? { right: pos.right } : { left: pos.left }),
                zIndex: 9999,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                borderRadius: 12,
                boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                minWidth: 160,
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
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left bg-transparent transition-colors"
                    style={{
                      border: 'none',
                      borderRadius: 8,
                      cursor: item.disabled ? 'default' : 'pointer',
                      color: item.danger ? 'var(--error-text)' : 'var(--text-primary)',
                      opacity: item.disabled ? 0.4 : 1,
                    }}
                    onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = item.danger ? 'var(--error-subtle)' : 'var(--sidebar-active-bg)'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
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

import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'warning' | 'info';
}

interface ToasterProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center pointer-events-none"
      style={{ minWidth: 0 }}
    >
      <AnimatePresence initial={false}>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-2xl shadow-lg"
            style={{
              maxWidth: '26rem',
              width: 'max-content',
              background: 'var(--bg-elevated)',
              border: `1px solid ${toast.type === 'warning' ? 'var(--error-ring)' : 'var(--border-default)'}`,
              color: 'var(--text-primary)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            }}
          >
            {toast.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--error-text)' }} />
            ) : (
              <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
            )}
            <span className="text-sm flex-1 leading-snug" style={{ color: 'var(--text-secondary)' }}>
              {toast.message}
            </span>
            <button
              onClick={() => onDismiss(toast.id)}
              className="icon-button shrink-0"
              style={{ color: 'var(--text-faint)', marginTop: '-2px' }}
              aria-label="Chiudi notifica"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

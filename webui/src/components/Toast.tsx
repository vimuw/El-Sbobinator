import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, Info, Loader2, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  message: string;
  type: 'warning' | 'info';
  persistent?: boolean;
  action?: {
    label: string;
    loadingLabel?: string;
    errorSuffix?: string;
    onAction: () => Promise<void>;
  };
  onDismiss?: () => void;
}

interface ToasterProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

interface ToastItemProps {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleDismiss = () => {
    toast.onDismiss?.();
    onDismiss(toast.id);
  };

  const handleAction = async () => {
    if (isLoading || !toast.action) return;
    setIsLoading(true);
    setErrorText(null);
    try {
      await toast.action.onAction();
      onDismiss(toast.id);
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
      setIsLoading(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.96 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="pointer-events-auto flex flex-col gap-1.5 px-4 py-3 rounded-2xl shadow-lg"
      style={{
        maxWidth: '26rem',
        width: 'max-content',
        background: 'var(--bg-elevated)',
        border: `1px solid ${toast.type === 'warning' ? 'var(--error-ring)' : 'var(--border-default)'}`,
        color: 'var(--text-primary)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      }}
    >
      <div className="flex items-start gap-3">
        {toast.type === 'warning' ? (
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--error-text)' }} />
        ) : (
          <Info className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--text-muted)' }} />
        )}
        <span className="text-sm flex-1 leading-snug" style={{ color: 'var(--text-secondary)' }}>
          {toast.message}
        </span>
        <div className="flex items-center gap-2 shrink-0 ml-1">
          {toast.action && (
            <button
              onClick={handleAction}
              disabled={isLoading}
              className="text-sm flex items-center gap-1"
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: isLoading ? 'default' : 'pointer',
                textDecoration: 'underline',
                color: 'var(--text-primary)',
                opacity: isLoading ? 0.5 : 1,
              }}
            >
              {isLoading ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" />{toast.action.loadingLabel ?? 'Caricamento…'}</>
              ) : (
                toast.action.label
              )}
            </button>
          )}
          <button
            onClick={handleDismiss}
            className="icon-button shrink-0"
            style={{ color: 'var(--text-faint)', marginTop: '-2px' }}
            aria-label="Chiudi notifica"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {errorText && (
        <div className="flex items-center gap-1.5 text-xs pl-7" style={{ color: 'var(--color-error, #ef4444)' }}>
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span>{errorText}{toast.action?.errorSuffix ? ` — ${toast.action.errorSuffix}` : ''}</span>
        </div>
      )}
    </motion.div>
  );
}

export function Toaster({ toasts, onDismiss }: ToasterProps) {
  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] flex flex-col gap-2 items-center pointer-events-none"
      style={{ minWidth: 0 }}
    >
      <AnimatePresence initial={false}>
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}

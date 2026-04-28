import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AlertTriangle, Loader2, X, Zap } from 'lucide-react';
import { GITHUB_RELEASES_URL } from '../branding';

interface StatusBannersProps {
  isPeakHour: boolean;
  isPeakDismissed: boolean;
  onDismissPeak: () => void;
  updateAvailable: string | null;
  dismissUpdate: (version: string) => void;
}

export function StatusBanners({
  isPeakHour, isPeakDismissed, onDismissPeak,
  updateAvailable, dismissUpdate,
}: StatusBannersProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  return (
    <>
      <AnimatePresence>
        {isPeakHour && !isPeakDismissed && (
          <motion.div
            key="peak-hour-banner"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="w-full overflow-hidden"
            style={{ borderBottom: '1px solid var(--warning-ring, var(--border-default))', background: 'var(--warning-subtle)' }}
          >
            <div className="px-5 sm:px-6 py-2.5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5 text-sm font-medium" style={{ color: 'var(--warning-text)' }}>
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Fascia oraria di punta (15:00–20:00): tutti i modelli Gemini Flash possono subire <strong>rallentamenti o errori 503</strong> per traffico elevato sui server Google.</span>
              </div>
              <button
                onClick={onDismissPeak}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warning-text)', padding: '2px', lineHeight: 1 }}
                aria-label="Chiudi avviso fascia oraria"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {updateAvailable && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="w-full"
            style={{ background: 'var(--accent-subtle)', borderBottom: '1px solid var(--accent-ring, var(--border-default))' }}
          >
            <div className="px-5 sm:px-6 py-2.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2.5 text-sm font-medium" style={{ color: 'var(--accent-text, var(--text-primary))' }}>
                  <Zap className="w-4 h-4 shrink-0" />
                  <span>Nuova versione disponibile: <strong>{updateAvailable}</strong></span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    disabled={isUpdating}
                    onClick={async () => {
                      if (isUpdating) return;
                      setIsUpdating(true);
                      setUpdateError(null);
                      try {
                        const result = await window.pywebview?.api?.download_and_install_update?.(updateAvailable!);
                        if (!result?.ok) {
                          setUpdateError(result?.error ?? 'Download fallito');
                          setIsUpdating(false);
                          window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL);
                        } else {
                          setTimeout(() => setIsUpdating(false), 3000);
                        }
                      } catch (e) {
                        setUpdateError(String(e));
                        setIsUpdating(false);
                        window.pywebview?.api?.open_url?.(GITHUB_RELEASES_URL);
                      }
                    }}
                    className="flex items-center gap-1.5 text-sm"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: isUpdating ? 'default' : 'pointer', textDecoration: 'underline', color: 'var(--accent-text, var(--text-primary))', opacity: isUpdating ? 0.5 : 1 }}
                  >
                    {isUpdating
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Download in corso…</>
                      : 'Aggiorna'}
                  </button>
                  <button
                    onClick={() => dismissUpdate(updateAvailable)}
                    aria-label="Chiudi avviso aggiornamento"
                    className="flex items-center"
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)' }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {updateError && (
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-error, #ef4444)' }}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{updateError} — si è aperta la pagina GitHub per scaricare manualmente.</span>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

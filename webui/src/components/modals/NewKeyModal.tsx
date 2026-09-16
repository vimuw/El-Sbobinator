import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, X, ChevronDown, ChevronRight } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../../utils';

interface NewKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  fallbackKeys?: string[];
}

export function NewKeyModal({ isOpen, onClose, fallbackKeys = [] }: NewKeyModalProps) {
  const [newKeyInput, setNewKeyInput] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  const availableFallbackKey = useMemo(() => {
    return fallbackKeys.find((k) => GEMINI_KEY_PATTERN.test(k.trim()))?.trim() || null;
  }, [fallbackKeys]);

  useEffect(() => {
    if (isOpen) {
      setNewKeyInput('');
      setShowManualInput(!availableFallbackKey);
    }
  }, [isOpen, availableFallbackKey]);

  const isReplacementKeyValid = GEMINI_KEY_PATTERN.test(newKeyInput.trim());

  const handleClose = () => {
    if (window.pywebview?.api?.answer_new_key) {
      window.pywebview.api.answer_new_key(null);
    }
    onClose();
  };

  const handleSubmitManual = () => {
    if (!isReplacementKeyValid) return;
    if (window.pywebview?.api?.answer_new_key) {
      window.pywebview.api.answer_new_key(newKeyInput.trim());
    }
    onClose();
  };

  const handleUseFallback = (keyToUse: string) => {
    if (window.pywebview?.api?.answer_new_key) {
      window.pywebview.api.answer_new_key(keyToUse);
    }
    onClose();
  };

  const maskedFallbackKey = useMemo(() => {
    if (!availableFallbackKey) return '';
    if (availableFallbackKey.length <= 8) return '••••••••';
    return `${availableFallbackKey.slice(0, 6)}••••••••${availableFallbackKey.slice(-4)}`;
  }, [availableFallbackKey]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="modal-overlay absolute inset-0"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } }}
            className="modal-card relative w-full max-w-md max-h-[86vh] overflow-hidden flex flex-col"
          >
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <Key className="w-5 h-5 shrink-0 text-[var(--warning-text)]" />
                <h2 className="text-lg font-semibold truncate text-[var(--text-primary)]">Esaurimento quota</h2>
              </div>
              <button
                onClick={handleClose}
                className="icon-button modal-icon-button"
                aria-label="Chiudi finestra"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="modal-body space-y-4">
              <p className="text-sm text-[var(--text-secondary)] leading-relaxed">
                La quota del tuo progetto Google per le API Gemini è esaurita (errore 429).
                L'avanzamento della lezione è stato salvato su disco.
              </p>

              {/* 1-Click Fallback Key Card */}
              {availableFallbackKey && (
                <div className="p-3.5 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-[var(--accent-text)]" />
                      <span>Chiave di riserva disponibile</span>
                    </span>
                    <span className="text-xs font-mono font-semibold text-[var(--text-primary)] bg-[var(--bg-hover)] px-2 py-0.5 rounded border border-[var(--border-default)]">
                      {maskedFallbackKey}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                    È presente una chiave di backup salvata nelle Impostazioni. Puoi confermarla per continuare subito la trascrizione.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleUseFallback(availableFallbackKey)}
                    className="w-full modal-action-button is-primary flex items-center justify-center gap-2 py-2 text-sm font-semibold cursor-pointer"
                  >
                    <Key className="w-4 h-4" />
                    <span>Continua con la chiave di riserva</span>
                  </button>
                </div>
              )}

              {/* Manual Input Disclosure / Section */}
              {availableFallbackKey ? (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowManualInput(prev => !prev)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer select-none"
                  >
                    {showManualInput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    <span>Oppure inserisci una chiave diversa manualmente</span>
                  </button>

                  {showManualInput && (
                    <div className="mt-2.5 space-y-2">
                      <input
                        type="password"
                        value={newKeyInput}
                        onChange={(e) => setNewKeyInput(e.target.value)}
                        placeholder="Incolla qui la nuova API Key..."
                        className="app-input font-mono text-sm w-full"
                        autoFocus
                      />
                      <p
                        className={`text-xs ${newKeyInput.trim().length === 0 || isReplacementKeyValid ? 'text-[var(--text-muted)]' : 'text-[var(--error-text)]'}`}
                      >
                        {newKeyInput.trim().length === 0
                          ? 'Inserisci una chiave Gemini valida per continuare.'
                          : isReplacementKeyValid
                            ? 'Formato chiave valido.'
                            : 'La chiave non sembra valida. Deve iniziare con AIzaSy o AQ.'}
                      </p>
                      <button
                        type="button"
                        onClick={handleSubmitManual}
                        disabled={!isReplacementKeyValid}
                        className="modal-action-button is-primary w-full py-2 text-sm font-semibold"
                      >
                        Usa chiave manuale
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-[var(--text-secondary)]">
                    Se hai un'altra API Key con quota disponibile, incollala qui per continuare da dove eri rimasto:
                  </p>
                  <input
                    type="password"
                    value={newKeyInput}
                    onChange={(e) => setNewKeyInput(e.target.value)}
                    placeholder="Incolla qui la nuova API Key..."
                    className="app-input font-mono text-sm w-full"
                    autoFocus
                  />
                  <p
                    className={`text-xs ${newKeyInput.trim().length === 0 || isReplacementKeyValid ? 'text-[var(--text-muted)]' : 'text-[var(--error-text)]'}`}
                  >
                    {newKeyInput.trim().length === 0
                      ? 'Inserisci una chiave Gemini valida per continuare.'
                      : isReplacementKeyValid
                        ? 'Formato chiave valido.'
                        : 'La chiave non sembra valida. Deve iniziare con AIzaSy o AQ.'}
                  </p>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                onClick={handleClose}
                className="modal-action-button flex-1"
                title="La sessione viene salvata su disco; potrai riprenderla al reset delle 09:00"
              >
                Sospendi elaborazione
              </button>
              {!availableFallbackKey && (
                <button
                  onClick={handleSubmitManual}
                  className="modal-action-button is-primary flex-1"
                  disabled={!isReplacementKeyValid}
                >
                  Continua
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

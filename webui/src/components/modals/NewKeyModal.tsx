import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Key, X } from 'lucide-react';
import { GEMINI_KEY_PATTERN } from '../../utils';

interface NewKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NewKeyModal({ isOpen, onClose }: NewKeyModalProps) {
  const [newKeyInput, setNewKeyInput] = useState('');

  useEffect(() => {
    if (isOpen) setNewKeyInput('');
  }, [isOpen]);

  const isReplacementKeyValid = GEMINI_KEY_PATTERN.test(newKeyInput.trim());

  const handleClose = () => {
    if (window.pywebview?.api?.answer_new_key) {
      window.pywebview.api.answer_new_key(null);
    }
    onClose();
  };

  const handleSubmit = () => {
    if (!isReplacementKeyValid) return;
    if (window.pywebview?.api?.answer_new_key) {
      window.pywebview.api.answer_new_key(newKeyInput.trim());
    }
    onClose();
  };

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
              <p>
                La quota del tuo account Google per le API Gemini sembra esaurita (o temporaneamente limitata).
              </p>
              <p>
                Se hai un'altra API Key con quota disponibile, incollala qui per continuare da dove eri rimasto, senza perdere i progressi.
              </p>
              <div className="pt-2 space-y-2">
                <input
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  placeholder="Incolla qui la nuova API Key..."
                  className="app-input font-mono text-sm"
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
            </div>
            <div className="modal-footer flex-col">
              <button
                onClick={handleSubmit}
                className="modal-action-button is-primary w-full"
                disabled={!isReplacementKeyValid}
              >
                Continua
              </button>
              <button onClick={handleClose} className="modal-action-button w-full">
                Annulla
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

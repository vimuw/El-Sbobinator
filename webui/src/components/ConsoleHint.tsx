import { AnimatePresence, motion } from 'motion/react';
import { Terminal, X } from 'lucide-react';
import { fadeUp } from '../motion';

// Shown under the progress for the first runs started with the console closed (useConsoleHint).
export function ConsoleHint({ visible, onOpen, onDismiss }: { visible: boolean; onOpen: () => void; onDismiss: () => void }) {
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div key="console-hint" {...fadeUp} className="console-hint" role="note" data-testid="console-hint">
          <Terminal className="console-hint-icon" size={15} aria-hidden="true" />
          <p className="console-hint-text">
            Vuoi vedere cosa succede passo per passo? La console mostra ogni blocco, le attese e gli avvisi.
          </p>
          <div className="console-hint-actions">
            <button type="button" className="console-hint-open" onClick={onOpen}>
              Apri console
            </button>
            <button type="button" className="console-hint-close" aria-label="Chiudi e non mostrare più" title="Non mostrare più" onClick={onDismiss}>
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

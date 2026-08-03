import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, X, Copy, Check, Sparkles, Radio } from 'lucide-react';

interface CollaborationModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRoom?: string;
  activeUser?: { name: string; color: string };
  onStartCollaboration: (room: string, user: { name: string; color: string }) => void;
  onStopCollaboration: () => void;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

export const CollaborationModal: React.FC<CollaborationModalProps> = ({
  isOpen,
  onClose,
  activeRoom,
  activeUser,
  onStartCollaboration,
  onStopCollaboration,
}) => {
  const [room, setRoom] = useState(activeRoom || '');
  const [name, setName] = useState(activeUser?.name || 'Studente');
  const [color, setColor] = useState(activeUser?.color || '#3b82f6');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRoom(activeRoom || '');
      setName(activeUser?.name || 'Studente');
      setColor(activeUser?.color || '#3b82f6');
    }
  }, [isOpen, activeRoom, activeUser]);

  const handleGenerateCode = () => {
    const randomCode = `sbobina-${Math.random().toString(36).substring(2, 8)}`;
    setRoom(randomCode);
  };

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard.writeText(room);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!room.trim() || !name.trim()) return;
    onStartCollaboration(room.trim().toLowerCase(), { name: name.trim(), color });
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
            onClick={onClose}
            className="modal-overlay absolute inset-0"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
            exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14, ease: 'easeIn' } }}
            className="modal-card relative w-full max-w-md max-h-[86vh] overflow-hidden flex flex-col"
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent-subtle)] text-[var(--accent-color)]">
                  <Users className="w-4.5 h-4.5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold truncate text-[var(--text-primary)]">
                    Lavora in Gruppo
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] truncate font-normal">
                    Collaborazione P2P in tempo reale
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="icon-button modal-icon-button"
                aria-label="Chiudi finestra"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            {activeRoom ? (
              <div className="modal-body space-y-4">
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-hover)] space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-color)] uppercase tracking-wider">
                        <Radio className="w-3.5 h-3.5 animate-pulse" />
                        Sessione Attiva
                      </div>
                      <div className="text-base font-mono font-bold text-[var(--text-primary)] mt-0.5 truncate">
                        {activeRoom}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className="modal-action-button is-compact text-xs shrink-0 flex items-center gap-1.5"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
                      {copied ? 'Copiato!' : 'Copia Codice'}
                    </button>
                  </div>
                </div>

                <p className="text-sm text-[var(--text-muted)]">
                  Condividi questo codice con i tuoi compagni di corso per modificare questa sbobina insieme in tempo reale.
                </p>

                <div className="modal-footer border-t-0 px-0 pt-2 pb-0">
                  <button
                    type="button"
                    onClick={() => {
                      onStopCollaboration();
                      onClose();
                    }}
                    className="modal-action-button is-danger w-full"
                  >
                    Interrompi Sessione Collaborativa
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleJoin} className="flex flex-col flex-1 min-h-0">
                <div className="modal-body space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                      Codice o Nome Stanza
                    </label>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        required
                        placeholder="es. sbobina-anatomia-05"
                        value={room}
                        onChange={e => setRoom(e.target.value)}
                        className="app-input font-mono text-sm pr-24"
                      />
                      <button
                        type="button"
                        onClick={handleGenerateCode}
                        className="absolute right-2 px-2.5 py-1.5 rounded-md text-xs font-semibold text-[var(--accent-color)] bg-[var(--accent-subtle)] hover:bg-[var(--accent-ring)] transition-colors flex items-center gap-1.5 shrink-0"
                        title="Genera un codice casuale"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        Genera
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                      Il tuo Nome o Soprannome
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="es. Marco"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="app-input text-sm"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-2">
                      Colore Cursore Visivo
                    </label>
                    <div className="flex items-center gap-2.5 overflow-x-auto py-2.5 px-2.5 -mx-2.5">
                      {COLORS.map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setColor(c)}
                          style={{
                            backgroundColor: c,
                            boxShadow: color === c ? '0 0 0 2px var(--bg-elevated), 0 0 0 4px var(--accent-bg)' : undefined,
                          }}
                          className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                            color === c
                              ? 'scale-105 shadow-xs'
                              : 'hover:scale-105 opacity-80 hover:opacity-100'
                          }`}
                          aria-label={`Seleziona colore ${c}`}
                        >
                          {color === c && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="modal-footer">
                  <button
                    type="button"
                    onClick={onClose}
                    className="modal-action-button flex-1"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="modal-action-button is-primary flex-1"
                  >
                    Avvia / Partecipa
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

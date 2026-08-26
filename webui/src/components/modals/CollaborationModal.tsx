import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, X, Copy, Check, Sparkles, Radio } from 'lucide-react';
import { generateRoomCode } from '../../utils';
import { STORAGE_KEYS } from '../../storageKeys';

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

const getStoredCollabName = (activeName?: string) => {
  try { return activeName || localStorage.getItem(STORAGE_KEYS.COLLAB_USERNAME) || 'Studente'; } catch { return activeName || 'Studente'; }
};
const getStoredCollabColor = (activeColor?: string) => {
  try { return activeColor || localStorage.getItem(STORAGE_KEYS.COLLAB_USERCOLOR) || '#3b82f6'; } catch { return activeColor || '#3b82f6'; }
};

export const CollaborationModal: React.FC<CollaborationModalProps> = ({
  isOpen,
  onClose,
  activeRoom,
  activeUser,
  onStartCollaboration,
  onStopCollaboration,
}) => {
  const [room, setRoom] = useState(() => activeRoom || generateRoomCode());
  const [name, setName] = useState(() => getStoredCollabName(activeUser?.name));
  const [color, setColor] = useState(() => getStoredCollabColor(activeUser?.color));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setRoom(activeRoom || generateRoomCode());
      setName(getStoredCollabName(activeUser?.name));
      setColor(getStoredCollabColor(activeUser?.color));
      setCopied(false);
    }
  }, [isOpen, activeRoom, activeUser]);

  const handleGenerateCode = () => {
    setRoom(generateRoomCode());
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
    try {
      localStorage.setItem(STORAGE_KEYS.COLLAB_USERNAME, name.trim());
      localStorage.setItem(STORAGE_KEYS.COLLAB_USERCOLOR, color);
    } catch (_) {}
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
                <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] space-y-2">
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
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[var(--text-secondary)]">
                        Codice Stanza Generato
                      </label>
                      <span className="text-[11px] text-[var(--accent-text)] font-medium">
                        Univoco P2P
                      </span>
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        required
                        placeholder="es. sbobina-8f7k2mq9"
                        value={room}
                        onChange={e => setRoom(e.target.value)}
                        className="app-input font-mono text-sm pr-20 select-all"
                        aria-label="Codice stanza generato"
                      />
                      <div className="absolute right-1.5 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          className="w-7 h-7 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                          title={copied ? 'Copiato!' : 'Copia codice'}
                          aria-label={copied ? 'Codice copiato' : 'Copia codice'}
                        >
                          {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateCode}
                          className="w-7 h-7 rounded-md text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors flex items-center justify-center shrink-0 cursor-pointer"
                          title="Rigenera codice"
                          aria-label="Rigenera codice"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
                      I tuoi compagni useranno questo codice per partecipare in tempo reale.
                    </p>
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
                              ? 'scale-105'
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
                    className="modal-action-button is-primary flex-1 flex items-center justify-center gap-2"
                  >
                    <Radio className="w-4 h-4 animate-pulse" />
                    Avvia
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

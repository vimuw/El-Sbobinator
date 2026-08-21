import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, X, Check, Radio } from 'lucide-react';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoinRoom: (roomCode: string, user: { name: string; color: string }) => void;
}

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
];

const getStoredCollabName = () => {
  try { return localStorage.getItem('collab_username') || 'Studente'; } catch { return 'Studente'; }
};
const getStoredCollabColor = () => {
  try { return localStorage.getItem('collab_usercolor') || '#3b82f6'; } catch { return '#3b82f6'; }
};

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  isOpen,
  onClose,
  onJoinRoom,
}) => {
  const [room, setRoom] = useState('');
  const [name, setName] = useState(getStoredCollabName);
  const [color, setColor] = useState(getStoredCollabColor);

  React.useEffect(() => {
    if (isOpen) {
      setName(getStoredCollabName());
      setColor(getStoredCollabColor());
    }
  }, [isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanRoom = room.trim().toLowerCase();
    const cleanName = name.trim();
    if (!cleanRoom || !cleanName) return;

    try {
      localStorage.setItem('collab_username', cleanName);
      localStorage.setItem('collab_usercolor', color);
    } catch (_) {}

    onJoinRoom(cleanRoom, { name: cleanName, color });
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
            className="modal-card relative w-full max-w-md overflow-hidden flex flex-col"
          >
            {/* Modal Header */}
            <div className="modal-header">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8.5 h-8.5 rounded-lg flex items-center justify-center shrink-0 bg-[var(--accent-subtle)] text-[var(--accent-text)]">
                  <Users className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold truncate text-[var(--text-primary)]">
                    Partecipa a una Stanza
                  </h2>
                  <p className="text-xs text-[var(--text-muted)] truncate font-normal">
                    Collabora in tempo reale tramite codice
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

            {/* Modal Form */}
            <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
              <div className="modal-body space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-[var(--text-secondary)] mb-1.5">
                    Codice della Stanza
                  </label>
                  <input
                    type="text"
                    required
                    autoFocus
                    placeholder="es. sbobina-anatomia-05"
                    value={room}
                    onChange={e => setRoom(e.target.value)}
                    className="app-input font-mono text-sm"
                  />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">
                    Inserisci il codice fornito dal creatore della sbobina condivisa.
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
                  <div className="flex items-center gap-2.5 overflow-x-auto py-2 px-1">
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
                  disabled={!room.trim() || !name.trim()}
                  className="modal-action-button is-primary flex-1 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Radio className="w-4 h-4 animate-pulse" />
                  Entra nella Stanza
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

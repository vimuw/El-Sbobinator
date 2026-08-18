import { type FormEvent, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Trash2, X } from 'lucide-react';
import type { ArchiveFolder } from '../../bridge';
import { FOLDER_COLORS, type FolderModalState } from './types';

interface FolderModalProps {
  state: FolderModalState;
  onClose: () => void;
  onSave: (name: string, color: string) => void;
}

export function FolderModal({ state, onClose, onSave }: FolderModalProps) {
  const [name, setName] = useState(state.type === 'edit' ? state.folder.name : '');
  const [color, setColor] = useState(state.type === 'edit' ? state.folder.color : FOLDER_COLORS[0]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name, color);
  };

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      exit={{ opacity: 0 }}
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
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-4 h-4 rounded-full shrink-0" style={{ background: color }} />
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {state.type === 'create' ? 'Nuova cartella' : 'Modifica cartella'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="icon-button modal-icon-button"
            aria-label="Chiudi finestra"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
          <div className="px-5 py-5 space-y-4 text-sm flex-1">
            <div>
              <label className="text-xs font-semibold block mb-1.5" style={{ color: 'var(--text-muted)' }}>
                NOME RACCOLTA
              </label>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="es. Anatomia"
                maxLength={48}
                className="premium-button-secondary w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                style={{ borderColor: 'var(--border-default)', background: 'var(--bg-input)', color: 'var(--text-primary)', textAlign: 'left' }}
              />
            </div>
            <div>
              <label className="text-xs font-semibold block mb-2" style={{ color: 'var(--text-muted)' }}>
                COLORE IDENTIFICATIVO
              </label>
              <div className="flex flex-wrap gap-2">
                {FOLDER_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className="w-7 h-7 rounded-full transition-transform hover:scale-105 focus:outline-none"
                    style={{
                      background: c,
                      border: color === c ? '3px solid var(--text-primary)' : '3px solid transparent',
                      outline: color === c ? `2px solid ${c}` : 'none',
                      outlineOffset: 2,
                    }}
                    aria-label={`Colore ${c}`}
                  />
                ))}
              </div>
            </div>
          </div>
          {/* Footer Actions */}
          <div className="px-5 py-4 flex gap-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <button type="button" onClick={onClose} className="modal-action-button flex-1">
              Annulla
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="modal-action-button is-primary flex-1"
            >
              {state.type === 'create' ? 'Crea raccolta' : 'Salva modifiche'}
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

interface DeleteFolderConfirmModalProps {
  folder: ArchiveFolder;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteFolderConfirmModal({
  folder,
  onClose,
  onConfirm,
}: DeleteFolderConfirmModalProps) {
  const sessionCount = folder.session_dirs.length;

  return (
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
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <Trash2 className="w-5 h-5 shrink-0" style={{ color: 'var(--error-text)' }} />
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              Eliminare questa raccolta?
            </h2>
          </div>
          <button
            onClick={onClose}
            className="icon-button modal-icon-button"
            aria-label="Chiudi finestra"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl" style={{ background: `${folder.color}20`, border: `1px solid ${folder.color}50` }}>
            <span className="w-3 h-3 rounded-full shrink-0" style={{ background: folder.color }} />
            <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{folder.name}</span>
            {sessionCount > 0 && (
              <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                {sessionCount === 1 ? '1 lezione' : `${sessionCount} lezioni`}
              </span>
            )}
          </div>

          <p style={{ color: 'var(--text-muted)' }}>
            La raccolta verrà eliminata. Le sbobine al suo interno{' '}
            <strong style={{ color: 'var(--text-primary)' }}>non verranno cancellate</strong>{' '}
            e resteranno disponibili nell&apos;archivio.
          </p>
        </div>

        <div className="px-5 py-4 flex gap-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onClose} className="modal-action-button flex-1">
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="modal-action-button is-danger flex-1"
          >
            Elimina raccolta
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

interface DeleteMultipleSessionsConfirmModalProps {
  sessions: { sessionDir: string; name: string }[];
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteMultipleSessionsConfirmModal({
  sessions,
  onClose,
  onConfirm,
}: DeleteMultipleSessionsConfirmModalProps) {
  const count = sessions.length;
  const previewList = sessions.slice(0, 5);
  const remainingCount = count - previewList.length;

  return (
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
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <Trash2 className="w-5 h-5 shrink-0" style={{ color: 'var(--error-text)' }} />
            <h2 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {count === 1 ? 'Eliminare questa sbobina?' : `Eliminare ${count} sbobine?`}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="icon-button modal-icon-button"
            aria-label="Chiudi finestra"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 text-sm space-y-3" style={{ color: 'var(--text-secondary)' }}>
          <div className="p-3 rounded-xl border space-y-1.5" style={{ background: 'var(--bg-input)', borderColor: 'var(--border-subtle)' }}>
            {previewList.map(s => (
              <div key={s.sessionDir} className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                • {s.name}
              </div>
            ))}
            {remainingCount > 0 && (
              <div className="text-xs italic pt-1" style={{ color: 'var(--text-muted)' }}>
                …e altre {remainingCount} {remainingCount === 1 ? 'sbobina' : 'sbobine'}
              </div>
            )}
          </div>

          <p style={{ color: 'var(--text-muted)' }}>
            Tutti i file e i dati di sessione relativi verranno eliminati definitivamente dal disco.{' '}
            <strong style={{ color: 'var(--error-text)' }}>L&apos;operazione è irreversibile.</strong>
          </p>
        </div>

        <div className="px-5 py-4 flex gap-3 shrink-0" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick={onClose} className="modal-action-button flex-1">
            Annulla
          </button>
          <button
            onClick={onConfirm}
            className="modal-action-button is-danger flex-1"
          >
            {count === 1 ? 'Elimina definitivamente' : `Elimina ${count} sbobine`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

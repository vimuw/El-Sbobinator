import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import type { ArchiveSession } from '../../bridge';
import { modalCard } from '../../motion';

export function RenameSessionModal({ session, onSave, onClose }: {
  session: ArchiveSession;
  onSave: (sessionDir: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(session.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/') event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!pendingRef.current) onCloseRef.current();
      }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => {
      window.removeEventListener('keydown', handler, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const title = name.trim();
    if (!title || title.length > 200 || pendingRef.current) return;
    pendingRef.current = true;
    setSaving(true);
    setError('');
    try {
      await onSave(session.session_dir, title);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      pendingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <motion.div className="fixed inset-0 z-[60] flex items-center justify-center p-4" exit={{ opacity: 0 }}>
      <div className="modal-overlay absolute inset-0" />
      <motion.div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId}
        className="modal-card relative w-full max-w-md overflow-hidden" {...modalCard}>
        <div className="modal-header">
          <h2 id={titleId} className="text-lg font-semibold">Rinomina sbobina</h2>
          <button type="button" className="icon-button modal-icon-button" aria-label="Chiudi finestra" disabled={saving} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={handleSubmit} aria-busy={saving}>
          <div className="modal-body space-y-3">
            <label htmlFor={inputId} className="text-xs font-semibold block">Nome sbobina</label>
            <input ref={inputRef} id={inputId} className="app-input w-full text-sm" type="text" maxLength={200}
              value={name} readOnly={saving} onChange={event => { setName(event.target.value); setError(''); }}
              aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
            {error && <p id={errorId} role="alert" className="text-sm text-[var(--error-text)]">{error}</p>}
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} disabled={saving} className="modal-action-button flex-1">Annulla</button>
            <button type="submit" disabled={saving || !name.trim() || name.trim().length > 200} className="modal-action-button is-primary flex-1">{saving ? 'Salvataggio…' : 'Salva'}</button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}

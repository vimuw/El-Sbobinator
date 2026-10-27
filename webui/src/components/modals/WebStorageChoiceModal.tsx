import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cloud, HardDrive } from 'lucide-react';
import type { DriveStatus } from '../../bridge';
import { modalCard } from '../../motion';
import { LOCAL_ONLY_WARNING, loadStorageChoice, saveStorageChoice } from './settings/webStorageChoice';

// Web previews with Drive sync: "Dove tengo le sbobine?", asked once, when the first sbobina is done
// (or at the first visit if the archive already has some). The answer can change in the settings.

interface WebStorageChoicePromptProps {
  /** Sbobine in the archive: the question waits for the first one. */
  sessionCount: number;
  /** A run, the editor or the settings are open: the question waits for the dashboard. */
  blocked: boolean;
  /** What the Drive connection started from the question ended with. */
  onConnectResult?: (status: DriveStatus) => void;
}

export function WebStorageChoicePrompt({ sessionCount, blocked, onConnectResult }: WebStorageChoicePromptProps) {
  const [open, setOpen] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  const api = window.pywebview?.api;
  const available = Boolean(api?.get_drive_status && api.connect_drive);

  useEffect(() => {
    if (!available || open || blocked || sessionCount === 0 || loadStorageChoice() !== null) return;
    let cancelled = false;
    void api!.get_drive_status!().then(status => {
      if (cancelled) return;
      // Linked before the question existed: the answer is already given.
      if (status.connected) saveStorageChoice('drive');
      else setOpen(true);
    }, () => {});
    return () => { cancelled = true; };
  }, [available, open, blocked, sessionCount, api]);

  const chooseDrive = () => {
    saveStorageChoice('drive');
    // Inside the tap: connect_drive opens the Google window.
    const connecting = api?.connect_drive?.();
    setOpen(false);
    void connecting?.then(status => onConnectResult?.(status), () => {});
  };
  const chooseBrowser = () => {
    saveStorageChoice('browser');
    setLocalOnly(true);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape answers nothing: the question comes back at the next visit.
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div exit={{ opacity: 0 }} className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="modal-overlay absolute inset-0" />
          <motion.div
            {...modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="web-storage-choice-title"
            className="modal-card relative w-full max-w-md max-h-[86vh] overflow-y-auto flex flex-col"
          >
            <div className="modal-header">
              <h2 id="web-storage-choice-title" className="text-lg font-semibold text-[var(--text-primary)]">Dove tengo le sbobine?</h2>
            </div>
            {!localOnly ? (
              <div className="modal-body space-y-3">
                <button type="button" onClick={chooseBrowser} className="w-full text-left p-3 rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-input)] flex gap-3">
                  <HardDrive className="w-5 h-5 shrink-0 mt-0.5 text-[var(--text-secondary)]" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-bold text-[var(--text-primary)]">Solo in questo browser</span>
                    <span className="block text-xs text-[var(--text-secondary)]">Tutto resta su questo dispositivo, come ora.</span>
                  </span>
                </button>
                <button type="button" onClick={chooseDrive} className="w-full text-left p-3 rounded-xl border border-[var(--border-subtle)] hover:bg-[var(--bg-input)] flex gap-3">
                  <Cloud className="w-5 h-5 shrink-0 mt-0.5 text-[var(--accent-text)]" />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-bold text-[var(--text-primary)]">In questo browser + Google Drive</span>
                    <span className="block text-xs text-[var(--text-secondary)]">Una copia va nella cartella nascosta dell’app sul tuo Drive: ritrovi le sbobine sugli altri dispositivi. Audio e chiavi restano qui.</span>
                  </span>
                </button>
                <p className="text-xs text-[var(--text-muted)]">Puoi cambiare idea in Impostazioni → Archiviazione.</p>
              </div>
            ) : (
              <div className="modal-body space-y-3">
                <p role="note" className="text-sm text-[var(--text-primary)]">{LOCAL_ONLY_WARNING}</p>
                <p className="text-xs text-[var(--text-muted)]">Il backup e Google Drive sono in Impostazioni → Archiviazione.</p>
              </div>
            )}
            {localOnly && (
              <div className="modal-footer">
                <button type="button" onClick={() => setOpen(false)} className="modal-action-button flex-1">Ho capito</button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

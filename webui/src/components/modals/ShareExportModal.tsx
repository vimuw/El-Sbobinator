import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, Package, FileText, Music, CheckCircle2, AlertCircle, Loader2, FolderOpen } from 'lucide-react';
import type { ArchiveSession } from '../../bridge';

interface ShareExportModalProps {
  session: ArchiveSession | null;
  onClose: () => void;
}

export function ShareExportModal({ session, onClose }: ShareExportModalProps) {
  const [exportType, setExportType] = useState<'full' | 'text_only' | 'audio_only'>('full');
  const [isProcessing, setIsProcessing] = useState(false);
  const [exportedPath, setExportedPath] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!session) return null;

  const handleExportFile = async () => {
    setIsProcessing(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    setExportedPath(null);

    try {
      if (window.pywebview?.api?.export_sbobina_package) {
        const res = await window.pywebview.api.export_sbobina_package(
          session.session_dir,
          exportType,
        );
        if (res.cancelled) {
          setIsProcessing(false);
          return;
        }
        if (res.ok) {
          setExportedPath(res.target_path || null);
          setSuccessMsg(
            `Pacchetto .sbobina salvato con successo! ${res.audio_included ? '(Audio incluso)' : ''}`
          );
        } else {
          setErrorMsg(res.error || 'Impossibile esportare il pacchetto.');
        }
      } else {
        setErrorMsg('La funzionalità di esportazione richiede l\'applicazione desktop.');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Errore imprevisto durante l\'esportazione.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleOpenFolder = () => {
    if (exportedPath && window.pywebview?.api?.open_file) {
      const folderPath = exportedPath.replace(/[/\\][^/\\]+$/, '');
      window.pywebview.api.open_file(folderPath);
    }
  };

  return (
    <AnimatePresence>
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
          style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(4px)' }}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1, transition: { duration: 0.18, ease: [0.22, 1, 0.36, 1] } }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14, ease: 'easeIn' } }}
          className="modal-card relative w-full max-w-lg overflow-hidden flex flex-col"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            borderRadius: 16,
            boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)' }}>
                <Package className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  Esporta Pacchetto Sbobina
                </h2>
                <p className="text-xs truncate opacity-70" style={{ color: 'var(--text-muted)' }}>
                  {session.name}
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

          {/* Body */}
          <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
            {/* Option Cards */}
            <div className="space-y-2.5">
              <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: 'var(--text-muted)' }}>
                Cosa desideri includere nel pacchetto?
              </label>

              {/* Option 1: Sbobina + Audio */}
              <div
                onClick={() => setExportType('full')}
                className="p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5"
                style={{
                  borderColor: exportType === 'full' ? 'var(--accent-bg)' : 'var(--border-default)',
                  background: exportType === 'full' ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                }}
              >
                <div
                  className="mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: exportType === 'full' ? 'var(--accent-bg)' : 'var(--border-strong)',
                    background: exportType === 'full' ? 'var(--accent-bg)' : 'transparent',
                  }}
                >
                  {exportType === 'full' && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Sbobina + Audio (Completo)
                    </span>
                    <span
                      className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-md"
                      style={{ background: 'var(--accent-bg)', color: '#ffffff' }}
                    >
                      Consigliato
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Include la sbobina completa (HTML, revisioni) e la traccia audio per riascoltarla sul nuovo PC.
                  </p>
                </div>
              </div>

              {/* Option 2: Solo Sbobina */}
              <div
                onClick={() => setExportType('text_only')}
                className="p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5"
                style={{
                  borderColor: exportType === 'text_only' ? 'var(--accent-bg)' : 'var(--border-default)',
                  background: exportType === 'text_only' ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                }}
              >
                <div
                  className="mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: exportType === 'text_only' ? 'var(--accent-bg)' : 'var(--border-strong)',
                    background: exportType === 'text_only' ? 'var(--accent-bg)' : 'transparent',
                  }}
                >
                  {exportType === 'text_only' && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Solo Sbobina (Leggero)
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Include solo il testo della sbobina e i dati di sessione. File di dimensioni ridotte.
                  </p>
                </div>
              </div>

              {/* Option 3: Solo Audio */}
              <div
                onClick={() => setExportType('audio_only')}
                className="p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3.5"
                style={{
                  borderColor: exportType === 'audio_only' ? 'var(--accent-bg)' : 'var(--border-default)',
                  background: exportType === 'audio_only' ? 'var(--accent-subtle)' : 'var(--bg-surface)',
                }}
              >
                <div
                  className="mt-0.5 w-5 h-5 rounded-full border flex items-center justify-center shrink-0"
                  style={{
                    borderColor: exportType === 'audio_only' ? 'var(--accent-bg)' : 'var(--border-strong)',
                    background: exportType === 'audio_only' ? 'var(--accent-bg)' : 'transparent',
                  }}
                >
                  {exportType === 'audio_only' && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4" style={{ color: 'var(--accent-text)' }} />
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Solo Audio
                    </span>
                  </div>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    Esporta solo la registrazione audio originale per la condivisione diretta.
                  </p>
                </div>
              </div>
            </div>

            {/* Error or Success notification */}
            {errorMsg && (
              <div className="p-3.5 rounded-xl flex items-center gap-3 text-xs border" style={{ background: 'var(--error-subtle)', borderColor: 'var(--error-ring)', color: 'var(--error-text)' }}>
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="p-3.5 rounded-xl flex flex-col gap-2.5 text-xs border" style={{ background: 'var(--accent-subtle)', borderColor: 'var(--accent-ring)', color: 'var(--text-primary)' }}>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--accent-text)' }} />
                  <span>{successMsg}</span>
                </div>
                {exportedPath && (
                  <button
                    type="button"
                    onClick={handleOpenFolder}
                    className="inline-flex items-center gap-1.5 self-start text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all"
                    style={{
                      background: 'var(--bg-surface)',
                      borderColor: 'var(--border-default)',
                      color: 'var(--accent-text)',
                      cursor: 'pointer',
                    }}
                  >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span>Apri cartella del pacchetto</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Footer centered */}
          <div
            className="flex items-center justify-center gap-3 px-6 py-4 border-t"
            style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-panel)' }}
          >
            <button
              type="button"
              onClick={handleExportFile}
              disabled={isProcessing}
              className="inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm disabled:opacity-50"
              style={{
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
              }}
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin text-white" /> : <Download className="w-4 h-4 text-white" />}
              <span>Esporta Pacchetto (.sbobina)</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

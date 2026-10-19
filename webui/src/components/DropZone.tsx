import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, UploadCloud } from 'lucide-react';
import { fade } from '../motion';

// The page (QueuePage) owns the drag handlers: the card only reflects the state,
// so moving across its children never toggles the highlight on and off.
interface DropZoneProps {
  isDragging: boolean;
  onClick: () => void;
  compact?: boolean;
}

export const SUPPORTED_FORMATS = '.mp3 · .m4a · .wav · .mp4 · .mkv · .webm · .ogg · .flac · .aac';
export const SUPPORTED_FORMATS_SUMMARY = 'Audio o video · MP3, M4A, WAV, MP4 e altri';
const FORMATS_TITLE = `Formati supportati: ${SUPPORTED_FORMATS}`;

function activateOnKey(onClick: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
}

export const DropZone = memo(function DropZone({ isDragging, onClick, compact = false }: DropZoneProps) {
  if (compact) {
    return (
      <div
        onClick={onClick}
        onKeyDown={activateOnKey(onClick)}
        className={`dropzone-compact cursor-pointer flex items-center gap-3 px-4${isDragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Aggiungi file audio o video"
        title={FORMATS_TITLE}
      >
        <span className="dropzone-compact-icon" aria-hidden="true">
          <Plus className="w-3.5 h-3.5" />
        </span>
        <span className="dropzone-compact-label text-sm">
          {isDragging ? 'Rilascia qui per aggiungere' : 'Trascina file o clicca per aggiungere'}
        </span>
        <span className="ml-auto text-xs hidden sm:block text-[var(--text-faint)]">
          MP3, M4A, WAV, MP4 e altri
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
      className={`dropzone-card relative cursor-pointer flex flex-col items-center justify-center py-14 px-6 text-center${isDragging ? ' is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Trascina i file qui o clicca per sfogliare"
    >
      <div className={`dropzone-icon-container${isDragging ? ' is-dragging' : ''}`}>
        <UploadCloud className="w-6 h-6" />
      </div>
      <h3 className="text-base font-semibold mb-1 text-[var(--text-primary)] tracking-tight">Trascina i file qui</h3>
      <p className="text-xs max-w-xs text-[var(--text-muted)]" title={FORMATS_TITLE}>
        {SUPPORTED_FORMATS_SUMMARY}
      </p>
      {/* Visual only: the whole card is the button, so this must not be a nested control. */}
      <span className="dropzone-browse-button" aria-hidden="true">
        Sfoglia file
      </span>
    </div>
  );
});

// Full-window drop target shown while a file is dragged anywhere over the page.
// It never takes pointer events, so the drop still lands on the page underneath.
export const DropOverlay = memo(function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div key="drop-overlay" data-testid="drop-overlay" className="drop-overlay" aria-hidden="true" {...fade}>
          <div className="drop-overlay-target">
            <div className="dropzone-icon-container is-dragging">
              <UploadCloud className="w-6 h-6" />
            </div>
            <p className="drop-overlay-title">Rilascia per aggiungere</p>
            <p className="text-xs text-[var(--text-muted)]">{SUPPORTED_FORMATS_SUMMARY}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

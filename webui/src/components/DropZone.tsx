import { memo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, UploadCloud } from 'lucide-react';
import { fade } from '../motion';
import { getHostCapabilities } from '../hostCapabilities';

// The page (QueuePage) owns the drag handlers: the card only reflects the state,
// so moving across its children never toggles the highlight on and off.
interface DropZoneProps {
  isDragging: boolean;
  onClick: () => void;
  compact?: boolean;
}

export const SUPPORTED_FORMATS = '.mp3 · .m4a · .wav · .mp4 · .mkv · .webm · .ogg · .flac · .aac';
export const SUPPORTED_FORMATS_SUMMARY = 'Audio o video · MP3, M4A, WAV, MP4 e altri';
// The web build cuts audio in the browser without re-encoding, which only works for these.
const WEB_FORMATS = '.mp3 · .m4a · .mp4';
const WEB_FORMATS_SUMMARY = 'Audio o video · MP3, M4A o MP4';

function formatHints() {
  const web = getHostCapabilities().kind === 'web';
  return {
    title: `Formati supportati: ${web ? WEB_FORMATS : SUPPORTED_FORMATS}`,
    summary: web ? WEB_FORMATS_SUMMARY : SUPPORTED_FORMATS_SUMMARY,
    short: web ? 'MP3, M4A o MP4' : 'MP3, M4A, WAV, MP4 e altri',
  };
}

// The resting twin of the processing banner's hero icon: a round icon on a soft halo.
// While a file hovers the page the halo breathes and a ring leaves the icon on the banner's beat.
function DropIcon({ live }: { live: boolean }) {
  return (
    <span className={`dropzone-icon-wrap${live ? ' is-live' : ''}`} aria-hidden="true">
      <span className="dropzone-glow" />
      {live && <span className="dropzone-ring" data-testid="dropzone-ring" />}
      <span className="dropzone-icon">
        <UploadCloud className="w-6 h-6" />
      </span>
    </span>
  );
}

function activateOnKey(onClick: () => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
}

export const DropZone = memo(function DropZone({ isDragging, onClick, compact = false }: DropZoneProps) {
  const formats = formatHints();
  if (compact) {
    return (
      <div
        onClick={onClick}
        onKeyDown={activateOnKey(onClick)}
        className={`dropzone-compact cursor-pointer flex items-center gap-3${isDragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Aggiungi file audio o video"
        title={formats.title}
      >
        <span className="dropzone-compact-icon" aria-hidden="true">
          {isDragging && <span className="dropzone-ring" data-testid="dropzone-ring" />}
          <Plus className="w-3.5 h-3.5" />
        </span>
        <span className="dropzone-compact-label text-sm">
          {isDragging ? 'Rilascia qui per aggiungere' : 'Trascina file o clicca per aggiungere'}
        </span>
        <span className="ml-auto text-xs hidden sm:block text-[var(--text-faint)]">
          {formats.short}
        </span>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      onKeyDown={activateOnKey(onClick)}
      className={`dropzone-card relative cursor-pointer flex flex-col items-center justify-center py-12 px-6 text-center${isDragging ? ' is-dragging' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Trascina i file qui o clicca per sfogliare"
    >
      <DropIcon live={isDragging} />
      <h3 className="dropzone-title">Trascina i file qui</h3>
      <p className="text-xs max-w-xs text-[var(--text-muted)]" title={formats.title}>
        {formats.summary}
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
            <DropIcon live />
            <p className="drop-overlay-title">Rilascia per aggiungere</p>
            <p className="text-xs text-[var(--text-muted)]">{formatHints().summary}</p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

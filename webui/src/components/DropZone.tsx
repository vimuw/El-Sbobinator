import { Plus, UploadCloud } from 'lucide-react';

interface DropZoneProps {
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClick: () => void;
  compact?: boolean;
}

export function DropZone({ isDragging, onDragOver, onDragLeave, onDrop, onClick, compact = false }: DropZoneProps) {
  if (compact) {
    return (
      <div
        onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
        className={`dropzone-compact cursor-pointer flex items-center gap-3 px-4 group${isDragging ? ' is-dragging' : ''}`}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onClick()}
        aria-label="Aggiungi file audio o video"
      >
        <div
          className="shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors duration-150"
          style={{
            background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            color: isDragging ? 'var(--accent-bg)' : 'var(--text-muted)',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
        </div>
        <span className="text-sm" style={{ color: isDragging ? 'var(--accent-bg)' : 'var(--text-secondary)', fontWeight: isDragging ? 500 : 400 }}>
          {isDragging ? 'Rilascia qui per aggiungere' : 'Trascina file o clicca per aggiungere'}
        </span>
        <span className="ml-auto text-xs hidden sm:block" style={{ color: 'var(--text-faint)' }}>
          .mp3 .m4a .mp4 ...
        </span>
      </div>
    );
  }

  return (
    <div
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
      className={`dropzone-card relative cursor-pointer flex flex-col items-center justify-center py-10 px-6 text-center group${isDragging ? ' is-dragging' : ''}`}
    >
      <div
        className="w-12 h-12 mb-4 rounded-xl flex items-center justify-center transition-colors duration-200"
        style={{
          background: isDragging ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
          border: '1px solid var(--border-default)',
        }}
      >
        <UploadCloud className="w-6 h-6" style={{ color: isDragging ? 'var(--accent-bg)' : 'var(--text-muted)' }} />
      </div>
      <h3 className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>Trascina i file qui</h3>
      <p className="text-xs max-w-xs" style={{ color: 'var(--text-muted)' }}>
        .mp3 · .m4a · .wav · .mp4 · .mkv · .webm · .ogg · .flac · .aac
      </p>
      <div
        className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-150"
        style={{ background: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-ring)' }}
      >
        Sfoglia file
      </div>
    </div>
  );
}

import React from 'react';
import { motion } from 'motion/react';
import { AlertCircle, AlertTriangle, CheckCircle, Clock, ExternalLink, FileAudio, FolderOpen, GripVertical, PenLine, RotateCcw, Settings, Trash2, XCircle } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { AppStatus, FileItem } from '../appState';
import type { ArchiveFolder } from '../bridge';
import { errorLabel, formatDuration, formatRelativeTime, formatSize, isQuotaError, isResumableError, shortModelName } from '../utils';
import { KebabMenu, type KebabMenuItem } from './KebabMenu';

interface QueueFileCardProps {
  file: FileItem;
  appState: AppStatus;
  currentPhase?: string;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onOpenSettings?: () => void;
  /** @deprecated kept for interface compatibility */
}

function abbreviatePath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join('/')}`;
}

function QueueFileCardInner({
  file, appState, currentPhase: _currentPhase,
  onRemove,
  onRetry,
  onPreview: _onPreview,
  onOpenFile: _onOpenFile,
  onOpenSettings,
}: QueueFileCardProps) {
  const isCanceling = appState === 'canceling' && file.status === 'processing';
  const isDraggable = file.status === 'queued' && appState === 'idle';
  const isPhase1ChunkFailure = Boolean(file.errorText?.startsWith('phase1_chunk_failed_'));
  const { attributes, listeners, setNodeRef, transform, transition: dndTransition, isDragging } = useSortable({
    id: file.id,
    disabled: !isDraggable,
  });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition: dndTransition ?? undefined,
    zIndex: isDragging ? 50 : undefined,
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={sortableStyle} {...attributes}>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: isDragging ? 0.4 : 1, y: 0 }}
        exit={{ opacity: 0, transition: { duration: 0.11, ease: 'easeIn' } }}
        transition={{
          opacity: { duration: 0.18, ease: 'easeOut' },
          y: { type: 'spring', stiffness: 400, damping: 32, mass: 0.7 },
        }}
        className={`queue-card relative transition-colors ${file.status === 'processing' ? (isCanceling ? 'canceling-card' : 'processing-card') : ''} px-4 py-3`}
        style={{
          border: `1px solid ${
            file.status === 'processing'
              ? isCanceling ? 'var(--error-ring)' : 'var(--processing-ring)'
              : file.status === 'error'
                ? 'var(--error-ring)'
                : 'var(--card-queued-border)'
          }`,
          boxShadow: (file.status === 'processing' || file.status === 'error')
            ? `inset 3px 0 0 ${(isCanceling || file.status === 'error') ? 'var(--error-ring)' : 'var(--processing-ring)'}`
            : 'none',
          background: file.status === 'error' ? 'var(--error-subtle)' : 'var(--card-queued-bg)',
        }}
      >
        <div className="relative z-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 overflow-hidden flex-1">
            {isDraggable && (
              <div className="group/drag flex items-center shrink-0 gap-1">
                <button
                  {...listeners}
                  className="drag-handle-btn"
                  tabIndex={-1}
                  aria-label="Trascina per riordinare"
                >
                  <GripVertical className="w-4 h-4" />
                </button>
              </div>
            )}
            <div
              className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
              style={{
                background: 'transparent',
                color: file.status === 'processing'
                  ? isCanceling ? 'var(--error-text)' : 'var(--processing-text)'
                  : file.status === 'error'
                    ? 'var(--error-text)'
                    : 'var(--text-muted)',
              }}
            >
              {file.status === 'processing'
                ? isCanceling
                  ? <XCircle className="w-5 h-5" />
                  : <Clock className="w-5 h-5 animate-pulse" />
                : file.status === 'error'
                  ? <AlertCircle className="w-5 h-5" />
                  : <FileAudio className="w-5 h-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-semibold truncate tracking-tight" style={{ color: 'var(--text-primary)' }}>{file.name}</h4>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>{formatSize(file.size)}</span>
                {file.duration > 0 && (
                  <>
                    <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                    <span>{formatDuration(file.duration)}</span>
                  </>
                )}
                {file.status === 'error' && (
                  <>
                    <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                    <span title={file.errorDetail || file.errorText} style={{ color: 'var(--error-text)' }}>{errorLabel(file.errorText, file.errorDetail)}</span>
                  </>
                )}
              </div>
              {file.status === 'processing' && (
                <motion.div
                  layout="position"
                  className="mt-2 flex min-h-7 flex-wrap items-center gap-1.5"
                  transition={{ layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] } }}
                >
                  <span className={`helper-chip processing-chip-compact ${isCanceling ? 'canceling-chip' : 'processing-chip'}`}>
                    <span className="inline-flex h-2 w-2 rounded-full animate-pulse" style={{ background: isCanceling ? 'var(--error-text)' : 'var(--processing-dot)' }} />
                    {isCanceling ? 'Annullamento in corso' : 'In elaborazione'}
                  </span>
                </motion.div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {appState === 'idle' && file.status === 'error' && onOpenSettings && isQuotaError(file.errorText) && (
              <button
                onClick={onOpenSettings}
                className="premium-button-secondary compact-button"
                title="Aggiungi una chiave API di riserva per evitare interruzioni"
                aria-label="Chiavi di riserva"
              >
                <Settings className="w-3.5 h-3.5" />
                Chiavi di riserva
              </button>
            )}
            {appState === 'idle' && file.status === 'error' && (
              isResumableError(file.errorText) || isPhase1ChunkFailure ? (
                <button
                  onClick={() => onRetry(file.id)}
                  className="premium-button-secondary compact-button"
                  style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderColor: 'transparent' }}
                  title={isPhase1ChunkFailure ? 'I blocchi precedenti sono salvati: riprendi dal blocco fallito' : 'Il progresso è salvato: riprendi da dove è rimasto'}
                  aria-label="Riprendi"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Riprendi
                </button>
              ) : (
                <button
                  onClick={() => onRetry(file.id)}
                  className="icon-button compact-icon-button is-danger"
                  title="Riprova"
                  aria-label="Riprova"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )
            )}
            {appState === 'idle' && (
              <button
                onClick={() => onRemove(file.id)}
                className="icon-button compact-icon-button is-danger"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

      </motion.div>
    </div>
  );
}

export const QueueFileCard = React.memo(QueueFileCardInner);

interface CompletedFileCardProps {
  file: FileItem;
  isNewest: boolean;
  onRemove: (id: string) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string) => void;
  onOpenFile: (path: string) => void;
  onRetryFailedRevisionBlocks?: (sessionDir: string, fileId?: string) => Promise<void>;
  currentFolder?: Pick<ArchiveFolder, 'name' | 'color'>;
}

function CompletedFileCardInner({ file, isNewest, onRemove, onPreview, onOpenFile, onRetryFailedRevisionBlocks, currentFolder }: CompletedFileCardProps) {
  const isClickable = Boolean(file.outputHtml);
  const [isRetryingBlocks, setIsRetryingBlocks] = React.useState(false);
  const failedBlockCount = file.revisionFailedBlocks?.length ?? 0;
  const hasRevisionWarnings = file.completionStatus === 'completed_with_warnings' || failedBlockCount > 0;
  const canRetryBlocks = failedBlockCount > 0 && Boolean(file.outputDir) && Boolean(onRetryFailedRevisionBlocks);
  const handleRetryBlocks = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!canRetryBlocks || !file.outputDir || isRetryingBlocks) return;
    setIsRetryingBlocks(true);
    try {
      await onRetryFailedRevisionBlocks?.(file.outputDir, file.id);
    } finally {
      setIsRetryingBlocks(false);
    }
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.11, ease: 'easeIn' } }}
      transition={{
        opacity: { duration: 0.2, ease: 'easeOut' },
        y: { type: 'spring', stiffness: 380, damping: 30, mass: 0.8 },
      }}
      onClick={isClickable ? () => onPreview(file.outputHtml!, file.name, file.path, file.id, file.outputDir) : undefined}
      className={`queue-card relative px-4 py-3 transition-colors group/card ${isClickable ? 'cursor-pointer' : ''}`}
      style={{
        border: `1px solid ${hasRevisionWarnings ? 'var(--warning-ring)' : 'var(--success-ring)'}`,
        boxShadow: `inset 3px 0 0 ${hasRevisionWarnings ? 'var(--warning-ring)' : 'var(--success-ring)'}${isNewest && !hasRevisionWarnings ? ', 0 0 0 2px rgba(22,163,74,0.08)' : ''}`,
        background: hasRevisionWarnings ? 'var(--warning-subtle)' : isNewest ? 'var(--success-subtle)' : 'var(--card-queued-bg)',
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 overflow-hidden flex-1">
          <div
            className="shrink-0 flex items-center justify-center w-8 h-8 rounded-lg"
            style={{ background: 'transparent', color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--success-text)' }}
          >
            {hasRevisionWarnings ? <AlertTriangle className="w-4.5 h-4.5" /> : <CheckCircle className="w-4.5 h-4.5" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 min-w-0">
              <h4 className="text-sm font-semibold truncate tracking-tight" style={{ color: 'var(--text-primary)' }}>{file.name}</h4>
              {currentFolder && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: `${currentFolder.color}22`, color: currentFolder.color, border: `1px solid ${currentFolder.color}55` }}
                  title={`Raccolta: ${currentFolder.name}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: currentFolder.color }} />
                  {currentFolder.name}
                </span>
              )}
              {isNewest && (
                <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ background: 'var(--success-subtle)', color: 'var(--success-text)', border: '1px solid var(--success-ring)' }}>
                  Nuovo
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{formatSize(file.size)}</span>
              {file.duration > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                  <span>{formatDuration(file.duration)}</span>
                </>
              )}
              {(file.primaryModel || file.effectiveModel) && (
                <>
                  <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                  <span title={file.primaryModel || file.effectiveModel}>
                    {shortModelName(file.primaryModel || file.effectiveModel!)}
                  </span>
                  {file.primaryModel && file.effectiveModel && file.primaryModel !== file.effectiveModel && (
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                      style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}
                      title={`Fallback usato: ${shortModelName(file.effectiveModel)}`}
                    >
                      fallback
                    </span>
                  )}
                </>
              )}
              <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
              <span style={{ color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--success-text)' }}>
                {hasRevisionWarnings ? 'Completata con avvisi' : file.completedAt ? formatRelativeTime(file.completedAt) : 'Completato'}
              </span>
              {failedBlockCount > 0 && (
                <>
                  <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}
                  >
                    <AlertTriangle className="w-3 h-3" />
                    {failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}
                  </span>
                </>
              )}
            </div>
            {canRetryBlocks && (
              <div className="mt-2 flex flex-col gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid var(--warning-ring)' }}>
                <p className="text-xs font-medium" style={{ color: 'var(--warning-text)' }}>
                  Alcune sezioni sono nella nota senza revisione AI.
                </p>
                <button
                  type="button"
                  onClick={handleRetryBlocks}
                  disabled={isRetryingBlocks}
                  className="premium-button-secondary compact-button text-xs self-start"
                  style={{ color: 'var(--warning-text)', borderColor: 'var(--warning-ring)', background: 'var(--warning-subtle)', opacity: isRetryingBlocks ? 0.65 : 1 }}
                  title="Riprova solo i blocchi inclusi senza revisione"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isRetryingBlocks ? 'animate-spin' : ''}`} />
                  {isRetryingBlocks ? 'Riprovo...' : 'Riprova revisione AI'}
                </button>
              </div>
            )}
            {file.outputHtml && (
              <div
                className="mt-1 flex items-center gap-1 text-[11px] hover:underline"
                style={{ color: 'var(--text-faint)', cursor: 'pointer' }}
                onClick={(e) => { e.stopPropagation(); onOpenFile(file.outputDir ?? file.outputHtml!); }}
                title={`Apri cartella: ${file.outputDir ?? file.outputHtml}`}
              >
                <FolderOpen className="w-3 h-3 shrink-0" />
                <span className="truncate">{abbreviatePath(file.outputHtml)}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <KebabMenu
            items={[
              ...( file.outputHtml ? [
                {
                  label: 'Modifica',
                  icon: <PenLine className="w-3.5 h-3.5" />,
                  onClick: () => onPreview(file.outputHtml!, file.name, file.path, file.id, file.outputDir),
                } as KebabMenuItem,
                {
                  label: 'Apri nel browser',
                  icon: <ExternalLink className="w-3.5 h-3.5" />,
                  onClick: () => onOpenFile(file.outputHtml!),
                } as KebabMenuItem,
              ] : []),
              {
                label: 'Rimuovi',
                icon: <Trash2 className="w-3.5 h-3.5" />,
                danger: true,
                onClick: () => onRemove(file.id),
              },
            ]}
          />
        </div>
      </div>
    </motion.div>
  );
}

export const CompletedFileCard = React.memo(CompletedFileCardInner);

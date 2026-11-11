import { Fragment, useState, type MouseEvent, type ReactNode } from 'react';
import {
  AlertTriangle, AudioLines, Check, ChevronLeft, ChevronRight, Download,
  Eye, FileText, Folder, FolderOpen, Pencil, RotateCcw, Trash2, X,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { loadAllEditorSessions, type EditorSession } from '../../editorSessions';
import { formatRelativeTime, formatSize, shortModelName } from '../../utils';
import { getHostCapabilities } from '../../hostCapabilities';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FolderIndicatorChip } from '../FolderChip';
import { MiddleTruncate } from '../MiddleTruncate';
import { usePhoneLayout } from '../../hooks/usePhoneLayout';
import { type ArchivePageProps, getOpenedAtMs, DEFAULT_FOLDER_COLOR } from './types';

interface SessionCardMetaProps {
  completedAtMs: number;
  openedAtMs: number;
  model?: string | null;
  folderIndicator?: ReactNode;
  hasRevisionWarnings: boolean;
  failedBlockCount: number;
}

// The line under a session's name. Wider screens wrap it and show everything. A phone keeps it to
// one line, so every card has the same height: only the latest activity (opened, else completed),
// as in "Ultima sbobina aperta / modificata", and one warning; the model, the collection and the
// warning take the ellipsis when the line runs out, never the time.
function SessionCardMeta({ completedAtMs, openedAtMs, model, folderIndicator, hasRevisionWarnings, failedBlockCount }: SessionCardMetaProps) {
  const isPhone = usePhoneLayout();
  const opened = openedAtMs > 0 && (
    <span className="inline-flex items-center gap-1 shrink-0" title={`Ultima apertura: ${new Date(openedAtMs).toLocaleString('it-IT')}`}>
      <Eye className="w-3 h-3 text-muted" style={{ opacity: 0.65 }} />
      Aperto {formatRelativeTime(openedAtMs)}
    </span>
  );
  const segments: { key: string; node: ReactNode; fit?: boolean }[] = [];
  if (isPhone && opened) segments.push({ key: 'opened', node: opened });
  else if (completedAtMs > 0) segments.push({ key: 'completed', node: <span className="shrink-0">{formatRelativeTime(completedAtMs)}</span> });
  if (model) segments.push({ key: 'model', node: <span className="truncate">{shortModelName(model)}</span>, fit: true });
  if (!isPhone && opened) segments.push({ key: 'opened', node: opened });
  if (folderIndicator) segments.push({ key: 'folder', node: folderIndicator, fit: true });
  if (hasRevisionWarnings && !(isPhone && failedBlockCount > 0)) {
    segments.push({ key: 'warnings', node: <span className="truncate" style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span>, fit: true });
  }
  if (failedBlockCount > 0) {
    segments.push({
      key: 'failed',
      fit: true,
      node: (
        <span className="inline-flex items-center gap-1 min-w-0 text-caption font-semibold text-[var(--warning-text)]">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          <span className="truncate">{failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}</span>
        </span>
      ),
    });
  }
  return (
    <div
      className={`session-card-meta flex items-center gap-x-2 gap-y-1 mt-0.5 text-xs min-w-0 ${isPhone ? 'flex-nowrap overflow-hidden' : 'flex-wrap'}`}
      style={{ color: 'var(--text-muted)' }}
    >
      {segments.map(({ key, node, fit }, index) => index === 0 ? <Fragment key={key}>{node}</Fragment> : (
        // The dot travels with its item, so a wrapped line never starts or ends on one.
        <span key={key} className={`inline-flex items-center gap-2 max-w-full ${fit ? 'min-w-0' : 'shrink-0'}`}>
          <span className="w-1 h-1 rounded-full shrink-0" style={{ background: 'var(--border-default)' }} />
          {node}
        </span>
      ))}
    </div>
  );
}

// Web: the audio a sbobina keeps in this browser, its share of "Audio delle sbobine" in
// Archiviazione. It sits at the card's right edge, next to the menu, so the sbobine with audio line
// up in one column down the list; a phone shows the icon alone, the size in its title. Not a button:
// a click on it opens the sbobina like the rest of the card.
function KeptAudioBadge({ bytes }: { bytes?: number }) {
  const isPhone = usePhoneLayout();
  if (!bytes || bytes <= 0) return null;
  const size = formatSize(bytes);
  return (
    <span
      data-testid="session-kept-audio"
      className={`kept-audio-badge${isPhone ? ' is-icon' : ''}`}
      title={`Audio salvato in questo browser: ${size}`}
    >
      <AudioLines className="w-3 h-3 shrink-0" aria-hidden="true" />
      <span className="sr-only">Audio salvato: </span>
      <span className={isPhone ? 'sr-only' : undefined}>{size}</span>
    </span>
  );
}

export interface DraggableSessionCardProps {
  session: ArchiveSession;
  allFolders: ArchiveFolder[];
  currentFolder?: ArchiveFolder;
  editorSessionsMap?: Record<string, EditorSession>;
  selected?: boolean;
  onToggleSelect?: () => void;
  onAssignToFolder: (folderId: string) => void;
  onRemoveFromFolder: () => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
  onShareSession?: (session: ArchiveSession) => void;
  onRenameSession?: (session: ArchiveSession) => void;
  onMove?: () => void;
}

export function DraggableSessionCard({
  session,
  allFolders,
  currentFolder,
  editorSessionsMap,
  selected,
  onToggleSelect,
  onAssignToFolder,
  onRemoveFromFolder,
  onPreview,
  onOpenFile,
  onDeleteSession,
  onRetryFailedRevisionBlocks,
  onShareSession,
  onRenameSession,
  onMove,
}: DraggableSessionCardProps) {
  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const openedAtMs = getOpenedAtMs(session, editorSessionsMap ?? loadAllEditorSessions());
  const [isRetryingBlocks, setIsRetryingBlocks] = useState(false);
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  const canRetryBlocks = failedBlockCount > 0 && Boolean(onRetryFailedRevisionBlocks);

  const handleRetryBlocks = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canRetryBlocks || isRetryingBlocks) return;
    setIsRetryingBlocks(true);
    try {
      await onRetryFailedRevisionBlocks?.(session.session_dir);
    } finally {
      setIsRetryingBlocks(false);
    }
  };

  const folderChildren: KebabMenuItem[] = [
    ...(currentFolder ? [{
      label: `Rimuovi da "${currentFolder.name}"`,
      icon: <X className="w-3.5 h-3.5" />,
      onClick: onRemoveFromFolder,
    } as KebabMenuItem] : []),
    ...(currentFolder && allFolders.length > 0 ? [{ separator: true } as KebabMenuItem] : []),
    ...allFolders.map(f => ({
      label: f.name,
      icon: <span className="w-3 h-3 rounded-full inline-block" style={{ background: f.color || DEFAULT_FOLDER_COLOR }} />,
      checked: currentFolder?.id === f.id,
      onClick: () => onAssignToFolder(f.id),
    })),
  ];

  const kebabItems: KebabMenuItem[] = [
    ...(onRenameSession ? [{ label: 'Rinomina', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => onRenameSession(session) }] : []),
    ...(getHostCapabilities().openLocalPath ? [{
      label: 'Apri cartella',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path),
    } as KebabMenuItem] : []),
    ...(onShareSession ? [{
      label: 'Esporta Sbobina...',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => onShareSession(session),
    } as KebabMenuItem] : []),
    ...(onMove ? [{ label: 'Sposta in…', icon: <Folder className="w-3.5 h-3.5" />, onClick: onMove }] : folderChildren.length > 0 ? [
      { separator: true } as KebabMenuItem,
      {
        label: 'Raccolta',
        icon: <Folder className="w-3.5 h-3.5" />,
        children: folderChildren,
      } as KebabMenuItem,
    ] : []),
    ...(onMove && currentFolder ? [
      { separator: true } as KebabMenuItem,
      {
        label: 'Rimuovi dalla raccolta',
        icon: <X className="w-3.5 h-3.5" />,
        onClick: onRemoveFromFolder,
      } as KebabMenuItem,
    ] : []),
    { separator: true },
    {
      label: 'Elimina',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDeleteSession(session.session_dir, session.name),
    },
  ];

  return (
    <div
      onClick={() => onPreview(session.html_path, session.name, session.input_path, undefined, session.session_dir)}
      className={`archive-session-card flex items-center justify-between gap-3 px-4 py-3 cursor-pointer group/card ${selected ? 'is-selected' : ''} ${hasRevisionWarnings && !selected ? 'is-warning' : ''}`.trim()}
      style={{
        ...(hasRevisionWarnings && !selected ? { borderColor: 'var(--warning-ring)' } : {}),
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onToggleSelect && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className={`touch-hit relative w-4 h-4 rounded flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              selected
                ? 'bg-[var(--accent-text)] text-[var(--btn-primary-text)]'
                : 'border border-[var(--border-strong)] bg-[var(--bg-input)] hover:border-[var(--accent-text)] opacity-70 group-hover/card:opacity-100'
            }`}
            aria-label={selected ? `Deseleziona ${session.name}` : `Seleziona ${session.name}`}
            title={selected ? 'Deseleziona' : 'Seleziona'}
          >
            {selected && <Check className="w-3 h-3 stroke-[3]" />}
          </button>
        )}
        <FileText className="w-4 h-4 shrink-0 transition-transform duration-200 group-hover/card:scale-105" style={{ color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--text-muted)' }} />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]"><MiddleTruncate text={session.name} /></p>
          <SessionCardMeta
            completedAtMs={ts}
            openedAtMs={openedAtMs}
            model={session.effective_model}
            folderIndicator={currentFolder && <FolderIndicatorChip folder={currentFolder} folders={allFolders} />}
            hasRevisionWarnings={hasRevisionWarnings}
            failedBlockCount={failedBlockCount}
          />
        </div>
      </div>

      <KeptAudioBadge bytes={session.kept_audio_bytes} />
      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
        {canRetryBlocks && (
          <button
            type="button"
            onClick={handleRetryBlocks}
            disabled={isRetryingBlocks}
            className="icon-button compact-icon-button text-[var(--warning-text)] hover:bg-[var(--warning-subtle)] group/retry"
            style={{ opacity: isRetryingBlocks ? 0.65 : 1 }}
            title="Riprova solo i blocchi inclusi senza revisione"
            aria-label="Riprova revisione"
          >
            <RotateCcw className={`w-4 h-4 transition-transform duration-500 ease-out ${isRetryingBlocks ? 'animate-spin' : 'group-hover/retry:-rotate-180 group-hover/retry:scale-105'}`} />
            <span className="sr-only">{isRetryingBlocks ? 'Riprovo…' : 'Riprova revisione'}</span>
          </button>
        )}
        <KebabMenu items={kebabItems} />
      </div>
    </div>
  );
}

export function FolderSessionCardOverlay({
  session,
  folderColor,
}: {
  session: ArchiveSession;
  folderColor: string;
}) {
  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  return (
    <div
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3"
      style={{
        pointerEvents: 'none',
        boxShadow: 'var(--shadow-strong)',
        opacity: 0.95,
        cursor: 'grabbing',
        borderColor: hasRevisionWarnings ? 'var(--warning-ring)' : undefined,
        background: hasRevisionWarnings ? 'var(--warning-subtle)' : undefined,
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4" style={{ color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--text-muted)' }} />
          <span
            className="folder-color-dot absolute -bottom-0.5 -right-1"
            style={{
              '--folder-color': folderColor || DEFAULT_FOLDER_COLOR,
              width: 7,
              height: 7,
            } as React.CSSProperties}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]"><MiddleTruncate text={session.name} /></p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SortableSessionCardProps {
  session: ArchiveSession;
  folderColor: string;
  disabled: boolean;
  onRemove: () => void;
  editorSessionsMap?: Record<string, EditorSession>;
  selected?: boolean;
  onToggleSelect?: () => void;
  onPreview: ArchivePageProps['onPreview'];
  onOpenFile: ArchivePageProps['onOpenFile'];
  onDeleteSession: ArchivePageProps['onDeleteSession'];
  onRetryFailedRevisionBlocks?: ArchivePageProps['onRetryFailedRevisionBlocks'];
  onShareSession?: (session: ArchiveSession) => void;
  onRenameSession?: (session: ArchiveSession) => void;
  canMoveToPreviousPage?: boolean;
  canMoveToNextPage?: boolean;
  onMoveToPreviousPage?: () => void;
  onMoveToNextPage?: () => void;
  onMove?: () => void;
  collectionIndicator?: React.ReactNode;
}

export function SortableSessionCard({
  session,
  folderColor,
  disabled,
  onRemove,
  editorSessionsMap,
  selected,
  onToggleSelect,
  onPreview,
  onOpenFile,
  onDeleteSession,
  onRetryFailedRevisionBlocks,
  onShareSession,
  onRenameSession,
  canMoveToPreviousPage,
  canMoveToNextPage,
  onMoveToPreviousPage,
  onMoveToNextPage,
  onMove,
  collectionIndicator,
}: SortableSessionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: session.session_dir, disabled });

  const ts = session.completed_at_iso ? new Date(session.completed_at_iso).getTime() : 0;
  const openedAtMs = getOpenedAtMs(session, editorSessionsMap ?? loadAllEditorSessions());
  const [isRetryingBlocks, setIsRetryingBlocks] = useState(false);
  const failedBlockCount = session.revision_failed_blocks?.length ?? 0;
  const hasRevisionWarnings = session.completion_status === 'completed_with_warnings' || failedBlockCount > 0;
  const canRetryBlocks = failedBlockCount > 0 && Boolean(onRetryFailedRevisionBlocks);

  const handleRetryBlocks = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!canRetryBlocks || isRetryingBlocks) return;
    setIsRetryingBlocks(true);
    try {
      await onRetryFailedRevisionBlocks?.(session.session_dir);
    } finally {
      setIsRetryingBlocks(false);
    }
  };

  const kebabItems: KebabMenuItem[] = [
    ...(onRenameSession ? [{ label: 'Rinomina', icon: <Pencil className="w-3.5 h-3.5" />, onClick: () => onRenameSession(session) }] : []),
    ...(onMove ? [{ label: 'Sposta in…', icon: <Folder className="w-3.5 h-3.5" />, onClick: onMove }] : []),
    ...(getHostCapabilities().openLocalPath ? [{
      label: 'Apri cartella',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path),
    } as KebabMenuItem] : []),
    ...(onShareSession ? [{
      label: 'Esporta Sbobina...',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => onShareSession(session),
    } as KebabMenuItem] : []),
    { separator: true },
    {
      label: 'Rimuovi dalla raccolta',
      icon: <X className="w-3.5 h-3.5" />,
      onClick: onRemove,
    },
    { separator: true },
    {
      label: 'Elimina',
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      onClick: () => onDeleteSession(session.session_dir, session.name),
    },
  ];

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...(!disabled ? listeners : {})}
      onClick={() => onPreview(session.html_path, session.name, session.input_path, undefined, session.session_dir)}
      className={`archive-session-card flex items-center justify-between gap-3 px-4 py-3 group/card ${selected ? 'is-selected' : ''} ${hasRevisionWarnings && !selected ? 'is-warning' : ''}`.trim()}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: disabled ? undefined : 'none',
        cursor: isDragging ? 'grabbing' : disabled ? 'pointer' : 'grab',
        borderColor: hasRevisionWarnings && !selected ? 'var(--warning-ring)' : undefined,
      }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {onToggleSelect && (
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onToggleSelect();
            }}
            className={`touch-hit relative w-4 h-4 rounded flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              selected
                ? 'bg-[var(--accent-text)] text-[var(--btn-primary-text)]'
                : 'border border-[var(--border-strong)] bg-[var(--bg-input)] hover:border-[var(--accent-text)] opacity-70 group-hover/card:opacity-100'
            }`}
            aria-label={selected ? `Deseleziona ${session.name}` : `Seleziona ${session.name}`}
            title={selected ? 'Deseleziona' : 'Seleziona'}
          >
            {selected && <Check className="w-3 h-3 stroke-[3]" />}
          </button>
        )}
        <div className="relative flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 transition-transform duration-200 group-hover/card:scale-105" style={{ color: hasRevisionWarnings ? 'var(--warning-text)' : 'var(--text-muted)' }} />
          <span
            className="folder-color-dot absolute -bottom-0.5 -right-1"
            style={{
              '--folder-color': folderColor || DEFAULT_FOLDER_COLOR,
              width: 7,
              height: 7,
            } as React.CSSProperties}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]"><MiddleTruncate text={session.name} /></p>
          <SessionCardMeta
            completedAtMs={ts}
            openedAtMs={openedAtMs}
            model={session.effective_model}
            folderIndicator={collectionIndicator}
            hasRevisionWarnings={hasRevisionWarnings}
            failedBlockCount={failedBlockCount}
          />
        </div>
      </div>
      <KeptAudioBadge bytes={session.kept_audio_bytes} />
      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
        {canRetryBlocks && (
          <button
            type="button"
            onClick={handleRetryBlocks}
            disabled={isRetryingBlocks}
            className="icon-button compact-icon-button text-[var(--warning-text)] hover:bg-[var(--warning-subtle)] group/retry"
            style={{ opacity: isRetryingBlocks ? 0.65 : 1 }}
            title="Riprova solo i blocchi inclusi senza revisione"
            aria-label="Riprova revisione"
          >
            <RotateCcw className={`w-4 h-4 transition-transform duration-500 ease-out ${isRetryingBlocks ? 'animate-spin' : 'group-hover/retry:-rotate-180 group-hover/retry:scale-105'}`} />
            <span className="sr-only">{isRetryingBlocks ? 'Riprovo…' : 'Riprova revisione'}</span>
          </button>
        )}
        {(onMoveToPreviousPage || onMoveToNextPage) && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onMoveToPreviousPage}
              disabled={!canMoveToPreviousPage}
              className="icon-button compact-icon-button"
              style={{ color: 'var(--text-muted)' }}
              title="Sposta alla pagina precedente"
              aria-label={`Sposta ${session.name} alla pagina precedente`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onMoveToNextPage}
              disabled={!canMoveToNextPage}
              className="icon-button compact-icon-button"
              style={{ color: 'var(--text-muted)' }}
              title="Sposta alla pagina successiva"
              aria-label={`Sposta ${session.name} alla pagina successiva`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
        <KebabMenu items={kebabItems} />
      </div>
    </div>
  );
}

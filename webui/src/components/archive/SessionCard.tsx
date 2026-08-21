import { useState, type MouseEvent } from 'react';
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, Download, ExternalLink,
  Eye, FileText, FolderOpen, RefreshCw, Trash2, X,
} from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import { loadAllEditorSessions, type EditorSession } from '../../editorSessions';
import { formatRelativeTime, shortModelName } from '../../utils';
import { KebabMenu, type KebabMenuItem } from '../KebabMenu';
import { FolderIndicatorChip } from '../FolderChip';
import { type ArchivePageProps, getOpenedAtMs } from './types';

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

  const kebabItems: KebabMenuItem[] = [
    {
      label: 'Apri cartella',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path),
    },
    {
      label: 'Apri nel browser',
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path),
    },
    ...(onShareSession ? [{
      label: 'Esporta Sbobina...',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => onShareSession(session),
    } as KebabMenuItem] : []),
    ...(allFolders.length > 0 || currentFolder ? [{ separator: true } as KebabMenuItem] : []),
    ...allFolders.map(f => ({
      label: f.name,
      icon: <span className="w-3 h-3 rounded-full inline-block" style={{ background: f.color }} />,
      onClick: () => onAssignToFolder(f.id),
    })),
    ...(currentFolder ? [{
      label: `Rimuovi da "${currentFolder.name}"`,
      icon: <X className="w-3.5 h-3.5" />,
      onClick: onRemoveFromFolder,
    } as KebabMenuItem] : []),
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
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3 cursor-pointer group/card"
      style={{
        ...(hasRevisionWarnings ? { borderColor: 'var(--warning-ring)', boxShadow: 'inset 3px 0 0 var(--warning-ring)', background: 'var(--warning-subtle)' } : {}),
        ...(selected ? { borderColor: 'var(--accent-text)', boxShadow: 'inset 3px 0 0 var(--accent-text)', background: 'var(--accent-subtle)' } : {}),
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
            className={`w-4 h-4 rounded flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              selected
                ? 'bg-[var(--accent-text)] text-white'
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
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]">{session.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {openedAtMs > 0 && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <span className="inline-flex items-center gap-1 shrink-0" title={`Ultima apertura: ${new Date(openedAtMs).toLocaleString('it-IT')}`}>
                  <Eye className="w-3 h-3 text-muted" style={{ opacity: 0.65 }} />
                  Aperto {formatRelativeTime(openedAtMs)}
                </span>
              </>
            )}
            {currentFolder && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <FolderIndicatorChip folder={currentFolder} />
              </>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
            {failedBlockCount > 0 && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <span className="inline-flex items-center gap-1 text-[10px] leading-none font-semibold uppercase tracking-wider px-1.5 py-[2px] h-4 box-border rounded-full" style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}>
                  <AlertTriangle className="w-3 h-3" />{failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}
                </span>
                {canRetryBlocks && (
                  <button
                    type="button"
                    onClick={handleRetryBlocks}
                    disabled={isRetryingBlocks}
                    className="inline-flex items-center gap-1 text-[10px] leading-none font-semibold px-1.5 py-[2px] h-4 box-border rounded-full transition-opacity"
                    style={{ color: 'var(--warning-text)', border: '1px solid var(--warning-ring)', background: 'var(--warning-subtle)', opacity: isRetryingBlocks ? 0.65 : 1 }}
                    title="Riprova solo i blocchi inclusi senza revisione"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isRetryingBlocks ? 'animate-spin' : ''}`} />
                    {isRetryingBlocks ? 'Riprovo…' : 'Riprova revisione'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <div onClick={e => e.stopPropagation()}>
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
        <span className="folder-color-dot is-large" style={{ '--folder-color': folderColor } as React.CSSProperties} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]">{session.name}</p>
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
  canMoveToPreviousPage?: boolean;
  canMoveToNextPage?: boolean;
  onMoveToPreviousPage?: () => void;
  onMoveToNextPage?: () => void;
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
  canMoveToPreviousPage,
  canMoveToNextPage,
  onMoveToPreviousPage,
  onMoveToNextPage,
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
    {
      label: 'Apri cartella',
      icon: <FolderOpen className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path.replace(/[/\\][^/\\]+$/, '') || session.html_path),
    },
    {
      label: 'Apri nel browser',
      icon: <ExternalLink className="w-3.5 h-3.5" />,
      onClick: () => onOpenFile(session.html_path),
    },
    ...(onShareSession ? [{
      label: 'Esporta Sbobina...',
      icon: <Download className="w-3.5 h-3.5" />,
      onClick: () => onShareSession(session),
    } as KebabMenuItem] : []),
    { separator: true },
    {
      label: 'Rimuovi dalla cartella',
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
      className="archive-session-card flex items-center justify-between gap-3 px-4 py-3 group/card"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        touchAction: disabled ? undefined : 'none',
        cursor: isDragging ? 'grabbing' : disabled ? 'pointer' : 'grab',
        borderColor: selected ? 'var(--accent-text)' : (hasRevisionWarnings ? 'var(--warning-ring)' : undefined),
        boxShadow: selected ? 'inset 3px 0 0 var(--accent-text)' : (hasRevisionWarnings ? 'inset 3px 0 0 var(--warning-ring)' : undefined),
        background: selected ? 'var(--accent-subtle)' : (hasRevisionWarnings ? 'var(--warning-subtle)' : undefined),
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
            className={`w-4 h-4 rounded flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              selected
                ? 'bg-[var(--accent-text)] text-white'
                : 'border border-[var(--border-strong)] bg-[var(--bg-input)] hover:border-[var(--accent-text)] opacity-70 group-hover/card:opacity-100'
            }`}
            aria-label={selected ? `Deseleziona ${session.name}` : `Seleziona ${session.name}`}
            title={selected ? 'Deseleziona' : 'Seleziona'}
          >
            {selected && <Check className="w-3 h-3 stroke-[3]" />}
          </button>
        )}
        <span className="folder-color-dot is-large transition-transform duration-200 group-hover/card:scale-105" style={{ '--folder-color': folderColor } as React.CSSProperties} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate tracking-tight text-[var(--text-primary)]">{session.name}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            {ts > 0 && <span>{formatRelativeTime(ts)}</span>}
            {session.effective_model && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span>{shortModelName(session.effective_model)}</span></>
            )}
            {openedAtMs > 0 && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <span className="inline-flex items-center gap-1 shrink-0" title={`Ultima apertura: ${new Date(openedAtMs).toLocaleString('it-IT')}`}>
                  <Eye className="w-3 h-3 text-muted" style={{ opacity: 0.65 }} />
                  Aperto {formatRelativeTime(openedAtMs)}
                </span>
              </>
            )}
            {hasRevisionWarnings && (
              <><span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} /><span style={{ color: 'var(--warning-text)', fontWeight: 600 }}>Completata con avvisi</span></>
            )}
            {failedBlockCount > 0 && (
              <>
                <span className="w-1 h-1 rounded-full" style={{ background: 'var(--border-default)' }} />
                <span className="inline-flex items-center gap-1 text-[10px] leading-none font-semibold uppercase tracking-wider px-1.5 py-[2px] h-4 box-border rounded-full" style={{ background: 'var(--warning-subtle)', color: 'var(--warning-text)', border: '1px solid var(--warning-ring)' }}>
                  <AlertTriangle className="w-3 h-3" />{failedBlockCount} {failedBlockCount === 1 ? 'blocco non revisionato' : 'blocchi non revisionati'}
                </span>
                {canRetryBlocks && (
                  <button
                    type="button"
                    onClick={handleRetryBlocks}
                    disabled={isRetryingBlocks}
                    className="inline-flex items-center gap-1 text-[10px] leading-none font-semibold px-1.5 py-[2px] h-4 box-border rounded-full transition-opacity"
                    style={{ color: 'var(--warning-text)', border: '1px solid var(--warning-ring)', background: 'var(--warning-subtle)', opacity: isRetryingBlocks ? 0.65 : 1 }}
                    title="Riprova solo i blocchi inclusi senza revisione"
                  >
                    <RefreshCw className={`w-2.5 h-2.5 ${isRetryingBlocks ? 'animate-spin' : ''}`} />
                    {isRetryingBlocks ? 'Riprovo…' : 'Riprova revisione'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
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

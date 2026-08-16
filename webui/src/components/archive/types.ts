import type { ArchiveFolder, ArchiveSession } from '../../bridge';
import type { EditorSession } from '../../editorSessions';

export const FOLDER_COLORS = [
  '#FF6B6B', '#FF922B', '#FFD93D', '#6BCB77',
  '#4D96FF', '#CC5DE8', '#FF8FAB', '#20C997',
  '#748FFC', '#94A3B8',
];

export interface ArchivePageProps {
  sessions: ArchiveSession[];
  total?: number;
  folders: ArchiveFolder[];
  onFoldersChange: (folders: ArchiveFolder[]) => void;
  onPreview: (htmlPath: string, filename: string, sourcePath?: string, fileId?: string, sessionDir?: string, searchTerm?: string) => void;
  onOpenFile: (path: string) => void;
  onDeleteSession: (sessionDir: string, name: string) => void;
  onRefresh?: () => void;
  onLoadAll?: () => void;
  onRetryFailedRevisionBlocks?: (sessionDir: string) => Promise<void>;
  onOpenJoinRoom?: () => void;
}

export type FolderModalState =
  | { type: 'create' }
  | { type: 'edit'; folder: ArchiveFolder };

export type DeleteFolderConfirmState = { folder: ArchiveFolder };

export type SortOption = 'newest' | 'oldest' | 'recently_opened' | 'name';

export const SORT_OPTIONS: { id: SortOption; label: string }[] = [
  { id: 'recently_opened', label: 'Aperti di recente' },
  { id: 'newest', label: 'Più recenti' },
  { id: 'oldest', label: 'Meno recenti' },
  { id: 'name', label: 'Nome (A-Z)' },
];

export function getOpenedAtMs(
  session: ArchiveSession,
  editorSessionsMap: Record<string, EditorSession>,
): number {
  let backendMs = 0;
  if (session.last_opened_at_iso) {
    const parsed = new Date(session.last_opened_at_iso).getTime();
    if (!isNaN(parsed) && parsed > 0) {
      backendMs = parsed;
    }
  }
  const localOpened = editorSessionsMap[session.session_dir]?.openedAt
    ?? editorSessionsMap[session.html_path]?.openedAt;
  return Math.max(backendMs, localOpened || 0);
}

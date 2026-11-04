import type { ArchiveSession, DriveStatus } from '../../../bridge';

// Web build: the last answers behind Impostazioni → Archiviazione (backup figures, trash, Drive
// status), kept per host so the page opens on them at once, like the other tabs, and refreshes in
// place; prefetchWebStorage() fills them as soon as the settings open, before the tab is chosen.
// Keyed by the host object: a new host (another test, a reload) starts empty.

export interface WebBackupFigures {
  sessions: number;
  textBytes: number;
  audioBytes: number;
  audioFiles: number;
  lastBackupAt: string | null;
}

interface WebStorageSnapshot {
  backup?: WebBackupFigures;
  trash?: ArchiveSession[];
  drive?: DriveStatus;
}

const snapshots = new WeakMap<object, WebStorageSnapshot>();

export function webStorageSnapshot(): WebStorageSnapshot {
  const api = window.pywebview?.api;
  if (!api) return {};
  let snapshot = snapshots.get(api);
  if (!snapshot) {
    snapshot = {};
    snapshots.set(api, snapshot);
  }
  return snapshot;
}

export async function readBackupFigures(): Promise<WebBackupFigures | null> {
  const result = await window.pywebview?.api?.get_web_backup_info?.().catch(() => null);
  if (!result?.ok) return null;
  const figures: WebBackupFigures = {
    sessions: result.sessions ?? 0,
    textBytes: result.text_bytes ?? 0,
    audioBytes: result.audio_bytes ?? 0,
    audioFiles: result.audio_files ?? 0,
    lastBackupAt: result.last_backup_at ?? null,
  };
  webStorageSnapshot().backup = figures;
  return figures;
}

export async function readTrash(): Promise<{ sessions: ArchiveSession[] } | { error: string }> {
  const result = await window.pywebview?.api?.list_trash?.().catch(() => null);
  if (!result?.ok) return { error: result?.error ?? 'Cestino non leggibile.' };
  const sessions = result.sessions ?? [];
  webStorageSnapshot().trash = sessions;
  return { sessions };
}

export async function readDriveStatus(): Promise<DriveStatus | null> {
  const status = await window.pywebview?.api?.get_drive_status?.().catch(() => null);
  if (status) webStorageSnapshot().drive = status;
  return status ?? null;
}

/** Reads what Archiviazione shows, so the tab opens on it. Each read is skipped where the host lacks it. */
export function prefetchWebStorage(): void {
  const api = window.pywebview?.api;
  if (!api) return;
  if (api.get_web_backup_info) void readBackupFigures();
  if (api.list_trash) void readTrash();
  if (api.get_drive_status) void readDriveStatus();
}

import React, { useEffect, useState } from 'react';
import { useDriveStatus } from '../../../hooks/useDriveStatus';
import { StorageSection } from './StorageSection';
import { WebBackupSection } from './WebBackupSection';
import { WebDriveExportRow } from './WebDriveSection';
import { WebTrashSection } from './WebTrashSection';
import { webStorageSnapshot } from './webStorageSnapshot';

// Web build: Impostazioni → Archiviazione in three sections: where the sbobine are, backup (ending
// with the export to Drive) and the trash. The Drive sync has a page of its own (WebDrivePage),
// which the warning on the sbobine links to. Drive exists only in builds with a Google client ID,
// the trash only where the host has one.
//
// Each section reads its figures on its own (space, Drive status, backup, trash): the page stays
// hidden until all have answered, then shows at once, so badges, cards and the audio switch don't
// pop in or flip one after the other. A source that never answers doesn't hold the page past
// REVEAL_TIMEOUT_MS; once shown it stays shown, even while a later refresh reads again. The settings
// read them on opening and keep the last answers (webStorageSnapshot), so the tab usually finds them
// ready and shows on its first frame, without a fade, like the other tabs.

interface WebStoragePageProps {
  sessionInfo: React.ComponentProps<typeof StorageSection>['sessionInfo'];
  isLoadingSessionInfo: boolean;
  /** An import, a restore or the emptied trash changed the archive. */
  onArchiveChanged: () => void;
  /** Opens Impostazioni → Sincronizzazione. */
  onOpenDrive?: () => void;
  /** Closes the settings on the archive, filtered to the sbobine that keep their audio. */
  onShowKeptAudio?: () => void;
}

const noop = () => {};

export const REVEAL_TIMEOUT_MS = 1500;

export const WebStoragePage: React.FC<WebStoragePageProps> = ({ sessionInfo, isLoadingSessionInfo, onArchiveChanged, onOpenDrive, onShowKeptAudio }) => {
  const drive = useDriveStatus();
  const hasTrash = Boolean(window.pywebview?.api?.list_trash);
  const [backupLoaded, setBackupLoaded] = useState(() => Boolean(webStorageSnapshot().backup));
  const [trashLoaded, setTrashLoaded] = useState(() => Boolean(webStorageSnapshot().trash));
  const [timedOut, setTimedOut] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), REVEAL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  const ready = sessionInfo !== null && !isLoadingSessionInfo
    && (!drive.available || drive.status !== null)
    && backupLoaded
    && (!hasTrash || trashLoaded);
  if (!revealed && (ready || timedOut)) setRevealed(true);

  return (
    <div
      className={`space-y-6${revealed ? '' : ' opacity-0'}`}
      data-testid="web-storage-page"
      data-revealed={revealed}
      aria-busy={!revealed}
    >
      <StorageSection
        inBrowser
        drive={!drive.available ? 'unavailable' : drive.status?.connected ? 'connected' : 'disconnected'}
        onOpenDrive={onOpenDrive}
        onShowKeptAudio={onShowKeptAudio}
        canManageSessionFolder={false}
        sessionInfo={sessionInfo}
        isLoadingSessionInfo={isLoadingSessionInfo}
        isMoveInProgress={false}
        moveProgress={null}
        moveError={null}
        onOpenSessionFolder={noop}
        onAskMoveFolder={noop}
        isCleaningSession={false}
        cleanupResult={null}
        onAskCleanup={noop}
      />
      <WebBackupSection onArchiveImported={onArchiveChanged} onLoaded={() => setBackupLoaded(true)}>
        {drive.available && <WebDriveExportRow drive={drive} />}
      </WebBackupSection>
      {hasTrash && <WebTrashSection onArchiveChanged={onArchiveChanged} onLoaded={() => setTrashLoaded(true)} />}
    </div>
  );
};

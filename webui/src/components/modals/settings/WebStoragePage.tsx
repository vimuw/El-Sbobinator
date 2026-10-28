import React from 'react';
import { useDriveStatus } from '../../../hooks/useDriveStatus';
import { StorageSection } from './StorageSection';
import { WebBackupSection } from './WebBackupSection';
import { WebDriveExportRow } from './WebDriveSection';
import { WebTrashSection } from './WebTrashSection';

// Web build: Impostazioni → Archiviazione in three sections: where the sbobine are, backup (ending
// with the export to Drive) and the trash. The Drive sync has a page of its own (WebDrivePage),
// which the warning on the sbobine links to. Drive exists only in builds with a Google client ID,
// the trash only where the host has one.

interface WebStoragePageProps {
  sessionInfo: React.ComponentProps<typeof StorageSection>['sessionInfo'];
  isLoadingSessionInfo: boolean;
  /** An import, a restore or the emptied trash changed the archive. */
  onArchiveChanged: () => void;
  /** Opens Impostazioni → Sincronizzazione. */
  onOpenDrive?: () => void;
}

const noop = () => {};

export const WebStoragePage: React.FC<WebStoragePageProps> = ({ sessionInfo, isLoadingSessionInfo, onArchiveChanged, onOpenDrive }) => {
  const drive = useDriveStatus();
  const hasTrash = Boolean(window.pywebview?.api?.list_trash);

  return (
    <div className="space-y-6" data-testid="web-storage-page">
      <StorageSection
        inBrowser
        drive={!drive.available ? 'unavailable' : drive.status?.connected ? 'connected' : 'disconnected'}
        onOpenDrive={onOpenDrive}
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
      <WebBackupSection onArchiveImported={onArchiveChanged}>
        {drive.available && <WebDriveExportRow drive={drive} />}
      </WebBackupSection>
      {hasTrash && <WebTrashSection onArchiveChanged={onArchiveChanged} />}
    </div>
  );
};

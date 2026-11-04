import React from 'react';
import { useDriveStatus } from '../../../hooks/useDriveStatus';
import { WebDriveEraseSection, WebDriveSection } from './WebDriveSection';

// Web builds with Drive sync: Impostazioni → Google Drive, a page of its own so the sync is seen
// as soon as the settings open. From the top: the account with what goes to Drive, then the
// erase. The export to Drive stays with the backup, in Archiviazione.
export const WebDrivePage: React.FC = () => {
  const drive = useDriveStatus();
  return (
    <div className="space-y-6" data-testid="web-drive-page">
      <WebDriveSection drive={drive} />
      <WebDriveEraseSection drive={drive} />
    </div>
  );
};

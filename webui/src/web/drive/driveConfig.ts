import { createDriveAuth, type DriveAuth } from './auth';
import { createDriveApi, type DriveApi } from './driveApi';
import { redirectUriFor } from './oauth';

// Whether this build syncs with Google Drive: web builds with EL_SBOBINATOR_GOOGLE_CLIENT_ID, previews
// and tagged releases alike. Without it the web app behaves exactly as before Drive.

// Injected at build time by Vite ('' without the variable).
declare const __GOOGLE_CLIENT_ID__: string;
export const GOOGLE_CLIENT_ID: string = typeof __GOOGLE_CLIENT_ID__ !== 'undefined' ? __GOOGLE_CLIENT_ID__ : '';

export function driveEnabled(clientId: string = GOOGLE_CLIENT_ID): boolean {
  return Boolean(clientId);
}

export interface DriveConnection {
  auth: DriveAuth;
  api: DriveApi;
  /** REST client on the export's own token (drive.file), never kept by the tab. */
  exportApi?: (token: string) => DriveApi;
}

/** The login and the REST client of this page; null when the build has no Drive sync. */
export function createDriveConnection(clientId: string = GOOGLE_CLIENT_ID, origin: string = globalThis.location?.origin ?? ''): DriveConnection | null {
  if (!driveEnabled(clientId)) return null;
  const auth = createDriveAuth({ clientId, redirectUri: redirectUriFor(origin), origin });
  const api = createDriveApi({ getToken: () => auth.token(), onUnauthorized: () => auth.expire() });
  return { auth, api, exportApi: token => createDriveApi({ getToken: () => token }) };
}

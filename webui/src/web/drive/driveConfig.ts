import { WEB_PREVIEW_BUILD } from '../../branding';
import { createDriveAuth, type DriveAuth } from './auth';
import { createDriveApi, type DriveApi } from './driveApi';
import { redirectUriFor } from './oauth';

// Whether this build syncs with Google Drive: only previews built with EL_SBOBINATOR_GOOGLE_CLIENT_ID
// (webBuild.ts refuses it with a version tag). Without it the web app behaves exactly as before.

// Injected at build time by Vite ('' without the variable).
declare const __GOOGLE_CLIENT_ID__: string;
export const GOOGLE_CLIENT_ID: string = typeof __GOOGLE_CLIENT_ID__ !== 'undefined' ? __GOOGLE_CLIENT_ID__ : '';

export function driveEnabled(clientId: string = GOOGLE_CLIENT_ID, preview: boolean = WEB_PREVIEW_BUILD): boolean {
  return Boolean(clientId) && preview;
}

export interface DriveConnection {
  auth: DriveAuth;
  api: DriveApi;
  /** REST client on the export's own token (drive.file), never kept by the tab. */
  exportApi?: (token: string) => DriveApi;
}

/** The login and the REST client of this page; null when the build has no Drive sync. */
export function createDriveConnection(clientId: string = GOOGLE_CLIENT_ID, preview: boolean = WEB_PREVIEW_BUILD, origin: string = globalThis.location?.origin ?? ''): DriveConnection | null {
  if (!driveEnabled(clientId, preview)) return null;
  const auth = createDriveAuth({ clientId, redirectUri: redirectUriFor(origin), origin });
  const api = createDriveApi({ getToken: () => auth.token(), onUnauthorized: () => auth.expire() });
  return { auth, api, exportApi: token => createDriveApi({ getToken: () => token }) };
}

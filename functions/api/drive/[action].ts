// Cloudflare Pages Function of the web site: /api/drive/start, callback, token and disconnect, the
// server half of the Google Drive login. `wrangler pages deploy webui/dist-web`, run from the repo
// root by the web workflows, finds this folder and bundles it with the code it imports.
// The logic and its tests live with the rest of the Drive code: webui/src/web/drive/server/.
// Secrets (GOOGLE_CLIENT_SECRET, DRIVE_COOKIE_KEY) and GOOGLE_CLIENT_ID are Cloudflare Pages
// variables of the project, for Production and for Preview (the staging branch).
import { handleDriveRequest, type DriveServerEnv } from '../../../webui/src/web/drive/server/driveServer';

interface PagesContext {
  request: Request;
  env: DriveServerEnv;
  params: { action?: string | string[] };
}

export const onRequest = (context: PagesContext): Promise<Response> => {
  const action = Array.isArray(context.params.action) ? context.params.action.join('/') : context.params.action ?? '';
  return handleDriveRequest(context.request, context.env, action);
};

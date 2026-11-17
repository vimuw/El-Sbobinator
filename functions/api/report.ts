// Cloudflare Pages Function of the web site: POST /api/report, the tunnel that forwards the page's
// feedback and error reports to Sentry. `wrangler pages deploy webui/dist-web`, run from the repo
// root by the web workflows, finds this folder and bundles it with the code it imports.
// The logic and its tests live with the rest of the reports' code: webui/src/monitoring/server/.
// SENTRY_DSN and REPORT_ALLOWED_ORIGIN are Cloudflare Pages variables of the project, for
// Production and for Preview (the staging branch); without them the tunnel answers 404.
import { handleReportRequest, type ReportServerEnv } from '../../webui/src/monitoring/server/tunnel';

interface PagesContext {
  request: Request;
  env: ReportServerEnv;
}

export const onRequest = (context: PagesContext): Promise<Response> => handleReportRequest(context.request, context.env);

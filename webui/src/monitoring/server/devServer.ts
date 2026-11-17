import { readBody, toFetchRequest, type DevRequest, type DevResponse } from '../../web/drive/server/devServer';
import { REPORT_PATH, handleReportRequest } from './tunnel';

// The reports' tunnel on the web dev server (builds with EL_SBOBINATOR_SENTRY_DSN): the same handler
// as the site's Pages Function (functions/api/report.ts), with the dev server's own origin allowed.

export interface ReportDevMiddlewareOptions {
  dsn: string;
  /** The dev server's scheme: https with the LAN certificate (vite.web.lan.config.ts). */
  protocol: () => 'http' | 'https';
  handle?: typeof handleReportRequest;
}

export function createReportDevMiddleware(options: ReportDevMiddlewareOptions) {
  const handle = options.handle ?? handleReportRequest;
  return (request: DevRequest, response: DevResponse, next: (error?: unknown) => void): void => {
    if ((request.url ?? '').split('?')[0] !== REPORT_PATH) {
      next();
      return;
    }
    void (async () => {
      const method = (request.method ?? 'GET').toUpperCase();
      const body = method === 'POST' ? await readBody(request) : undefined;
      const origin = `${options.protocol()}://${String(request.headers.host ?? 'localhost')}`;
      const answer = await handle(toFetchRequest(request, `${origin}${request.url}`, method, body), {
        SENTRY_DSN: options.dsn,
        REPORT_ALLOWED_ORIGIN: origin,
      });
      response.statusCode = answer.status;
      answer.headers.forEach((value, name) => response.setHeader(name, value));
      response.end(new Uint8Array(await answer.arrayBuffer()));
    })().catch(next);
  };
}

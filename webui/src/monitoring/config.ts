// Whether this build sends feedback and error reports to Sentry: web builds with
// EL_SBOBINATOR_SENTRY_DSN. Without it "Segnala un problema" writes an email. This module stays
// free of the Sentry SDK, which only the page that reports loads (sentry.ts).

// Injected at build time by Vite ('' without the variable).
declare const __SENTRY_DSN__: string;
export const SENTRY_DSN: string = typeof __SENTRY_DSN__ !== 'undefined' ? __SENTRY_DSN__ : '';

/** The site's tunnel to Sentry (functions/api/report.ts): ad blockers leave it alone. */
export const REPORT_TUNNEL_PATH = '/api/report';

/** The user's choice in Impostazioni → Assistenza; on unless they turned it off. */
export const AUTO_REPORTS_KEY = 'el-sbobinator-web-error-reports';

export function monitoringEnabled(dsn: string = SENTRY_DSN): boolean {
  return Boolean(dsn);
}

export function loadAutoReports(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(AUTO_REPORTS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveAutoReports(on: boolean, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(AUTO_REPORTS_KEY, on ? 'on' : 'off');
  } catch {
    // Blocked site data: the choice lasts for this page only.
  }
}

// Build-time settings for the static web build (vite --mode web), used by vite.config.ts.
// Unlike the desktop page there is no local backend: the page talks only to itself and to Gemini.
// No COOP/COEP: nothing needs SharedArrayBuffer and require-corp would break the YouTube previews.

const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';
// Drive sync (drive/): the REST API and token revocation. The login itself is a window to
// accounts.google.com, so no Google script, frame or connect is needed for it.
const DRIVE_ORIGINS = 'https://www.googleapis.com https://oauth2.googleapis.com';

const webCspDirectives = (drive: boolean): Array<[string, string]> => [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
  ['frame-src', 'https://www.youtube.com https://www.youtube-nocookie.com'],
  // Gemini requests and resumable uploads (Files API) share this origin.
  ['connect-src', `'self' ${GEMINI_ORIGIN}${drive ? ` ${DRIVE_ORIGINS}` : ''}`],
  // M2b plays session audio from OPFS through blob: URLs; the M1 chunker runs in a worker.
  ['media-src', "'self' blob:"],
  ['worker-src', "'self' blob:"],
  ['manifest-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'none'"],
];

/** The site policy; with the Drive sync built in, connect-src also reaches the Drive API. */
export function webCsp(drive = false): string {
  return webCspDirectives(drive).map(([name, value]) => `${name} ${value}`).join('; ');
}

export const WEB_CSP = webCsp();

/**
 * OAuth client ID of the Drive sync (EL_SBOBINATOR_GOOGLE_CLIENT_ID), or null when the build
 * leaves Drive out. Until the trash, the export and the Google app review are done (B4–B6) only
 * branch previews may carry it: a tagged release with it fails.
 */
export function driveClientId(value: string | undefined, preview: boolean): string | null {
  const clientId = value?.trim();
  if (!clientId) return null;
  if (!preview) throw new Error('La sincronizzazione Drive (EL_SBOBINATOR_GOOGLE_CLIENT_ID) per ora si include solo nelle anteprime, non con un tag di versione.');
  if (!/^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error(`Client ID OAuth non valido: ${clientId} (atteso 1234567890-abc123.apps.googleusercontent.com).`);
  }
  return clientId;
}

// Desktop-only boot script: it talks to the pywebview startup check.
const DESKTOP_ONLY_SCRIPTS = ['startup-guard.js'];

export function toWebIndexHtml(html: string, drive = false): string {
  const cspPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/i;
  if (!cspPattern.test(html)) throw new Error('index.html has no Content-Security-Policy meta tag to replace.');
  let result = html.replace(cspPattern, `$1${webCsp(drive)}$2`);
  for (const script of DESKTOP_ONLY_SCRIPTS) {
    result = result.replace(new RegExp(`\\s*<script src="\\./${script.replace('.', '\\.')}"></script>`), '');
  }
  return result;
}

/**
 * The web dev server keeps the permissive desktop policy (HMR needs inline scripts and websockets)
 * but must still reach Gemini, or every request fails as "Failed to fetch".
 */
export function toWebDevIndexHtml(html: string, drive = false): string {
  const connectPattern = /(connect-src\s[^;"]*)/i;
  if (!connectPattern.test(html)) throw new Error('index.html has no connect-src directive to extend.');
  return html.replace(connectPattern, `$1 ${GEMINI_ORIGIN}${drive ? ` ${DRIVE_ORIGINS}` : ''}`);
}

// Static pages of the site besides the app: webui/<name>.html, extra entries of the web build only
// (no app script, the app's theme.css for colors and font). Cloudflare Pages serves privacy.html
// at /privacy and redirects /privacy.html there. drive-auth is Google's return page for the Drive
// login (drive/authReturn.ts), built only with a client ID.
export const WEB_STATIC_PAGES = ['privacy'];

export function webStaticPages(drive = false): string[] {
  return drive ? [...WEB_STATIC_PAGES, 'drive-auth'] : WEB_STATIC_PAGES;
}

/** The web dev server injects its client and inline styles: a static page goes without its policy there. */
export function toWebDevStaticPageHtml(html: string): string {
  return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*"\s*\/?>/i, '');
}

/**
 * Cloudflare Pages reads this file from the output folder. Files with a hash in their name
 * (assets/) never change and are cached for a year; the page and the files of public/ keep their
 * names across releases, so the browser revalidates them and a new release arrives on the next
 * load. Cloudflare merges every rule matching a path, so Cache-Control is never set by '/*', and
 * the static pages get the app's policy from it.
 */
export function webHeadersFile(publicFiles: string[] = [], drive = false): string {
  const revalidated = [
    '/', '/index.html', '/version.json',
    ...webStaticPages(drive).flatMap(page => [`/${page}`, `/${page}.html`]),
    ...publicFiles.map(name => `/${name}`),
  ];
  return [
    '/*',
    `  Content-Security-Policy: ${webCsp(drive)}; frame-ancestors 'none'`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    ...revalidated.flatMap(path => [path, '  Cache-Control: no-cache']),
    '',
  ].join('\n');
}

export interface WebBuildVersion {
  version: string;
  /** No release tag: a branch preview, shown as such in the settings and the report. */
  preview: boolean;
}

/** Version of the web build from its release tag (web-v1.2.3), else the package version as a preview. */
export function webBuildVersion(tag: string | undefined, packageVersion: string): WebBuildVersion {
  const value = tag?.trim();
  if (!value) return { version: packageVersion, preview: true };
  const match = /^(?:web-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(value);
  if (!match) throw new Error(`Tag della versione web non valido: ${value} (atteso web-v1.2.3).`);
  return { version: match[1], preview: false };
}

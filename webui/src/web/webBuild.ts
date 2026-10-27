// Build-time settings for the static web build (vite --mode web), used by vite.config.ts.
// Unlike the desktop page there is no local backend: the page talks only to itself and to Gemini.
// No COOP/COEP: nothing needs SharedArrayBuffer and require-corp would break the YouTube previews.

const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com';

const WEB_CSP_DIRECTIVES: Array<[string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
  ['frame-src', 'https://www.youtube.com https://www.youtube-nocookie.com'],
  // Gemini requests and resumable uploads (Files API) share this origin.
  ['connect-src', `'self' ${GEMINI_ORIGIN}`],
  // M2b plays session audio from OPFS through blob: URLs; the M1 chunker runs in a worker.
  ['media-src', "'self' blob:"],
  ['worker-src', "'self' blob:"],
  ['manifest-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'self'"],
  ['form-action', "'none'"],
];

export const WEB_CSP = WEB_CSP_DIRECTIVES.map(([name, value]) => `${name} ${value}`).join('; ');

// Desktop-only boot script: it talks to the pywebview startup check.
const DESKTOP_ONLY_SCRIPTS = ['startup-guard.js'];

export function toWebIndexHtml(html: string): string {
  const cspPattern = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/i;
  if (!cspPattern.test(html)) throw new Error('index.html has no Content-Security-Policy meta tag to replace.');
  let result = html.replace(cspPattern, `$1${WEB_CSP}$2`);
  for (const script of DESKTOP_ONLY_SCRIPTS) {
    result = result.replace(new RegExp(`\\s*<script src="\\./${script.replace('.', '\\.')}"></script>`), '');
  }
  return result;
}

/**
 * The web dev server keeps the permissive desktop policy (HMR needs inline scripts and websockets)
 * but must still reach Gemini, or every request fails as "Failed to fetch".
 */
export function toWebDevIndexHtml(html: string): string {
  const connectPattern = /(connect-src\s[^;"]*)/i;
  if (!connectPattern.test(html)) throw new Error('index.html has no connect-src directive to extend.');
  return html.replace(connectPattern, `$1 ${GEMINI_ORIGIN}`);
}

// Static pages of the site besides the app, from src/web/pages/<name>.html. Only the web build
// emits them; Cloudflare Pages serves privacy.html at /privacy (and redirects /privacy.html there).
export const WEB_STATIC_PAGES = ['privacy'];

/**
 * Cloudflare Pages reads this file from the output folder. Files with a hash in their name
 * (assets/) never change and are cached for a year; the page and the files of public/ keep their
 * names across releases, so the browser revalidates them and a new release arrives on the next
 * load. Cloudflare merges every rule matching a path, so Cache-Control is never set by '/*', and
 * the static pages get the app's policy from it.
 */
export function webHeadersFile(publicFiles: string[] = []): string {
  const revalidated = [
    '/', '/index.html', '/version.json',
    ...WEB_STATIC_PAGES.flatMap(page => [`/${page}`, `/${page}.html`]),
    ...publicFiles.map(name => `/${name}`),
  ];
  return [
    '/*',
    `  Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`,
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

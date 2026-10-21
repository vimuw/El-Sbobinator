// Build-time settings for the static web build (vite --mode web), used by vite.config.ts.
// Unlike the desktop page there is no local backend: the page talks only to itself and to Gemini.
// No COOP/COEP: nothing needs SharedArrayBuffer and require-corp would break the YouTube previews.

const WEB_CSP_DIRECTIVES: Array<[string, string]> = [
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self' 'unsafe-inline'"],
  ['img-src', "'self' data: blob:"],
  ['font-src', "'self' data:"],
  ['frame-src', 'https://www.youtube.com https://www.youtube-nocookie.com'],
  // Gemini requests and resumable uploads (Files API) share this origin.
  ['connect-src', "'self' https://generativelanguage.googleapis.com"],
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

// Cloudflare Pages reads this file from the output folder.
export function webHeadersFile(): string {
  return [
    '/*',
    `  Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

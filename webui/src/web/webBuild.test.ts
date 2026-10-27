import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_CSP, WEB_STATIC_PAGES, driveClientId, toWebDevIndexHtml, toWebDevStaticPageHtml, toWebIndexHtml, webBuildVersion, webCsp, webHeadersFile, webStaticPages } from './webBuild';

function directive(csp: string, name: string): string {
  return csp.split(';').map(part => part.trim()).find(part => part.startsWith(`${name} `)) ?? '';
}

describe('web build page policy', () => {
  it('allows Gemini and YouTube previews but no local backend or eval', () => {
    expect(directive(WEB_CSP, 'connect-src')).toBe("connect-src 'self' https://generativelanguage.googleapis.com");
    expect(directive(WEB_CSP, 'frame-src')).toContain('https://www.youtube-nocookie.com');
    expect(WEB_CSP).not.toMatch(/localhost|127\.0\.0\.1|api\.github\.com|unsafe-eval/);
    expect(directive(WEB_CSP, 'script-src')).toBe("script-src 'self'");
    expect(directive(WEB_CSP, 'object-src')).toBe("object-src 'none'");
  });

  it('rewrites the desktop index.html for the static site', () => {
    const desktopHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const html = toWebIndexHtml(desktopHtml);

    const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(html)?.[1];
    expect(csp).toBe(WEB_CSP);
    expect(html).not.toContain('startup-guard.js');
    expect(html).toContain('<script src="./boot-theme.js"></script>');
    expect(html).toContain('src="/src/main.tsx"');
    expect(html).toContain('<link rel="icon" type="image/png" href="./icon.png" />');
  });

  it('lets the web dev server reach Gemini while keeping the desktop policy for HMR', () => {
    const desktopHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(toWebDevIndexHtml(desktopHtml))?.[1] ?? '';
    const connect = directive(csp.replace(/\s+/g, ' '), 'connect-src');
    expect(connect).toContain('https://generativelanguage.googleapis.com');
    expect(connect).toContain('ws://localhost:*');
  });

  it('sends the same policy as a header, without cross-origin isolation', () => {
    const headers = webHeadersFile();
    expect(headers).toContain(`Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`);
    expect(headers).not.toMatch(/Cross-Origin-(Opener|Embedder)-Policy/);
  });

  it('caches hashed assets for a year and revalidates the page and the unhashed files', () => {
    const headers = webHeadersFile(['boot-theme.js', 'icon.png']);
    const rules = new Map<string, string[]>();
    let current = '';
    for (const line of headers.split('\n')) {
      if (!line) continue;
      if (!line.startsWith(' ')) rules.set((current = line), []);
      else rules.get(current)!.push(line.trim());
    }
    expect(rules.get('/assets/*')).toEqual(['Cache-Control: public, max-age=31536000, immutable']);
    for (const path of ['/', '/index.html', '/version.json', '/boot-theme.js', '/icon.png', '/privacy', '/privacy.html']) {
      expect(rules.get(path)).toEqual(['Cache-Control: no-cache']);
    }
    // Cloudflare merges every matching rule: a Cache-Control on '/*' would join the assets' one.
    expect(rules.get('/*')!.some(header => header.startsWith('Cache-Control'))).toBe(false);
  });
});

describe('privacy page of the web site', () => {
  const html = readFileSync(new URL('../../privacy.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('./pages/privacy.css', import.meta.url), 'utf8');
  const theme = readFileSync(new URL('../theme.css', import.meta.url), 'utf8');

  it('is a static page of the web build, served at /privacy under the site policy', () => {
    expect(WEB_STATIC_PAGES).toContain('privacy');
    // Only the '/*' rule sets headers on it: the same CSP and frame-ancestors as the app.
    const rules = webHeadersFile().split('\n');
    const privacyRule = rules.indexOf('/privacy');
    expect(rules[privacyRule + 1]).toBe('  Cache-Control: no-cache');
    expect(rules[1]).toBe(`  Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`);
    // The build also writes it in the page, so a server without _headers (vite preview) applies it.
    expect(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(toWebIndexHtml(html))?.[1]).toBe(WEB_CSP);
  });

  it('runs under that policy: no inline scripts and nothing loaded from other sites', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.map(([, attributes, body]) => [attributes.trim(), body.trim()])).toEqual([['src="./boot-theme.js"', '']]);
    expect(html).not.toMatch(/<(?:link|img|iframe|source)\b[^>]*\b(?:href|src)="(?:https?:)?\/\//i);
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).not.toMatch(/style="/i);
  });

  it('explains the Drive scopes: drive.appdata for the sync, drive.file only for the export', () => {
    const drive = html.slice(html.indexOf('id="google-drive"'), html.indexOf('id="diritti"'));
    expect(drive).toContain('<code>drive.appdata</code>');
    expect(drive).toMatch(/Esportazione nel tuo Drive \(solo se la chiedi\)[\s\S]*<code>drive\.file<\/code>, che vale solo per i file creati da lei/);
    expect(drive).toContain('l’app non la rilegge e non la modifica');
    expect(drive).toContain('cestino per 30 giorni');
    expect(drive).toContain('Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti');
    // The token is kept by the tab (sessionStorage) for at most an hour, not "never saved".
    expect(drive).toContain('resta solo nella scheda aperta, al massimo un’ora');
  });

  it("looks like the app: its theme tokens and Manrope, no colors of its own", () => {
    // The page's only styles are its stylesheet, which starts from the app's theme.css.
    expect(html).not.toMatch(/<style\b/i);
    expect(html).toContain('<link rel="stylesheet" href="./src/web/pages/privacy.css" />');
    expect(css).toMatch(/^@import "\.\.\/\.\.\/theme\.css";$/m);
    expect(readFileSync(new URL('../index.css', import.meta.url), 'utf8')).toMatch(/^@import "\.\/theme\.css";\r?$/m);
    // Every color comes from a token: no hex, rgb/hsl or named color values in the page's rules.
    const values = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[;{\s])((?:background|border|color|box-shadow|outline|fill)[\w-]*)\s*:\s*([^;}]+)/g)];
    expect(values.length).toBeGreaterThan(10);
    for (const [, property, value] of values) {
      expect(value, property).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|lab)\(|\b(?:white|black|gray|grey|orange|green|red)\b/i);
    }
    expect(css).toMatch(/a\s*{\s*color:\s*var\(--accent-text\);/);
    expect(css).toMatch(/font-family:\s*var\(--font-display\);/);
    // The font is the app's own Manrope files, declared where the tokens live.
    expect(theme).toMatch(/--font-display:\s*"Manrope"/);
    for (const weight of [400, 700, 800]) {
      expect(theme).toContain(`url("@fontsource/manrope/files/manrope-latin-${weight}-normal.woff2")`);
    }
  });

  it('drops its policy on the web dev server, whose client and styles need more', () => {
    expect(toWebDevStaticPageHtml(html)).not.toMatch(/<meta\s+http-equiv="Content-Security-Policy"/i);
    expect(toWebDevStaticPageHtml(html)).toContain('<link rel="stylesheet" href="./src/web/pages/privacy.css" />');
  });

  it('names the contact with a mailto link and no other address', () => {
    expect(html).not.toContain('[NOME E EMAIL DI CONTATTO]');
    expect(html).toMatch(/BOZZA da far rivedere/);
    expect(html).toContain('<a href="mailto:vimuwijesinghe@gmail.com">vimuwijesinghe@gmail.com</a>');
    expect(new Set(html.match(/[\w.+-]+@[\w-]+\.[\w.]+/g))).toEqual(new Set(['vimuwijesinghe@gmail.com']));
  });

  it('links the official terms instead of paraphrasing them', () => {
    for (const url of [
      'https://ai.google.dev/gemini-api/terms',
      'https://policies.google.com/privacy',
      'https://developers.google.com/terms/api-services-user-data-policy',
      'https://myaccount.google.com/permissions',
      'https://www.cloudflare.com/privacypolicy/',
    ]) expect(html).toContain(`href="${url}`);
    expect(html).toContain('<code>drive.appdata</code>');
    expect(html).toMatch(/Ultimo aggiornamento: \d{1,2} \w+ \d{4}/);
  });
});

describe('Drive sync in the web build', () => {
  const clientId = '123456789-abc123def.apps.googleusercontent.com';

  it('reaches only the Drive API and token revocation, with no Google script or frame', () => {
    const csp = webCsp(true);
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://generativelanguage.googleapis.com https://www.googleapis.com https://oauth2.googleapis.com");
    expect(directive(csp, 'script-src')).toBe("script-src 'self'");
    expect(directive(csp, 'frame-src')).toBe(directive(WEB_CSP, 'frame-src'));
    expect(csp).not.toContain('accounts.google.com');
    // Same policy everywhere else: only connect-src differs.
    expect(csp.replace(/connect-src [^;]*/, '')).toBe(WEB_CSP.replace(/connect-src [^;]*/, ''));
  });

  it('leaves the build as it was without a client ID', () => {
    expect(driveClientId(undefined)).toBeNull();
    expect(driveClientId('  ')).toBeNull();
    expect(webCsp()).toBe(WEB_CSP);
    expect(webStaticPages()).toEqual(WEB_STATIC_PAGES);
    expect(webHeadersFile(['icon.png'])).toBe(webHeadersFile(['icon.png'], false));
    expect(webHeadersFile()).not.toContain('drive-auth');
    expect(webHeadersFile()).not.toContain('googleapis.com https://www');
  });

  it('builds the return page and the wider policy into any build with a client ID', () => {
    expect(driveClientId(` ${clientId} `)).toBe(clientId);
    expect(() => driveClientId('client-secret-or-typo')).toThrow(/non valido/);
    expect(webStaticPages(true)).toEqual(['privacy', 'drive-auth']);
    const rules = webHeadersFile([], true).split('\n');
    expect(rules[1]).toBe(`  Content-Security-Policy: ${webCsp(true)}; frame-ancestors 'none'`);
    expect(rules[rules.indexOf('/drive-auth') + 1]).toBe('  Cache-Control: no-cache');
    const desktopHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(toWebIndexHtml(desktopHtml, true)).toContain(`content="${webCsp(true)}"`);
    expect(toWebDevIndexHtml(desktopHtml, true)).toContain('https://www.googleapis.com');
  });

  it('serves a return page with its own module script only and no outside resources', () => {
    const html = readFileSync(new URL('../../drive-auth.html', import.meta.url), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attributes, body]) => [attributes.trim(), body.trim()]);
    expect(scripts).toEqual([['src="./boot-theme.js"', ''], ['type="module" src="./src/web/drive/authReturn.ts"', '']]);
    expect(html).not.toMatch(/(?:href|src)="(?:https?:)?\/\//i);
    expect(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(toWebIndexHtml(html, true))?.[1]).toBe(webCsp(true));
    // Its script never reaches the app's move to the official address (canonicalOrigin.ts, from
    // main.tsx): on elsbobinator.com/drive-auth nothing redirects and the fragment stays for the app.
    const imports = (file: string) => [...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(/^import\s[^;]*from '([^']+)'/gm)].map(([, from]) => from);
    expect(imports('./drive/authReturn.ts')).toEqual(['./oauth']);
    expect(imports('./drive/oauth.ts')).toEqual([]);
  });
});

describe('web build version', () => {
  it('comes from the release tag, else the build is a preview', () => {
    expect(webBuildVersion('web-v1.2.3', '1.0.0')).toEqual({ version: '1.2.3', preview: false });
    expect(webBuildVersion('web-v2.0.0-rc.1', '1.0.0')).toEqual({ version: '2.0.0-rc.1', preview: false });
    expect(webBuildVersion(undefined, '1.0.0')).toEqual({ version: '1.0.0', preview: true });
    expect(webBuildVersion('', '1.0.0')).toEqual({ version: '1.0.0', preview: true });
    expect(() => webBuildVersion('web-vprova', '1.0.0')).toThrow('Tag della versione web non valido');
  });
});

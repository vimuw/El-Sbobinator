import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_CSP, WEB_STATIC_PAGES, toWebDevIndexHtml, toWebIndexHtml, webBuildVersion, webHeadersFile } from './webBuild';

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
  const html = readFileSync(new URL('./pages/privacy.html', import.meta.url), 'utf8');

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
    expect(scripts.map(([, attributes, body]) => [attributes.trim(), body.trim()])).toEqual([['src="/boot-theme.js"', '']]);
    expect(html).not.toMatch(/<(?:link|img|iframe|source)\b[^>]*\b(?:href|src)="(?:https?:)?\/\//i);
    expect(html).not.toMatch(/\son[a-z]+="/i);
    expect(html).not.toMatch(/style="/i);
  });

  it('leaves the contact for the owner to fill in and names no address found elsewhere', () => {
    expect(html).toContain('[NOME E EMAIL DI CONTATTO]');
    expect(html).toMatch(/BOZZA da far rivedere/);
    expect(html).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
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

describe('web build version', () => {
  it('comes from the release tag, else the build is a preview', () => {
    expect(webBuildVersion('web-v1.2.3', '1.0.0')).toEqual({ version: '1.2.3', preview: false });
    expect(webBuildVersion('web-v2.0.0-rc.1', '1.0.0')).toEqual({ version: '2.0.0-rc.1', preview: false });
    expect(webBuildVersion(undefined, '1.0.0')).toEqual({ version: '1.0.0', preview: true });
    expect(webBuildVersion('', '1.0.0')).toEqual({ version: '1.0.0', preview: true });
    expect(() => webBuildVersion('web-vprova', '1.0.0')).toThrow('Tag della versione web non valido');
  });
});

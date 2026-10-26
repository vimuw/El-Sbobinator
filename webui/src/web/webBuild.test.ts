import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_CSP, toWebIndexHtml, webBuildVersion, webHeadersFile } from './webBuild';

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
    for (const path of ['/', '/index.html', '/version.json', '/boot-theme.js', '/icon.png']) {
      expect(rules.get(path)).toEqual(['Cache-Control: no-cache']);
    }
    // Cloudflare merges every matching rule: a Cache-Control on '/*' would join the assets' one.
    expect(rules.get('/*')!.some(header => header.startsWith('Cache-Control'))).toBe(false);
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

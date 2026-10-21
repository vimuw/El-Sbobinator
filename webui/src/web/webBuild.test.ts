import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_CSP, toWebIndexHtml, webHeadersFile } from './webBuild';

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
  });

  it('sends the same policy as a header, without cross-origin isolation', () => {
    const headers = webHeadersFile();
    expect(headers).toContain(`Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`);
    expect(headers).not.toMatch(/Cross-Origin-(Opener|Embedder)-Policy/);
  });
});

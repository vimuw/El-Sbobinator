import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from './drive/server/driveServer';
import { SEARCH_CONSOLE_VERIFICATION, WEB_CSP, WEB_STATIC_PAGES, driveClientId, toWebDevIndexHtml, toWebDevStaticPageHtml, toWebIndexHtml, webBuildVersion, webCsp, webHeadersFile, webStaticPages } from './webBuild';

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

  it('keeps the Search Console tag that verifies elsbobinator.pages.dev in the site head only', () => {
    const desktopHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const head = /<head>([\s\S]*?)<\/head>/i.exec(toWebIndexHtml(desktopHtml))?.[1] ?? '';
    expect(head).toContain('<meta name="google-site-verification" content="XWVhccF0gdqWBcyMsZnKhkONXaFYCZAFHq19zBBjC8M" />');
    expect(toWebIndexHtml(desktopHtml, true)).toContain(SEARCH_CONSOLE_VERIFICATION);
    // The desktop page has no use for it.
    expect(desktopHtml).not.toContain('google-site-verification');
  });

  it('lets the web dev server reach Gemini while keeping the desktop policy for HMR', () => {
    const desktopHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(toWebDevIndexHtml(desktopHtml))?.[1] ?? '';
    const connect = directive(csp.replace(/\s+/g, ' '), 'connect-src');
    expect(connect).toContain('https://generativelanguage.googleapis.com');
    expect(connect).toContain('ws://localhost:*');
    // The picked audio plays from a blob: URL, as on the site; the desktop's local server stays.
    const media = directive(csp.replace(/\s+/g, ' '), 'media-src');
    expect(media).toBe('media-src http://127.0.0.1:* blob:');
    expect(directive(WEB_CSP, 'media-src')).toBe("media-src 'self' blob:");
  });

  it('sends the same policy as a header, without cross-origin isolation', () => {
    const headers = webHeadersFile();
    expect(headers).toContain(`Content-Security-Policy: ${WEB_CSP}; frame-ancestors 'none'`);
    expect(headers).not.toMatch(/Cross-Origin-(Opener|Embedder)-Policy/);
  });

  it('keeps browsers on HTTPS without binding the subdomains', () => {
    const rules = webHeadersFile().split('\n');
    expect(rules.slice(0, rules.indexOf('/assets/*'))).toContain('  Strict-Transport-Security: max-age=31536000');
  });

  it('drops the Access-Control-Allow-Origin: * that Cloudflare Pages adds by default', () => {
    const rules = webHeadersFile().split('\n');
    expect(rules.slice(0, rules.indexOf('/assets/*'))).toContain('  ! Access-Control-Allow-Origin');
    expect(webHeadersFile([], true)).not.toMatch(/^\s*Access-Control-Allow-Origin:/m);
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

  it('lists every section in the index under the title, in page order', () => {
    const sections = [...html.matchAll(/<h2 id="([^"]+)">([^<]+)<\/h2>/g)].map(([, id, title]) => [id, title]);
    const index = /<nav class="toc"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    const entries = [...index.matchAll(/<a href="#([^"]+)">([^<]+)<\/a>/g)].map(([, id, title]) => [id, title]);
    expect(sections.length).toBeGreaterThan(5);
    expect(entries).toEqual(sections);
  });

  it('explains the Drive scopes: drive.appdata for the sync, drive.file only for the export', () => {
    const drive = html.slice(html.indexOf('id="google-drive"'), html.indexOf('id="diritti"'));
    expect(drive).toContain('<code>drive.appdata</code>');
    expect(drive).toMatch(/Esportazione nel tuo Drive \(solo se la chiedi\)[\s\S]*<code>drive\.file<\/code>, che vale solo per i file creati da lei/);
    expect(drive).toContain('l’app non la rilegge e non la modifica');
    expect(drive).toContain('cestino per 30 giorni');
    expect(drive).toContain('Gestisci app → El Sbobinator → Opzioni → Elimina dati app nascosti');
    // The token is kept in the tab's memory for at most an hour, not "never saved".
    expect(drive).toContain('resta solo nella memoria della scheda aperta, al massimo un’ora');
  });

  it('says what the site\'s login service keeps (an encrypted cookie, no copy) and that the sbobine skip it', () => {
    const drive = html.slice(html.indexOf('id="google-drive"'), html.indexOf('id="diritti"'));
    expect(drive).toContain('non passano da server di El Sbobinator');
    expect(drive).toContain('lo cifra e lo salva in un cookie nel tuo browser, che le pagine del sito non possono leggere');
    expect(drive).toContain('niente database e nessun registro dei permessi');
    expect(drive).toContain('“Disconnetti” revoca il permesso presso Google');
    // Not when the service does not answer: the cookie stays until the retry (auth.ts).
    expect(drive).toContain('ritenta di revocarlo e cancellarlo appena torna la connessione o alla visita successiva');
    // Cookies are no longer "none": only the Drive link's technical ones.
    expect(html).not.toContain('non usa cookie');
    expect(html.slice(html.indexOf('id="sito"'))).toContain('uno temporaneo di dieci minuti mentre accedi');
  });

  it('keeps the summary true to the login service: no "no server" claim, a row for the Drive cookie', () => {
    const summary = html.slice(html.indexOf('id="in-breve"'), html.indexOf('id="titolare"'));
    // The Drive login does go through a service of the site: the summary must not deny it.
    expect(summary).not.toMatch(/non ha (?:un )?server/i);
    expect(summary).toContain('non passano da un server suo');
    expect(summary).toContain('Solo il collegamento facoltativo a Google Drive passa da un piccolo servizio del sito');
    const rows = [...summary.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]+)<\/td><td>([^<]+)<\/td><\/tr>/g)].map(([, what, where]) => [what, where]);
    expect(rows).toContainEqual([
      'Collegamento a Google Drive (permesso di rinnovo ed email dell’account)',
      expect.stringContaining('in un cookie cifrato in questo browser'),
    ]);
    // Same lifetime as the server's session cookie (server/driveServer.ts SESSION_MAX_AGE_S).
    expect(SESSION_MAX_AGE_S).toBe(180 * 24 * 3600);
    expect(summary).toContain('fino a sei mesi dall’ultimo uso');
  });

  it('describes Drive as available and optional, not coming soon', () => {
    const drive = html.slice(html.indexOf('id="google-drive"'), html.indexOf('id="diritti"'));
    expect(drive).toMatch(/^id="google-drive">Google Drive \(facoltativo\)<\/h2>/);
    expect(html).not.toMatch(/in arrivo|non è ancora disponibile|quando arriverà/i);
    expect(drive).toContain('Impostazioni → Sincronizzazione');
    expect(html.slice(html.indexOf('id="in-breve"'), html.indexOf('id="titolare"'))).toContain('Google Drive');
  });

  it('applies the paid data terms to free keys in the EEA, as the Gemini API terms do', () => {
    const gemini = html.slice(html.indexOf('id="gemini"'), html.indexOf('id="google-drive"'));
    expect(gemini).toContain('Spazio economico europeo (Italia compresa), in Svizzera e nel Regno Unito');
    expect(gemini).toContain('anche gratuita, le regole del livello a pagamento');
    // The old blanket advice against free keys contradicted those terms for Italian users.
    expect(html).not.toContain('non trascriverla con una chiave gratuita');
  });

  it('names what reaches the developer, the legal bases, the minimum age and the Garante', () => {
    expect(html.slice(html.indexOf('id="sviluppatore"'), html.indexOf('id="base-giuridica"'))).toContain('Segnala un problema');
    expect(html).toContain('Data Privacy Framework');
    // The site's Drive login service processes the refresh permission and the email: it needs a basis too.
    const bases = html.slice(html.indexOf('id="base-giuridica"'), html.indexOf('id="eta"'));
    expect(bases).toMatch(/<li>Collegamento a Google Drive: [^<]*permesso di rinnovo e l’email dell’account[^<]*\(art\. 6, par\. 1, lett\. b del GDPR\)/);
    expect(SESSION_COOKIE).toBe('__Host-drive');
    expect(bases).toContain(`I cookie del collegamento (<code>${SESSION_COOKIE}</code> e quello temporaneo dell’accesso) sono tecnici e strettamente necessari`);
    expect(bases).toContain('non serve il tuo consenso (art. 122 del Codice privacy)');
    expect(html.slice(html.indexOf('id="eta"'), html.indexOf('id="diritti"'))).toContain('almeno 18 anni');
    expect(html.slice(html.indexOf('id="diritti"'))).toContain('https://www.garanteprivacy.it/');
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

  it('reaches only the Drive API (the token comes from the site), with no Google script or frame', () => {
    const csp = webCsp(true);
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://generativelanguage.googleapis.com https://www.googleapis.com");
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

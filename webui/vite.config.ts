import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'path';
import { defineConfig, type UserConfig } from 'vite';
import { driveClientId, toWebDevIndexHtml, toWebDevStaticPageHtml, toWebIndexHtml, webBuildVersion, webHeadersFile, webStaticPages } from './src/web/webBuild.ts';

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };
const version = (process.env.EL_SBOBINATOR_BUILD_VERSION ?? packageInfo.version).replace(/^v/, '');
const backendPort = Number.parseInt(process.env.EL_SBOBINATOR_BACKEND_PORT ?? '8000', 10);


// The desktop bundle (webui/dist) is the default; vite.web.config.ts builds the static web site
// (webui/dist-web) from the same sources.
export function createViteConfig(target: 'desktop' | 'web'): UserConfig {
  const isWeb = target === 'web';
  // The web release workflow passes its tag (web-v1.2.3); other web builds are previews.
  const web = isWeb ? webBuildVersion(process.env.EL_SBOBINATOR_WEB_VERSION, packageInfo.version) : null;
  // Drive sync: only web builds with a Google OAuth client ID have it (and its return page).
  const driveClient = web ? driveClientId(process.env.EL_SBOBINATOR_GOOGLE_CLIENT_ID) : null;
  const drive = driveClient !== null;
  const staticPages = webStaticPages(drive);
  const isStaticPagePath = (url: string) => staticPages.some(page => url === `/${page}.html` || url === `/${page}`);
  return {
    ...(isWeb ? { mode: 'web' } : {}),
    plugins: [react(), tailwindcss(), ...(isWeb ? [{
      name: 'web-dev-gemini',
      apply: 'serve' as const,
      transformIndexHtml: (html: string, ctx: { path: string }) => (
        isStaticPagePath(ctx.path) ? toWebDevStaticPageHtml(html) : toWebDevIndexHtml(html, drive)
      ),
    }] : []), isWeb ? {
      name: 'web-static-site',
      // The dev server keeps the permissive desktop policy: HMR needs inline scripts and websockets.
      apply: 'build',
      transformIndexHtml: (html: string) => toWebIndexHtml(html, drive),
      generateBundle() {
        const publicFiles = readdirSync(new URL('./public', import.meta.url));
        this.emitFile({ type: 'asset', fileName: '_headers', source: webHeadersFile(publicFiles, drive) });
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(web) });
      },
    } : {
      name: 'desktop-build-version',
      generateBundle() {
        const hash = (url: URL) => createHash('sha256').update(readFileSync(url)).digest('hex');
        const dependencies = {
          python_lock_sha256: hash(new URL('../uv.lock', import.meta.url)),
          npm_lock_sha256: hash(new URL('./package-lock.json', import.meta.url)),
        };
        this.emitFile({ type: 'asset', fileName: 'desktop-build.json', source: JSON.stringify({ version, dependencies }) });
      },
    }],
    define: {
      __APP_VERSION__: JSON.stringify(`v${web?.version ?? version}`),
      __WEB_PREVIEW__: JSON.stringify(web?.preview ?? false),
      __GOOGLE_CLIENT_ID__: JSON.stringify(driveClient ?? ''),
      'process.env': {},
      global: 'globalThis',
    },
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    oxc: {
      drop: ['console', 'debugger'],
    } as Record<string, unknown>,
    build: {
      outDir: isWeb ? 'dist-web' : 'dist',
      // The web site also builds its static pages (privacy.html), with the app's theme and font.
      ...(isWeb ? {
        rolldownOptions: {
          input: Object.fromEntries(['index', ...staticPages].map(name => [name, path.resolve(import.meta.dirname, `${name}.html`)])),
        },
      } : {}),
      target: 'esnext',
      chunkSizeWarningLimit: 1000,
    },
    server: {
      port: 3000,
      hmr: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${backendPort}`,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
}

export default defineConfig(createViteConfig('desktop'));

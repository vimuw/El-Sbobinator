import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'path';
import { defineConfig, type UserConfig, type ViteDevServer } from 'vite';
import { createDriveDevMiddleware } from './src/web/drive/server/devServer.ts';
import { createReportDevMiddleware } from './src/monitoring/server/devServer.ts';
import { driveClientId, sentryDsn, toWebDevIndexHtml, toWebDevStaticPageHtml, toWebIndexHtml, webBuildVersion, webHeadersFile, webStaticPages } from './src/web/webBuild.ts';

const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string };

// The static web site (webui/dist-web): everything runs in the page (src/web/webHost.ts).
export function createViteConfig(): UserConfig {
  // The web release workflow passes its tag (web-v1.2.3); other builds are previews.
  const web = webBuildVersion(process.env.EL_SBOBINATOR_WEB_VERSION, packageInfo.version);
  // Drive sync: only builds with a Google OAuth client ID have it (and its return page).
  const driveClient = driveClientId(process.env.EL_SBOBINATOR_GOOGLE_CLIENT_ID);
  const drive = driveClient !== null;
  // Feedback and error reports: only builds with a Sentry DSN have them; the others write an email.
  const reportDsn = sentryDsn(process.env.EL_SBOBINATOR_SENTRY_DSN);
  const staticPages = webStaticPages(drive);
  const isStaticPagePath = (url: string) => staticPages.some(page => url === `/${page}.html` || url === `/${page}`);
  return {
    mode: 'web',
    plugins: [react(), tailwindcss(), {
      name: 'web-dev-gemini',
      apply: 'serve' as const,
      transformIndexHtml: (html: string, ctx: { path: string }) => (
        isStaticPagePath(ctx.path) ? toWebDevStaticPageHtml(html) : toWebDevIndexHtml(html, drive)
      ),
    }, ...(drive ? [{
      // The Drive login's server half (the site's Pages Function) on the dev server too.
      // The secrets come from the shell, as on Cloudflare.
      name: 'web-dev-drive',
      apply: 'serve' as const,
      configureServer(server: ViteDevServer) {
        server.middlewares.use(createDriveDevMiddleware({
          env: () => ({
            GOOGLE_CLIENT_ID: driveClient,
            GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
            DRIVE_COOKIE_KEY: process.env.DRIVE_COOKIE_KEY,
          }),
          protocol: () => (server.config.server.https ? 'https' : 'http'),
        }));
      },
    }] : []), ...(reportDsn ? [{
      // The reports' tunnel (the site's Pages Function functions/api/report.ts) on the dev server.
      // It forwards to the same Sentry project.
      name: 'web-dev-report',
      apply: 'serve' as const,
      configureServer(server: ViteDevServer) {
        server.middlewares.use(createReportDevMiddleware({
          dsn: reportDsn,
          protocol: () => (server.config.server.https ? 'https' : 'http'),
        }));
      },
    }] : []), {
      name: 'web-static-site',
      // The dev server keeps a permissive policy: HMR needs inline scripts and websockets.
      apply: 'build',
      transformIndexHtml: (html: string) => toWebIndexHtml(html, drive),
      generateBundle() {
        const publicFiles = readdirSync(new URL('./public', import.meta.url));
        this.emitFile({ type: 'asset', fileName: '_headers', source: webHeadersFile(publicFiles, drive) });
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(web) });
      },
    }],
    define: {
      __APP_VERSION__: JSON.stringify(`v${web.version}`),
      __WEB_PREVIEW__: JSON.stringify(web.preview),
      __GOOGLE_CLIENT_ID__: JSON.stringify(driveClient ?? ''),
      __SENTRY_DSN__: JSON.stringify(reportDsn ?? ''),
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
      outDir: 'dist-web',
      // The site also builds its static pages (privacy.html), with the app's theme and font.
      rolldownOptions: {
        input: Object.fromEntries(['index', ...staticPages].map(name => [name, path.resolve(import.meta.dirname, `${name}.html`)])),
      },
      target: 'esnext',
      chunkSizeWarningLimit: 1000,
    },
    server: {
      hmr: true,
    },
  };
}

export default defineConfig(createViteConfig());

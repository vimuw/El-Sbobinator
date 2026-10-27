import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The static web build (vite.web.config.ts) needs no backend: the runner builds it once and
// serves it with vite preview. Chromium only — this is not Safari or an iPad.
// A second build carries a made-up Google client ID: the drive*.spec.ts tests run on it, with
// Google answered by page.route; the OAuth route sends the login back to the build's /drive-auth page.
const portOffset = Number.parseInt(process.env.E2E_PORT_OFFSET ?? '0', 10);
const port = 4300 + portOffset;
const drivePort = 4350 + portOffset;
const E2E_GOOGLE_CLIENT_ID = '123456789-abc.apps.googleusercontent.com';
const cache = path.join(import.meta.dirname, 'node_modules', '.cache', 'el-sbobinator-e2e');
const dist = path.join(cache, `dist-web-${portOffset}`);
const driveDist = path.join(cache, `dist-web-drive-${portOffset}`);
const vite = path.join(import.meta.dirname, 'node_modules', 'vite', 'bin', 'vite.js');
// Playwright matches the whole path: only the file name counts, a checkout folder may say "drive".
const DRIVE_SPECS = /(?:^|[\\/])drive[^\\/]*\.spec\.ts$/;

function build(outDir: string, clientId: string | undefined) {
  const env = { ...process.env };
  delete env.EL_SBOBINATOR_GOOGLE_CLIENT_ID;
  if (clientId) env.EL_SBOBINATOR_GOOGLE_CLIENT_ID = clientId;
  execFileSync(process.execPath, [vite, 'build', '--config', 'vite.web.config.ts', '--outDir', outDir, '--logLevel', 'error'], {
    cwd: import.meta.dirname,
    stdio: 'inherit',
    env,
  });
}

if (process.env.TEST_WORKER_INDEX === undefined) {
  build(dist, undefined);
  build(driveDist, E2E_GOOGLE_CLIENT_ID);
}

const preview = (outDir: string, servedPort: number) => ({
  command: `"${process.execPath}" "${vite}" preview --config vite.web.config.ts --outDir "${outDir}" --port ${servedPort} --strictPort`,
  url: `http://localhost:${servedPort}`,
  reuseExistingServer: false,
  timeout: 30000,
});

export default defineConfig({
  testDir: './e2e/web',
  outputDir: `test-results-web-${portOffset}`,
  timeout: 45000,
  expect: { timeout: 10000 },
  // Each test gets a fresh browser context, so localStorage never leaks between tests.
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'web-chromium', testIgnore: DRIVE_SPECS, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${port}` } },
    { name: 'web-drive-chromium', testMatch: DRIVE_SPECS, use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${drivePort}` } },
  ],
  webServer: [preview(dist, port), preview(driveDist, drivePort)],
});

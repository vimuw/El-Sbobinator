import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// The static web build (vite.web.config.ts) needs no backend: the runner builds it once and
// serves it with vite preview. Chromium only — this is not Safari or an iPad.
const portOffset = Number.parseInt(process.env.E2E_PORT_OFFSET ?? '0', 10);
const port = 4300 + portOffset;
const dist = path.join(import.meta.dirname, 'node_modules', '.cache', 'el-sbobinator-e2e', `dist-web-${portOffset}`);
const vite = path.join(import.meta.dirname, 'node_modules', 'vite', 'bin', 'vite.js');
if (process.env.TEST_WORKER_INDEX === undefined) {
  execFileSync(process.execPath, [vite, 'build', '--config', 'vite.web.config.ts', '--outDir', dist, '--logLevel', 'error'], {
    cwd: import.meta.dirname,
    stdio: 'inherit',
  });
}

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
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'web-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `"${process.execPath}" "${vite}" preview --config vite.web.config.ts --outDir "${dist}" --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});

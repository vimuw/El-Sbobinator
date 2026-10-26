import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Shifts the backend ports so another local run can use its own servers.
const portOffset = Number.parseInt(process.env.E2E_PORT_OFFSET ?? '0', 10);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 99) {
  throw new Error(`E2E_PORT_OFFSET must be an integer between 0 and 99, got "${process.env.E2E_PORT_OFFSET}"`);
}

// Tests on one server share its session folder, so every worker gets its own
// backend. The runner starts those backends, so it must know the worker count
// here: --workers / -j is honoured, otherwise E2E_WORKERS, otherwise the default.
function requestedWorkers(): string | undefined {
  const argv = process.argv;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--workers' || arg === '-j') return argv[index + 1];
    if (arg.startsWith('--workers=')) return arg.slice('--workers='.length);
  }
  return process.env.E2E_WORKERS;
}
const defaultWorkers = process.env.CI ? 1 : Math.max(1, Math.min(4, Math.floor(os.cpus().length / 3)));
const workersArg = requestedWorkers();
const workers = workersArg === undefined ? defaultWorkers : Number(workersArg);
if (!Number.isInteger(workers) || workers < 1 || workers > 9) {
  throw new Error(`E2E workers (--workers or E2E_WORKERS) must be an integer between 1 and 9, got "${workersArg}"`);
}
const backendPort = (slot: number) => 8000 + portOffset + slot * 100;
// Playwright reloads this config inside each worker with its slot index set.
const slot = Number.parseInt(process.env.TEST_PARALLEL_INDEX ?? '0', 10);

// Every backend serves one production build, built once by the runner process:
// no per-worker Vite dev server, and the suite exercises the shipped bundle.
const dist = path.join(import.meta.dirname, 'node_modules', '.cache', 'el-sbobinator-e2e', `dist-${portOffset}`);
if (process.env.TEST_WORKER_INDEX === undefined) {
  execFileSync(process.execPath, [
    path.join(import.meta.dirname, 'node_modules', 'vite', 'bin', 'vite.js'),
    'build', '--config', 'vite.e2e.config.ts', '--outDir', dist, '--logLevel', 'error',
  ], { cwd: import.meta.dirname, stdio: 'inherit' });
}

export default defineConfig({
  testDir: './e2e',
  // _smoke/ is gitignored scratch space; its ad-hoc specs are not part of the suite.
  // web/ runs against the static web build (playwright.web.config.ts), not the FastAPI host.
  testIgnore: ['**/_smoke/**', '**/web/**'],
  outputDir: portOffset === 0 ? 'test-results' : `test-results-offset-${portOffset}`,
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  // Lets workers and --shard split long files by test; every test opens its own session.
  fullyParallel: true,
  retries: 0,
  workers,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${backendPort(slot)}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: Array.from({ length: workers }, (_, index) => ({
    command: `python ../scripts/run_browser_dev.py --scenario success --no-vite --dist "${dist}" --settle-runs-on-bootstrap --log-level warning --port ${backendPort(index)}`,
    url: `http://127.0.0.1:${backendPort(index)}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 30000,
  })),
});

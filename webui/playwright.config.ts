import os from 'node:os';
import { defineConfig, devices } from '@playwright/test';

// Shifts the backend + Vite pairs so another local run can use its own servers.
const portOffset = Number.parseInt(process.env.E2E_PORT_OFFSET ?? '0', 10);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 99) {
  throw new Error(`E2E_PORT_OFFSET must be an integer between 0 and 99, got "${process.env.E2E_PORT_OFFSET}"`);
}
// Tests on one server share its session folder, so every worker gets its own
// backend + Vite pair instead of sharing one. Slot ports step by 100 to stay
// clear of other offsets. Each slot runs Chromium, Vite and Python: more than
// one slot per three CPU threads starves the timing-sensitive editor tests.
const defaultWorkers = process.env.CI ? 1 : Math.max(1, Math.min(4, Math.floor(os.cpus().length / 3)));
const workers = Number.parseInt(process.env.E2E_WORKERS ?? String(defaultWorkers), 10);
if (!Number.isInteger(workers) || workers < 1 || workers > 9) {
  throw new Error(`E2E_WORKERS must be an integer between 1 and 9, got "${process.env.E2E_WORKERS}"`);
}
const backendPort = (slot: number) => 8000 + portOffset + slot * 100;
const vitePort = (slot: number) => 3000 + portOffset + slot * 100;
// Playwright reloads this config inside each worker with its slot index set.
const slot = Number.parseInt(process.env.TEST_PARALLEL_INDEX ?? '0', 10);

export default defineConfig({
  testDir: './e2e',
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
    baseURL: `http://localhost:${vitePort(slot)}`,
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
    command: `python ../scripts/run_browser_dev.py --scenario success --port ${backendPort(index)} --vite-port ${vitePort(index)}`,
    url: `http://localhost:${vitePort(index)}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 60000,
  })),
});

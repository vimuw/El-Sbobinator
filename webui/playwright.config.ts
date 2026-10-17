import { defineConfig, devices } from '@playwright/test';

// Shifts the backend + Vite pair so another local run can use its own servers.
const portOffset = Number.parseInt(process.env.E2E_PORT_OFFSET ?? '0', 10);
if (!Number.isInteger(portOffset) || portOffset < 0 || portOffset > 99) {
  throw new Error(`E2E_PORT_OFFSET must be an integer between 0 and 99, got "${process.env.E2E_PORT_OFFSET}"`);
}
const backendPort = 8000 + portOffset;
const vitePort = 3000 + portOffset;

export default defineConfig({
  testDir: './e2e',
  outputDir: portOffset === 0 ? 'test-results' : `test-results-offset-${portOffset}`,
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  // Lets --shard split long files by test; every test opens its own session.
  fullyParallel: true,
  retries: 0,
  // Tests on one server share its session folder, so each shard stays serial.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${vitePort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `python ../scripts/run_browser_dev.py --scenario success --port ${backendPort} --vite-port ${vitePort}`,
    url: `http://localhost:${vitePort}/api/bootstrap`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});

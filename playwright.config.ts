import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry'
  },
  webServer: {
    command:
      'env DATA_DIR=.playwright-data HOST=127.0.0.1 PORT=4173 ORIGIN=http://127.0.0.1:4173 node build',
    url: 'http://127.0.0.1:4173/api/health/live',
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } }
    }
  ]
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './',
  testMatch: ['e2e/**/*.spec.ts', 'apps/web/tests/e2e/**/*.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: 'http://127.0.0.1:3000', trace: 'on-first-retry' },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://127.0.0.1:3010/api/auth/session',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter web start',
      url: 'http://127.0.0.1:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { API_URL: 'http://127.0.0.1:3010' },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

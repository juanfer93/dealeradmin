import { defineConfig, devices } from '@playwright/test';

const webPort = process.env.E2E_WEB_PORT || '3000';

export default defineConfig({
  testDir: './',
  testMatch: ['e2e/**/*.spec.ts', 'apps/web/tests/e2e/**/*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'line' : 'list',
  use: { baseURL: `http://127.0.0.1:${webPort}`, trace: 'on-first-retry' },
  webServer: [
    {
      command: 'node e2e/start-api.mjs',
      url: 'http://127.0.0.1:3010/api/auth/session',
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      // The proxy rewrites are compiled into the Next build. Keep the build
      // and server on the same API URL so browser tests never hit Next's 404
      // page at /api/* instead of the E2E API.
      command: 'node e2e/start-web.mjs',
      url: `http://127.0.0.1:${webPort}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      env: { API_URL: 'http://127.0.0.1:3010', PORT: webPort },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E-Tests gegen `ng serve` (Port 4300) und `wrangler dev` (Port 8790) mit eigener lokaler D1.
 * Die Datenbank wird bei jedem Start neu angelegt und mit dem Demo-Account befüllt.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4300',
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      name: 'api',
      command: 'node e2e/start-api.mjs',
      url: 'http://localhost:8790/api/health',
      timeout: 180_000,
      reuseExistingServer: false,
      // Wrangler beendet sich sauber nur auf SIGINT (wie Strg+C).
      gracefulShutdown: { signal: 'SIGINT', timeout: 3000 },
    },
    {
      name: 'web',
      command: 'pnpm exec ng serve --configuration e2e',
      url: 'http://localhost:4300',
      timeout: 180_000,
      reuseExistingServer: !process.env['CI'],
      gracefulShutdown: { signal: 'SIGINT', timeout: 3000 },
    },
  ],
});

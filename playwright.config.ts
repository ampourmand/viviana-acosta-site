import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 4322);
/** Test any deployment instead: BASE_URL=https://<project>.netlify.app npm test */
const BASE_URL = process.env.BASE_URL;

/**
 * Interaction tests run against the dev server (reused if one is already up),
 * or against BASE_URL when it is set.
 * Browsers: `npx playwright install chromium webkit firefox`.
 *
 * WebKit runs here check behavior only. Playwright's WebKit paints screenshots
 * without compositing, so anything in 3D comes out flat in its captures; look
 * at the book in real Safari.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  // The gesture tests are about timing; a starved machine makes them lie.
  workers: process.env.CI ? 2 : 4,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL ?? `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    {
      name: 'safari',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'iphone', use: { ...devices['iPhone 15'] } },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
  ],
});

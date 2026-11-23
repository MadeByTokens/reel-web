import { defineConfig } from '@playwright/test';

// CSS-pixel viewport of an 11-inch iPad in landscape (2360x1640 at 2x).
const ipad = { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  // The browsers render WebGL in software here; too many at once starve each other.
  workers: process.env.CI ? 2 : 3,
  timeout: process.env.CI ? 180_000 : 90_000,
  // CI machines are slow and shared; a test that passes on a second try is reported as flaky.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4174' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'ipad-webkit', use: { browserName: 'webkit', ...ipad } },
    // Chromium is the second opinion, and the only one that can test saving and offline use.
    // Its software WebGL is slow at the iPad's 2x density, so it runs at 1x.
    { name: 'ipad-chromium', use: { browserName: 'chromium', ...ipad, deviceScaleFactor: 1 } },
  ],
});

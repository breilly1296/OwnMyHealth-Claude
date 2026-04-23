/**
 * Playwright Configuration — E2E tests for critical user flows.
 *
 * Runs against locally-running dev servers (backend on :3001, frontend on :5173).
 * Playwright auto-starts both via the `webServer` config when the ports aren't
 * already listening; `reuseExistingServer` lets you run tests while `npm run
 * dev` is already in another terminal.
 *
 * Traces and screenshots are captured on failure to make CI/local debugging
 * tractable — the reporter includes links to the HTML report artifacts.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // Only treat *.spec.ts as tests — ignores the older auth-test.js helper
  // scripts and the `helpers/`, `fixtures/`, `setup/` subdirs.
  testMatch: /.*\.spec\.ts/,

  // 60s per test covers cold-start of the dev server on the first test and
  // streaming Claude responses in the Health Guide spec.
  timeout: 60_000,

  // One retry smooths over flaky network waits without masking real failures —
  // a test that passes on the second try still surfaces in the report.
  retries: 1,

  // Single worker by default so tests don't race on shared DB state (the seed
  // user is shared). Override with `--workers=N` if specs are rewritten to be
  // fully isolated.
  workers: 1,

  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],

  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    // Longer default action timeout — the app has lazy-loaded routes and
    // suspense boundaries that take a beat to mount after auth changes.
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },

  webServer: [
    {
      command: 'npm run dev',
      cwd: 'backend',
      port: 3001,
      timeout: 45_000,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev',
      port: 5173,
      timeout: 45_000,
      reuseExistingServer: true,
    },
  ],

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for ValidTeam web E2E suite.
 *
 * - `pnpm dev` is auto-started on port 3000 and reused if already running.
 * - Three browser projects (chromium, firefox, webkit) run in parallel.
 * - Auth state for "authed" projects is saved by `e2e/auth.setup.ts`.
 * - Traces + screenshots are captured on failure for fast debugging.
 *
 * Override base URL via `PLAYWRIGHT_BASE_URL` to target a deployed env.
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const STORAGE_STATE = 'e2e/.auth/admin.json';
const PUBLIC_SPEC_PATTERN = /(signup|workspace-setup|public-surfaces)\.spec\.ts/;

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  // Limit per-test wall time so CI fails fast on hung selectors.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Run individual files in parallel; one file at a time inside its workers.
  fullyParallel: true,
  // Fail the build on .only() in CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The exhaustive route matrix and interaction specs share one stateful seed
  // and one Next dev compiler. Parallel workers can race cold RSC compilation
  // and mutate the same fixture, producing hydration noise and false greens via
  // API fallbacks. Reliability is the default; an explicitly isolated caller
  // can opt into parallelism with PLAYWRIGHT_WORKERS.
  workers: Math.max(1, Number.parseInt(process.env.PLAYWRIGHT_WORKERS ?? '1', 10) || 1),
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['github']]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    // The exhaustive surface matrix intentionally cold-compiles dozens of
    // independent App Router entries in development. Keep navigation bounded,
    // but allow the compile itself to finish so assertions measure the rendered
    // product rather than Next.js compiler startup time.
    navigationTimeout: 60_000,
  },
  projects: [
    // 1) Setup: programmatic signin → storage state shared by authed specs.
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // 2) Unauthenticated specs (signup, first-run wizard) run without state.
    {
      name: 'chromium-public',
      testMatch: PUBLIC_SPEC_PATTERN,
      dependencies: ['setup'],
      // These tests share the setup endpoint and intentionally run serially;
      // parallel cold compilation in Next dev can otherwise make the public
      // first-run check time out before the application is warm.
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },

    // 3) Authed product specs across three browsers.
    {
      name: 'chromium',
      testIgnore: [PUBLIC_SPEC_PATTERN, /auth\.setup\.ts$/],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE,
      },
    },
    {
      name: 'firefox',
      testIgnore: [PUBLIC_SPEC_PATTERN, /auth\.setup\.ts$/],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Firefox'],
        storageState: STORAGE_STATE,
      },
    },
    {
      name: 'webkit',
      testIgnore: [PUBLIC_SPEC_PATTERN, /auth\.setup\.ts$/],
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Safari'],
        storageState: STORAGE_STATE,
      },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      // Ensures Next dev server uses the same DB as the seeder.
      NODE_ENV: process.env.NODE_ENV ?? 'development',
    },
  },
});

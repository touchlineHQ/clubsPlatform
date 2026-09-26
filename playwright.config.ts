import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests. These are the only tests that exercise the real seam
 * between the built SPA, the Pages Functions and D1 — vitest covers each half
 * in isolation and can see neither club resolution from the URL path nor the
 * lazy seed of static JSON into the database.
 *
 * Two targets, selected by E2E_BASE_URL:
 *
 *  - unset  → `npm run e2e:serve` builds nothing but serves website/dist through
 *             `wrangler pages dev` against a throwaway local D1. Deterministic,
 *             needs no credentials, so it runs on forks.
 *  - set    → an already-deployed URL, i.e. the per-PR Cloudflare Pages preview.
 *             That database is shared across every PR, so only the @smoke subset
 *             runs there and it must stay read-only.
 *
 * Specs live in e2e/ as *.spec.ts deliberately: vitest's include globs are
 * `functions/**\/*.test.ts` and `website/src/**\/*.test.{ts,tsx}`, so this
 * directory matches neither the paths nor the suffix, and nothing here can drag
 * the 80% coverage thresholds around.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8788';

/**
 * Cloudflare Access service-token headers.
 *
 * Preview deployments of this project sit behind Access, so an unauthenticated
 * request to one is answered with a 302 to <team>.cloudflareaccess.com rather than
 * the app — which looks exactly like a deployment that never came up. A service
 * token is the supported way for CI to get through without making previews public.
 *
 * Undefined unless both halves are present, so a local run against `pages dev`
 * sends nothing extra. Putting them in `use` covers the browser's own /api/*
 * fetches and the `request` fixture alike; a request context built by hand does
 * NOT inherit this and has to pass it explicitly.
 */
const accessClientId = process.env.CF_ACCESS_CLIENT_ID;
const accessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

const extraHTTPHeaders =
  accessClientId && accessClientSecret
    ? {
        'CF-Access-Client-Id': accessClientId,
        'CF-Access-Client-Secret': accessClientSecret,
      }
    : undefined;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  // Files still run in parallel across workers; tests within a file do not.
  // That is deliberate rather than just the default: the lazy seed in
  // functions/api/club.ts has a first-request race (a request that loses the
  // seeding slot returns without waiting for the winner to write), which two
  // workers starting against a fresh database can reach.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    extraHTTPHeaders,
    trace: 'on-first-retry',
    // There is no 'on-first-retry' for screenshots; 'only-on-failure' is the
    // closest equivalent and costs nothing on a green run.
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      // 1280x720, comfortably above Mantine's `md` breakpoint (61.99em), so
      // AppShell.Navbar is rendered rather than collapsed behind the burger.
      // The sidebar navigation assertions depend on this.
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Only manage a server when we are not pointed at a deployed one.
  //
  // `e2e:serve` chains migrate && serve in one foreground process on purpose:
  // Playwright spawns the command through a shell and tree-kills it on teardown,
  // so nothing may be backgrounded with `&` the way the Makefile's `dev` target
  // does — a backgrounded wrangler would outlive the run.
  //
  // The readiness URL is /api/clubs rather than /, because the SPA shell is
  // served at 200 before D1 is reachable. Playwright can only check the status,
  // not the body, so the first spec re-checks that the registry actually
  // contains the demo club.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run e2e:serve',
        url: 'http://127.0.0.1:8788/api/clubs',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});

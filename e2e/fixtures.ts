import { test as base, type APIRequestContext, type Page } from '@playwright/test';

/** The club seeded by migrations 0008/0010 and used by every spec here. */
export const DEMO_SLUG = 'demo';

/** Webfont origins, stubbed for the reason given in stubExternalRequests below. */
const GOOGLE_FONTS = ['**fonts.googleapis.com/**', '**fonts.gstatic.com/**'];

/**
 * A fixed timestamp for the stubbed club feed, so the "Last updated" line the
 * fixtures page renders is deterministic.
 */
const FEED_GENERATED_AT = '2026-01-01T12:00:00.000Z';

/**
 * Cut the club pages off from the live fixtures feed.
 *
 * website/src/data.ts reaches four URLs on that host — the league/team index, a
 * per-club feed, per-team feeds and calendars — and every one is wrapped in a
 * try/catch that degrades to [] or null, so stubbing is safe rather than merely
 * tolerable. A CI runner's egress to it is slow and unreliable, and nothing here
 * asserts on real fixture data.
 *
 * The shapes matter, though. A single catch-all returning `{ leagues: [] }` for
 * everything would hand loadClubFeed a truthy but malformed ClubFeed, and
 * FixturesResultsPage would sail past its `if (!feed)` guard and throw on the
 * missing arrays. So each URL gets the empty-but-valid shape its parser expects,
 * and anything unrecognised 404s — which the callers turn into null.
 *
 * Routes are registered least-specific first because Playwright gives
 * precedence to the route registered last.
 */
async function stubExternalRequests(page: Page): Promise<void> {
  // Catch-all: per-team feeds and .ics calendars. 404 makes loadTeamFeed return
  // null, which is the same as a team having no feed.
  await page.route('**fixtures.touchlinehq.co.uk/**', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );

  // The league/team index, as loadFeedTeams parses it. An empty list leaves
  // `liveTeams` empty, which is deliberately harmless: visibility['/teams'] and
  // visibility['/fixtures'] are `teams.sections.length > 0 || liveTeams.length > 0`
  // and the demo club has DB-seeded sections, so both routes stay mounted.
  await page.route('**fixtures.touchlinehq.co.uk/feeds/index.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ leagues: [] }),
    }),
  );

  // A valid, empty ClubFeed. Returning this rather than a 404 keeps the fixtures
  // page on its real render path instead of the "data unavailable" fallback.
  await page.route('**fixtures.touchlinehq.co.uk/feeds/clubs/*.json', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        club: DEMO_SLUG,
        generated: FEED_GENERATED_AT,
        fixtures: [],
        results: [],
      }),
    }),
  );

  // website/index.html loads these as a render-blocking stylesheet, which makes
  // them part of the load event and therefore a flake source on a cold runner.
  for (const pattern of GOOGLE_FONTS) {
    await page.route(pattern, (route) => route.abort());
  }
}

/**
 * The shared `test` for this directory.
 *
 * This is also the seam for the write-path specs that come next: an
 * `authenticatedPage` fixture signing in through POST /api/auth/sign-in/email
 * and caching cookies in e2e/.auth/ (already gitignored) belongs here, so the
 * stubs above apply to it too. Nothing for auth is built yet.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await stubExternalRequests(page);
    await use(page);
  },
});

/** A club as GET /api/clubs reports it. */
export interface RegistryClub {
  slug: string;
  name: string;
  published: boolean;
}

/**
 * Read the demo club out of the registry.
 *
 * Its display name comes from club_config.name rather than the seeded JSON
 * (functions/api/club.ts overrides the blob with the row), and the shared
 * preview database is mutable — an admin could rename it. So the specs assert
 * against whatever the API reports instead of a hardcoded "Demo FC".
 */
export async function demoClub(request: APIRequestContext): Promise<RegistryClub> {
  const res = await request.get('/api/clubs');
  if (!res.ok()) {
    throw new Error(`GET /api/clubs failed with ${res.status()}`);
  }

  const body = (await res.json()) as { clubs?: RegistryClub[] };
  const club = body.clubs?.find((c) => c.slug === DEMO_SLUG);
  if (!club) {
    throw new Error(`no "${DEMO_SLUG}" club in the registry — is D1 bound and migrated?`);
  }

  return club;
}

/** Escape a literal for embedding in a RegExp — the route hashes contain `/` and `#`. */
export function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { expect } from '@playwright/test';

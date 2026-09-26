import { DEMO_SLUG, demoClub, escapeForRegExp, expect, test } from './fixtures';

/**
 * Anonymous browse of the seeded demo club — the first end-to-end happy path.
 *
 * Read-only throughout, which is what lets the same specs run against the shared
 * Cloudflare Pages preview database as well as a throwaway local one. Every test
 * is tagged @smoke for that reason; `npm run e2e:smoke` is what CI points at a
 * deployed URL.
 */

test.describe('anonymous browse of the demo club @smoke', () => {
  /**
   * Warm the lazy seed once, before any test navigates.
   *
   * functions/api/club.ts seeds a club's content from static JSON on the first
   * GET /api/club for its slug. A request that loses the race for the seeding
   * slot returns early without waiting for the winner to finish writing, so it
   * can answer with an empty default club. Doing one awaited request up front
   * keeps that out of the specs; it also means the tests below never measure
   * seeding as page-load latency.
   */
  test.beforeAll(async ({ playwright }, testInfo) => {
    // A hand-built request context inherits none of `use`, so baseURL and the
    // Cloudflare Access headers both have to be passed through. Without the
    // headers this hook is the first thing to hit a 302 from Access, which is a
    // confusing place to discover a missing service token.
    const ctx = await playwright.request.newContext({
      baseURL: testInfo.project.use.baseURL,
      extraHTTPHeaders: testInfo.project.use.extraHTTPHeaders,
    });
    const res = await ctx.get('/api/club', { headers: { 'X-Club-Slug': DEMO_SLUG } });
    expect(res.ok(), 'GET /api/club should succeed so the club is seeded').toBeTruthy();
    await ctx.dispose();
  });

  /**
   * The diagnostic guard, deliberately first.
   *
   * Playwright's webServer readiness check can only assert a status code, and
   * the SPA shell answers 200 long before D1 is usable. A misconfigured D1
   * binding therefore shows up as an empty registry, which renders the platform
   * landing page and would otherwise fail further down as a baffling "expected
   * heading Demo FC". Failing here instead says what is actually wrong.
   */
  test('the club registry is reachable and lists the demo club', async ({ request }) => {
    const res = await request.get('/api/clubs');
    expect(res.status()).toBe(200);

    const body = (await res.json()) as {
      multiClub: boolean;
      clubs: { slug: string; name: string; published: boolean }[];
    };

    // The demo club is filtered out of this endpoint entirely unless multi-club
    // mode is on, so a false here explains an otherwise empty list.
    expect(body.multiClub, 'MULTI_CLUB must be enabled for /demo/ to resolve').toBe(true);

    const demo = body.clubs.find((c) => c.slug === DEMO_SLUG);
    expect(demo, `no "${DEMO_SLUG}" club in the registry — is D1 bound and migrated?`).toBeDefined();
    expect(demo!.published, 'the demo club must be published to browse anonymously').toBe(true);
    expect(demo!.name).toBeTruthy();
  });

  test('the home page renders the club name', async ({ page, request }) => {
    const { name } = await demoClub(request);

    await page.goto(`/${DEMO_SLUG}/`);

    // Proves three things at once: the SPA fallback served index.html for a
    // path that is not an asset, App.tsx resolved "demo" out of that path, and
    // GET /api/club returned seeded content.
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(name);
  });

  /**
   * Each club page except About renders components/club/PageHeader, which is a
   * <Title order={2}> — so one role-based selector covers the whole tour.
   *
   * These are the nav entries in website/public/data/clubs/demo/club.json, minus
   * Home. SiteSidebar additionally filters them by data.visibility, so a route
   * appearing here is also an assertion that the demo seed still has content for
   * it.
   */
  const pages = [
    { link: 'About Us', hash: '#/about', heading: 'About Demo FC' },
    { link: 'Teams', hash: '#/teams', heading: 'Teams & Squads' },
    { link: 'Fixtures & Results', hash: '#/fixtures', heading: 'Fixtures & Results' },
    { link: 'Register & Pay', hash: '#/register', heading: 'Registration & Subscriptions' },
    { link: 'Committee & Staff', hash: '#/committee', heading: 'Committee & Staff' },
    { link: 'Club News', hash: '#/news', heading: 'Club News' },
    { link: 'Matchday Info', hash: '#/matchday', heading: 'Visitor & Matchday Information' },
    { link: 'Contact', hash: '#/contact', heading: 'Contact Us' },
  ] as const;

  for (const { link, hash, heading } of pages) {
    test(`the sidebar navigates to ${link}`, async ({ page }) => {
      await page.goto(`/${DEMO_SLUG}/`);

      // Scoped to AppShell.Navbar, which Mantine renders as <nav>. Without the
      // scope, "Teams" would also match the home page's team CTAs, and without
      // exact it would match the "Senior Teams" section rows.
      const nav = page.getByRole('navigation');
      await nav.getByRole('link', { name: link, exact: true }).click();

      await expect(page).toHaveURL(new RegExp(`/${DEMO_SLUG}/${escapeForRegExp(hash)}$`));
      await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
    });
  }

  test('the About page renders its story sections', async ({ page }) => {
    await page.goto(`/${DEMO_SLUG}/#/about`);

    // About is the one club page with no PageHeader, so pin its h3s too —
    // they come from club.json's `history` and `about` arrays respectively.
    await expect(page.getByRole('heading', { level: 3, name: 'Our Story' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 3, name: 'Who We Are' })).toBeVisible();
  });

  /**
   * The visibility gate, asserted from the negative side.
   *
   * The demo club's gallery seed is an empty items array, so data.ts computes
   * visibility['/gallery'] as false, App.tsx never mounts the route, and the
   * catch-all sends the request home. That is the documented "hidden if no
   * content" behaviour for every optional section — this pins it using the one
   * section demo has no content for.
   */
  test('a section with no content is neither linked nor routable', async ({ page, request }) => {
    const { name } = await demoClub(request);

    await page.goto(`/${DEMO_SLUG}/`);
    await expect(page.getByRole('navigation').getByRole('link', { name: 'Gallery', exact: true })).toHaveCount(0);

    await page.goto(`/${DEMO_SLUG}/#/gallery`);
    await expect(page).toHaveURL(new RegExp(`/${DEMO_SLUG}/#/$`));
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  });

  test('an unknown route redirects home', async ({ page, request }) => {
    const { name } = await demoClub(request);

    await page.goto(`/${DEMO_SLUG}/#/does-not-exist`);

    await expect(page).toHaveURL(new RegExp(`/${DEMO_SLUG}/#/$`));
    await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  });
});

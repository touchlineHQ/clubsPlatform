import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

const reportReadCost = vi.hoisted(() => vi.fn());
vi.mock('../../lib/read-cost', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/read-cost')>()),
  reportReadCost,
}));

import { onRequestGet } from '../../api/admin/player-registrations';

/**
 * The player picker's typeahead, run against a real database.
 *
 * This endpoint used to return every registration in the club — the same
 * unbounded read #114 removed from the registrations table. It is not
 * paginated, because both callers feed a Select and nobody pages a dropdown;
 * it searches instead, and rehydrates a selection by id.
 */

const CLUB = 'test-club';
const NOW = 1_700_000_000_000;

function call(db: unknown, query = '') {
  return onRequestGet(makeContext(
    getReq(`/api/admin/player-registrations${query}`, { 'X-Club-Slug': CLUB }),
    { env: { DB: db as never } },
  ) as never);
}

describe('GET /api/admin/player-registrations', () => {
  let sqlite: SqliteDb;
  let db: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);

    // p4's FAN is numeric, which is the shape every production row has; p1-p3
    // keep the 'FAN…' form, which the strip must not break.
    sqlite.exec(`INSERT INTO "player" VALUES
      ('p1','FAN001',${NOW},${NOW}), ('p2','FAN002',${NOW},${NOW}), ('p3','FAN999',${NOW},${NOW}),
      ('p4','1234567',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration" VALUES
      ('reg_1','${CLUB}','p1','U15 Tuesday','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_2','${CLUB}','p2','Robins First','Open','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_3','other-club','p3','Elsewhere','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_4','${CLUB}','p4','Wrens Reserves','Open','2026-07-31','Registered',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "subscription_level" VALUES
      ('lvl','${CLUB}','Standard',12000,12,'monthly','2026-09-01',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "registration_subscription_level" VALUES ('${CLUB}','reg_1','lvl',${NOW})`);
  });
  afterEach(() => sqlite.close());

  const rows = async (query: string) =>
    ((await (await call(db, query)).json()) as { registrations: Record<string, unknown>[] }).registrations;

  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await call(db)).status).toBe(401);
  });

  it('returns nothing rather than the whole club for a short query', async () => {
    // The behaviour this replaces: no query at all used to mean every
    // registration in the club.
    expect(await rows('')).toEqual([]);
    expect(await rows('?q=F')).toEqual([]);
  });

  it('says how many characters it wants', async () => {
    const body = await (await call(db, '')).json() as { minQueryChars?: number };
    expect(body.minQueryChars).toBe(2);
  });

  it('matches a FAN ID prefix', async () => {
    expect((await rows('?q=FAN00')).map(r => r.registrationId)).toEqual(['reg_2', 'reg_1']);
    expect((await rows('?q=FAN001')).map(r => r.registrationId)).toEqual(['reg_1']);
  });

  it('matches a team name prefix', async () => {
    expect((await rows('?q=Robins')).map(r => r.registrationId)).toEqual(['reg_2']);
  });

  it('finds a numeric FAN typed the way the picker labels it', async () => {
    // Options read `FAN 1234567 — Wrens Reserves`, so that is what gets typed
    // (or pasted) — while the column holds `1234567` and this is a prefix match.
    expect((await rows('?q=FAN%201234567')).map(r => r.registrationId)).toEqual(['reg_4']);
    expect((await rows('?q=FAN1234567')).map(r => r.registrationId)).toEqual(['reg_4']);
    expect((await rows('?q=fan%201234')).map(r => r.registrationId)).toEqual(['reg_4']);
  });

  it('still matches a FAN ID that itself begins with FAN', async () => {
    // The strip adds an arm, it does not rewrite the query. Rewriting would turn
    // 'FAN00' into '00' and lose both of these.
    expect((await rows('?q=FAN00')).map(r => r.registrationId)).toEqual(['reg_2', 'reg_1']);
    expect((await rows('?q=FAN001')).map(r => r.registrationId)).toEqual(['reg_1']);
  });

  it('does not answer a bare FAN with the whole club', async () => {
    // Stripped to nothing the extra arm would bind '%', which is the unbounded
    // read this endpoint exists to remove. `FAN` still matches the two fixtures
    // whose FAN ID really does start with it — through the raw arm — so the
    // assertion is the absence of the numeric one, not an empty result.
    // Trailing space and all: the handler trims, so both are the query `FAN`.
    expect((await rows('?q=FAN')).map(r => r.registrationId)).toEqual(['reg_2', 'reg_1']);
    expect((await rows('?q=FAN%20')).map(r => r.registrationId)).toEqual(['reg_2', 'reg_1']);
    // `FAN#` strips to nothing as well, and matches nothing literally either.
    expect(await rows('?q=FAN%23')).toEqual([]);
  });

  it('treats a wildcard as literal text', async () => {
    // Two characters, or the minimum-length gate answers before the LIKE runs
    // and the assertion holds with escapeLike deleted. Unescaped, each of these
    // matches every row in the club — the thing being removed.
    expect(await rows(`?q=${encodeURIComponent('%%')}`)).toEqual([]);
    expect(await rows(`?q=${encodeURIComponent('__')}`)).toEqual([]);
  });

  it('reports what a search cost, and whether it found anything', async () => {
    // Bounded by LIMIT on a hit; a miss walks the club, because the prefix is
    // an OR across two tables that no single index can serve. The hit flag is
    // what separates the two in the data.
    reportReadCost.mockClear();
    await rows('?q=FAN001');
    await rows('?q=Nobody');

    const samples = reportReadCost.mock.calls.map(
      (c) => c[3] as { endpoint: string; extra: { hit: boolean } },
    );
    expect(samples.map((s) => s.endpoint)).toEqual([
      'player_registrations_search',
      'player_registrations_search',
    ]);
    expect(samples.map((s) => s.extra.hit)).toEqual([true, false]);
  });

  it('does not report a query too short to reach the database', async () => {
    // It returns before building any SQL, so there is no read to cost.
    reportReadCost.mockClear();
    await rows('?q=F');
    expect(reportReadCost).not.toHaveBeenCalled();
  });

  it('never searches outside the club', async () => {
    expect(await rows('?q=Elsewhere')).toEqual([]);
    expect(await rows('?q=FAN999')).toEqual([]);
  });

  it('clamps the limit', async () => {
    const body = await (await call(db, '?q=FAN&limit=99999')).json() as { limit: number };
    expect(body.limit).toBe(100);
  });

  it('rehydrates a selection by id with the pricing fields intact', async () => {
    // The picker looks a row up by id once the search text has moved past it,
    // and these four drive the subscription form's autofill. A trimmed row here
    // would leave the form silently blank.
    const [row] = await rows('?registrationId=reg_1');

    expect(row.registrationId).toBe('reg_1');
    expect(row.yearlyPriceInPence).toBe(12000);
    expect(row.intervalCount).toBe(12);
    expect(row.intervalUnit).toBe('monthly');
    expect(row.startDate).toBe('2026-09-01');
    expect(row.subscriptionLevelName).toBe('Standard');
  });

  it('will not rehydrate another club‘s registration', async () => {
    expect(await rows('?registrationId=reg_3')).toEqual([]);
  });

  it('returns an empty list rather than failing for an unknown id', async () => {
    expect(await rows('?registrationId=nope')).toEqual([]);
  });

  it('returns one row per registration however many guardians are linked', async () => {
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u1','A','a@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW}),
      ('u2','B','b@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user_player" VALUES
      ('up1','u1','p1','guardian',${NOW}), ('up2','u2','p1','guardian',${NOW})`);

    const found = await rows('?q=FAN001');
    expect(found).toHaveLength(1);
    expect(found[0].linkedAccounts).toBe('a@example.com|guardian,b@example.com|guardian');
  });
});

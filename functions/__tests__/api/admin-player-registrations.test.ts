import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
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

    sqlite.exec(`INSERT INTO "player" VALUES
      ('p1','FAN001',${NOW},${NOW}), ('p2','FAN002',${NOW},${NOW}), ('p3','FAN999',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration" VALUES
      ('reg_1','${CLUB}','p1','U15 Tuesday','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_2','${CLUB}','p2','Robins First','Open','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_3','other-club','p3','Elsewhere','U15','2026-07-31','Registered',${NOW},${NOW})`);
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

  it('treats a wildcard as literal text', async () => {
    // Two characters, or the minimum-length gate answers before the LIKE runs
    // and the assertion holds with escapeLike deleted. Unescaped, each of these
    // matches every row in the club — the thing being removed.
    expect(await rows(`?q=${encodeURIComponent('%%')}`)).toEqual([]);
    expect(await rows(`?q=${encodeURIComponent('__')}`)).toEqual([]);
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

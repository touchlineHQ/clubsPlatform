import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, makeDb, adminSession, getReq } from '../test-utils';
import { createSchemaDb, d1Over, preparedSql, type SqliteDb } from '../sqlite-harness';
import { decodeCursor } from '../../lib/pagination';
import { summariseRegistrations, type SummaryRow } from '../../../website/src/utils/registrationSummary';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as listRegistrations } from '../../api/admin/registrations';
import { onRequestGet as readFacets } from '../../api/admin/registration-facets';
import { onRequestGet as readSummary } from '../../api/admin/registration-summary';

const CLUB = 'test-club';
const NOW = 1_700_000_000_000;

type Handler = typeof listRegistrations;

/** Drive a handler against a real database. */
function call(handler: Handler, db: unknown, query = '', headers = { 'X-Club-Slug': CLUB }) {
  return handler(makeContext(
    getReq(`/api/admin/registrations${query}`, headers),
    { env: { DB: db as never } },
  ) as never);
}

function seedPlayer(db: SqliteDb, fanId: string, id: string) {
  db.exec(`INSERT INTO "player" VALUES ('${id}','${fanId}',${NOW},${NOW})`);
}

function seedRegistration(
  db: SqliteDb,
  o: { id: string; player: string; team: string; club?: string; status?: string | null; expiry?: string | null },
) {
  const status = o.status === null ? 'NULL' : `'${o.status ?? 'Registered'}'`;
  const expiry = o.expiry === null ? 'NULL' : `'${o.expiry ?? '2026-07-31'}'`;
  db.exec(`INSERT INTO "player_registration" VALUES
    ('${o.id}','${o.club ?? CLUB}','${o.player}','${o.team}','U15',${expiry},${status},${NOW},${NOW})`);
}

function seedPayment(db: SqliteDb, id: string, registrationId: string, status: string) {
  db.exec(`INSERT INTO "player_payment"
    ("id","clubSlug","registrationId","reference","mandateId","subscriptionId","status","createdAt","updatedAt")
    VALUES ('${id}','${CLUB}','${registrationId}','REF-${id}','MD','SUB','${status}',${NOW},${NOW})`);
}

describe('GET /api/admin/registrations', () => {
  let sqlite: SqliteDb;
  let db: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
  });
  afterEach(() => sqlite.close());

  // ─── Guards ─────────────────────────────────────────────────────────────────

  it('refuses a request with no session', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await call(listRegistrations, db)).status).toBe(401);
  });

  it('refuses an unknown sort key rather than interpolating it', async () => {
    const res = await call(listRegistrations, db, `?sort=teamName'--`);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toBe('unknown sort key');
  });

  it('refuses a cursor minted under a different sort', async () => {
    // Honouring it would skip an arbitrary slice with nothing on screen to say so.
    const cursor = Buffer.from(JSON.stringify({ s: 'fanId', d: 'asc', v: 'x', id: 'r' }))
      .toString('base64url');
    const res = await call(listRegistrations, db, `?sort=teamName&cursor=${cursor}`);
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toMatch(/does not match the requested sort/);
  });

  // ─── Paging, executed ───────────────────────────────────────────────────────

  /** Walk every page, returning the registration ids in the order seen. */
  async function walk(query: string, limit = 3): Promise<string[]> {
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 50; guard++) {
      const q = `${query}${query.includes('?') ? '&' : '?'}limit=${limit}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const res = await call(listRegistrations, db, q);
      expect(res.status).toBe(200);
      const body = await res.json() as { rows: { registrationId: string }[]; nextCursor: string | null };
      seen.push(...body.rows.map((r) => r.registrationId));
      cursor = body.nextCursor;
      if (!cursor) return seen;
    }
    throw new Error('paging did not terminate');
  }

  it('walks a club exactly once, with no gaps and no repeats, on every sort', async () => {
    // The assertion keyset pagination exists for. A tiebreak that disagrees
    // with the ORDER BY, or a NULL sort key, shows up here and nowhere else.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    ids.forEach((id, i) => {
      // One player each, so (clubSlug, playerId, teamName) stays unique while
      // the team names themselves still collide — which is the point.
      seedPlayer(sqlite, `FAN00${i}`, `p${i}`);
      seedRegistration(sqlite, {
        id: `reg_${id}`,
        player: `p${i}`,
        // Deliberately colliding team names, statuses and expiries: a whole
        // imported cohort shares an expiry, which is what makes the id
        // tiebreak load-bearing rather than decorative.
        team: i < 4 ? 'U15 Tuesday' : 'U15 Thursday',
        status: i % 3 === 0 ? null : 'Registered',
        expiry: '2026-07-31',
      });
    });

    const expected = ids.map((id) => `reg_${id}`).sort();

    for (const sort of ['teamName', 'fanId', 'registrationExpiry', 'registrationStatus', 'subscriptionLevel', 'subscription']) {
      for (const dir of ['asc', 'desc']) {
        const seen = await walk(`?sort=${sort}&dir=${dir}`);
        expect([...seen].sort(), `${sort} ${dir}`).toEqual(expected);
      }
    }
  });

  it('pages a nullable sort key rather than returning an empty second page', async () => {
    // NULL > ? is NULL, so an untotalled sort expression filters out every row
    // past the first page instead of merely mis-ordering them.
    seedPlayer(sqlite, 'FAN001', 'p1');
    for (const id of ['a', 'b', 'c', 'd']) {
      seedRegistration(sqlite, { id: `reg_${id}`, player: 'p1', team: `T ${id}`, status: null, expiry: null });
    }

    expect((await walk('?sort=registrationExpiry')).length).toBe(4);
    expect((await walk('?sort=registrationStatus')).length).toBe(4);
  });

  it('stops without a cursor on the last page', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15' });

    const res = await call(listRegistrations, db, '?limit=50');
    const body = await res.json() as { rows: unknown[]; nextCursor: string | null; limit: number };

    expect(body.rows).toHaveLength(1);
    expect(body.nextCursor).toBeNull();
    expect(body.limit).toBe(50);
  });

  it('mints a cursor pointing at the last row it returned', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    ['a', 'b', 'c'].forEach((id) => seedRegistration(sqlite, { id: `reg_${id}`, player: 'p1', team: `T ${id}` }));

    const body = await (await call(listRegistrations, db, '?limit=2')).json() as {
      rows: { registrationId: string }[]; nextCursor: string;
    };

    expect(body.rows).toHaveLength(2);
    expect(decodeCursor(body.nextCursor)?.id).toBe(body.rows[1].registrationId);
  });

  // ─── Scope and filters ──────────────────────────────────────────────────────

  it('never returns another club‘s rows', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_ours', player: 'p1', team: 'Ours' });
    seedRegistration(sqlite, { id: 'reg_theirs', player: 'p1', team: 'Theirs', club: 'other-club' });

    const body = await (await call(listRegistrations, db)).json() as { rows: { registrationId: string }[] };
    expect(body.rows.map((r) => r.registrationId)).toEqual(['reg_ours']);
  });

  it('filters by team, by status, and by a status that is null', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday', status: 'Registered' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday', status: 'Pending' });
    seedRegistration(sqlite, { id: 'reg_c', player: 'p1', team: 'U15 Sunday', status: null });

    const ids = async (q: string) =>
      ((await (await call(listRegistrations, db, q)).json()) as { rows: { registrationId: string }[] })
        .rows.map((r) => r.registrationId);

    expect(await ids('?team=U15 Thursday')).toEqual(['reg_b']);
    // Filtering by a real status excludes the NULL-status row.
    expect(await ids('?status=Registered')).toEqual(['reg_a']);
    // A blank filter is no filter, not a filter on ''. Sorted by team name:
    // Sunday, Thursday, Tuesday.
    expect(await ids('?status=')).toEqual(['reg_c', 'reg_b', 'reg_a']);
  });

  it('finds one FAN without paging, and treats a wildcard as literal text', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedPlayer(sqlite, 'FAN002', 'p2');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p2', team: 'Robins First' });

    const ids = async (q: string) =>
      ((await (await call(listRegistrations, db, q)).json()) as { rows: { registrationId: string }[] })
        .rows.map((r) => r.registrationId);

    expect(await ids('?q=FAN002')).toEqual(['reg_b']);
    expect(await ids('?q=Robins')).toEqual(['reg_b']);
    // Unescaped, '%' would match the whole club.
    expect(await ids('?q=%')).toEqual([]);
  });

  it('filters by the group-resolved subscription status', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_paid', player: 'p1', team: 'A' });
    seedRegistration(sqlite, { id: 'reg_owing', player: 'p1', team: 'B' });
    seedPayment(sqlite, 'pay1', 'reg_paid', 'active');

    const ids = async (q: string) =>
      ((await (await call(listRegistrations, db, q)).json()) as { rows: { registrationId: string }[] })
        .rows.map((r) => r.registrationId);

    expect(await ids('?subscription=paying')).toEqual(['reg_paid']);
    expect(await ids('?subscription=outstanding')).toEqual(['reg_owing']);
  });

  it('refuses an unknown subscription token', async () => {
    const res = await call(listRegistrations, db, '?subscription=nonsense');
    expect(res.status).toBe(400);
  });

  // ─── The regression pagination would otherwise introduce ────────────────────

  it('gives a secondary its group‘s status even when the primary is on another page', async () => {
    // THE case. Sorted by team, the primary lands on page 1 and the secondary
    // on page 2, so a JS overlay could never reach it.
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_primary', player: 'p1', team: 'AAA Tuesday' });
    seedRegistration(sqlite, { id: 'reg_filler', player: 'p1', team: 'BBB Filler' });
    seedRegistration(sqlite, { id: 'reg_secondary', player: 'p1', team: 'ZZZ Thursday' });
    sqlite.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_secondary','reg_primary',${NOW},${NOW})`);
    seedPayment(sqlite, 'pay1', 'reg_primary', 'active');

    const page1 = await (await call(listRegistrations, db, '?limit=2')).json() as {
      rows: { registrationId: string }[]; nextCursor: string;
    };
    expect(page1.rows.map((r) => r.registrationId)).toEqual(['reg_primary', 'reg_filler']);

    const page2 = await (await call(
      listRegistrations, db, `?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
    )).json() as { rows: Record<string, unknown>[] };

    const secondary = page2.rows[0];
    expect(secondary.registrationId).toBe('reg_secondary');
    expect(secondary.paymentStatus).toBe('active');
    expect(secondary.billedWithTeamName).toBe('AAA Tuesday');
  });

  it('sends no merge fields for a club that has merged nothing', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15' });

    const body = await (await call(listRegistrations, db)).json() as { rows: Record<string, unknown>[] };
    expect(body.rows[0]).not.toHaveProperty('billingRegistrationId');
    expect(body.rows[0]).not.toHaveProperty('__cursor');
  });

  // ─── Binding ────────────────────────────────────────────────────────────────

  it('binds every filter rather than interpolating it', async () => {
    const spy = makeDb({ all: [[]] });
    await call(listRegistrations, spy, `?team=${encodeURIComponent("O'Brien")}&q=FAN&status=Reg`);

    const sql = preparedSql(spy).join('\n');
    expect(sql).not.toContain("O'Brien");
    expect(sql).not.toContain('FAN');
    const binds = (spy.prepare as never as { mock: { results: { value: { bind: { mock: { calls: unknown[][] } } } }[] } })
      .mock.results[0].value.bind.mock.calls[0];
    expect(binds).toContain("O'Brien");
  });
});

describe('GET /api/admin/registration-facets', () => {
  let sqlite: SqliteDb;
  let db: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
  });
  afterEach(() => sqlite.close());

  it('lists the club‘s distinct teams and statuses, ignoring blanks', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedPlayer(sqlite, 'FAN002', 'p2');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday', status: 'Registered' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday', status: 'Registered' });
    // Same team as reg_a, different player: the DISTINCT has to collapse it.
    seedRegistration(sqlite, { id: 'reg_c', player: 'p2', team: 'U15 Tuesday', status: null });
    seedRegistration(sqlite, { id: 'reg_d', player: 'p1', team: 'Other Club Team', club: 'other', status: 'Elsewhere' });

    const body = await (await call(readFacets, db)).json() as { teams: string[]; statuses: string[] };

    expect(body.teams).toEqual(['U15 Thursday', 'U15 Tuesday']);
    expect(body.statuses).toEqual(['Registered']);
  });

  it('does not narrow with the active filters', async () => {
    // The filter bar derives its options from every row today precisely so that
    // choosing a team cannot empty the team dropdown.
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday' });

    const body = await (await call(readFacets, db, '?team=U15 Tuesday')).json() as { teams: string[] };
    expect(body.teams).toHaveLength(2);
  });
});

describe('GET /api/admin/registration-summary', () => {
  let sqlite: SqliteDb;
  let db: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
  });
  afterEach(() => sqlite.close());

  const summary = async (q = '') =>
    (await (await call(readSummary, db, q)).json()) as Record<string, number>;

  it('counts rows, people and billable units as three different numbers', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedPlayer(sqlite, 'FAN002', 'p2');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday' });
    seedRegistration(sqlite, { id: 'reg_c', player: 'p2', team: 'U15 Tuesday' });
    sqlite.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_b','reg_a',${NOW},${NOW})`);

    const s = await summary();
    expect(s.registrations).toBe(3); // rows
    expect(s.players).toBe(2);       // people
    expect(s.billableUnits).toBe(2); // things to charge for
  });

  it('counts a merged group of three as one billable unit', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    ['a', 'b', 'c'].forEach((id) => seedRegistration(sqlite, { id: `reg_${id}`, player: 'p1', team: `T ${id}` }));
    sqlite.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_b','reg_a',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_c','reg_a',${NOW},${NOW})`);

    expect((await summary()).billableUnits).toBe(1);
  });

  it('does not treat outstanding and noLevel as a partition', async () => {
    // summariseRegistrations' own docstring claims they partition the units.
    // Its code says otherwise: a unit with a level that is paying increments
    // neither. Deriving outstanding as billableUnits - noLevel would over-report
    // what the club is owed by exactly the paid-up count.
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_paid', player: 'p1', team: 'A' });
    seedPayment(sqlite, 'pay1', 'reg_paid', 'active');
    sqlite.exec(`INSERT INTO "subscription_level" VALUES ('lvl','${CLUB}','Standard',10000,1,'yearly',NULL,${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "registration_subscription_level" VALUES ('${CLUB}','reg_paid','lvl',${NOW})`);

    const s = await summary();
    expect(s.billableUnits).toBe(1);
    expect(s.paying).toBe(1);
    expect(s.outstanding).toBe(0);
    expect(s.noLevel).toBe(0);
    expect(s.outstanding).not.toBe(s.billableUnits - s.noLevel);
  });

  it('evaluates a unit on the primary‘s own row, not a stand-in member', async () => {
    // Decision 2, asserted explicitly. Filtered to the secondary's team, the
    // unit is still judged by the primary — which has the level and the money.
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_primary', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_secondary', player: 'p1', team: 'U15 Thursday' });
    sqlite.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_secondary','reg_primary',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "subscription_level" VALUES ('lvl','${CLUB}','Standard',10000,1,'yearly',NULL,${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "registration_subscription_level" VALUES ('${CLUB}','reg_primary','lvl',${NOW})`);

    const s = await summary('?team=U15 Thursday');
    expect(s.registrations).toBe(1);   // only the secondary is visible
    expect(s.billableUnits).toBe(1);   // its unit still counts
    expect(s.noLevel).toBe(0);         // judged by the primary, which has one
    expect(s.outstanding).toBe(1);
  });

  it('agrees with summariseRegistrations on an unmerged fixture', async () => {
    // Where the JS stand-in rule cannot bite, the two must produce identical
    // numbers — that helper still serves the personal tab.
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedPlayer(sqlite, 'FAN002', 'p2');
    sqlite.exec(`INSERT INTO "subscription_level" VALUES ('lvl','${CLUB}','Standard',10000,1,'yearly',NULL,${NOW},${NOW})`);

    const rows: SummaryRow[] = [];
    const spec = [
      { id: 'reg_a', player: 'p1', fanId: 'FAN001', pay: 'active', level: true },
      { id: 'reg_b', player: 'p1', fanId: 'FAN001', pay: null, level: true },
      { id: 'reg_c', player: 'p2', fanId: 'FAN002', pay: null, level: false },
      { id: 'reg_d', player: 'p2', fanId: 'FAN002', pay: 'completed', level: false },
    ];
    spec.forEach((r, i) => {
      seedRegistration(sqlite, { id: r.id, player: r.player, team: `T ${i}` });
      if (r.pay) seedPayment(sqlite, `pay_${r.id}`, r.id, r.pay);
      if (r.level) sqlite.exec(`INSERT INTO "registration_subscription_level" VALUES ('${CLUB}','${r.id}','lvl',${NOW})`);
      rows.push({
        registrationId: r.id,
        fanId: r.fanId,
        subscriptionLevelId: r.level ? 'lvl' : null,
        paymentStatus: r.pay,
      });
    });

    expect(await summary()).toEqual({ ...summariseRegistrations(rows) });
  });

  it('honours the same filters as the list', async () => {
    seedPlayer(sqlite, 'FAN001', 'p1');
    seedRegistration(sqlite, { id: 'reg_a', player: 'p1', team: 'U15 Tuesday' });
    seedRegistration(sqlite, { id: 'reg_b', player: 'p1', team: 'U15 Thursday' });

    expect((await summary('?team=U15 Tuesday')).registrations).toBe(1);
  });

  it('returns zeroes rather than nulls for an empty club', async () => {
    expect(await summary()).toEqual({
      registrations: 0, players: 0, billableUnits: 0, paying: 0, outstanding: 0, noLevel: 0,
    });
  });
});

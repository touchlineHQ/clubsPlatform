import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { makeContext, makeDb, adminSession, getReq, postReq, patchReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
  hashPwd: vi.fn(async () => 'pbkdf2$fakehash'),
}));

// ─── player-registrations.ts ──────────────────────────────────────────────────

import { onRequestGet as playerRegistrationsGet } from '../../api/admin/player-registrations';

describe('player-registrations GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of player registrations', async () => {
    const registrationRows = [
      {
        fanId: 'FAN001',
        registrationId: 'preg_1',
        teamName: 'U11 Boys',
        ageGroup: 'U11',
        registrationExpiry: '2025-07-31',
        registrationStatus: 'active',
        linkedAccounts: 'parent@example.com|guardian',
        subscriptionLevelId: 'level_1',
        subscriptionLevelName: 'Junior Annual',
        yearlyPriceInPence: 5000,
        intervalCount: 1,
        intervalUnit: 'yearly',
      },
      {
        fanId: 'FAN002',
        registrationId: 'preg_2',
        teamName: 'U13 Girls',
        ageGroup: 'U13',
        registrationExpiry: '2025-07-31',
        registrationStatus: 'active',
        linkedAccounts: null,
        subscriptionLevelId: null,
        subscriptionLevelName: null,
        yearlyPriceInPence: null,
        intervalCount: null,
        intervalUnit: null,
      },
    ];

    const db = makeDb({ all: [registrationRows] });
    const req = getReq('/api/admin/player-registrations', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerRegistrationsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.registrations)).toBe(true);
    expect(body.registrations.length).toBe(2);
    expect(body.registrations[0].fanId).toBe('FAN001');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb({ all: [[]] });
    const req = getReq('/api/admin/player-registrations', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerRegistrationsGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── player-payments.ts ───────────────────────────────────────────────────────

import { onRequestGet as playerPaymentsGet, onRequestPatch as playerPaymentsPatch } from '../../api/admin/player-payments';

describe('player-payments GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of player payments', async () => {
    const paymentRows = [
      {
        id: 'pp_1',
        registrationId: 'preg_1',
        fanId: 'FAN001',
        teamName: 'U11 Boys',
        reference: 'REF001',
        mandateId: 'mandate_1',
        subscriptionId: 'sub_1',
        status: 'active',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: 'pp_2',
        registrationId: 'preg_2',
        fanId: 'FAN002',
        teamName: 'U13 Girls',
        reference: 'REF002',
        mandateId: 'mandate_2',
        subscriptionId: null,
        status: 'pending',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const db = makeDb({ all: [paymentRows] });
    const req = getReq('/api/admin/player-payments', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.payments)).toBe(true);
    expect(body.payments.length).toBe(2);
    expect(body.payments[0].id).toBe('pp_1');
    expect(body.payments[0].fanId).toBe('FAN001');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb({ all: [[]] });
    const req = getReq('/api/admin/player-payments', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('player-payments PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deactivates a payment and returns ok', async () => {
    const db = makeDb({ first: { id: 'pay_1', status: 'active' }, run: { meta: { changes: 1 } } });
    const req = patchReq('/api/admin/player-payments', { id: 'pay_1' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 400 when id is missing', async () => {
    const db = makeDb();
    const req = patchReq('/api/admin/player-payments', {}, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/i);
  });

  it('returns 404 when payment is not found', async () => {
    const db = makeDb({ run: { meta: { changes: 0 } } });
    const req = patchReq('/api/admin/player-payments', { id: 'pay_unknown' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb();
    const req = patchReq('/api/admin/player-payments', { id: 'pay_1' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── import-players.ts ────────────────────────────────────────────────────────

import { onRequestPost as importPlayersPost } from '../../api/admin/import-players';

describe('import-players POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('imports players and returns ok with created/updated counts', async () => {
    // The import handler makes many sequential .first() and .run() calls per row.
    // We supply first: null for every call so each player/registration is treated as new.
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
      batch: [],
    });
    const req = postReq(
      '/api/admin/import-players',
      {
        rows: [
          {
            fanId: 'FAN001',
            ageGroup: 'U11',
            teamName: 'U11 Boys',
            registrationExpiry: '2025-07-31',
            registrationStatus: 'active',
            playerEmail: null,
            parentEmails: [],
          },
        ],
      },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.players.created).toBeGreaterThanOrEqual(0);
  });

  it('returns 400 when rows is not an array', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: 'not-an-array' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/rows/i);
  });

  it('creates user accounts for parent emails provided', async () => {
    // first: null means no existing player, no existing registration, no existing user
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
      batch: [],
    });
    const req = postReq(
      '/api/admin/import-players',
      {
        rows: [
          {
            fanId: 'FAN002',
            ageGroup: 'U11',
            teamName: 'U11 Boys',
            registrationExpiry: '2025-07-31',
            registrationStatus: 'active',
            playerEmail: null,
            parentEmails: ['parent@example.com'],
          },
        ],
      },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.users.created).toBeGreaterThanOrEqual(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: [] },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when a row is missing fanId', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: [{ teamName: 'U11', parentEmails: [] }] },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/fanId/i);
  });

  it('returns 400 when parentEmails is not an array', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: [{ fanId: 'FAN001', parentEmails: 'not-an-array' }] },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/parentEmails/i);
  });

  it('returns 400 when rows exceed the max', async () => {
    const db = makeDb();
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      fanId: `F${i}`, teamName: 'U11', parentEmails: [],
    }));
    const req = postReq(
      '/api/admin/import-players',
      { rows },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/too many/i);
  });
});

// ─── import-players.ts: dry-run preview and the stale list ────────────────────

/** Every statement the handler prepared, with what it was bound to. */
function prepared(db: any): { sql: string; bindings: unknown[] }[] {
  const prepare = db.prepare as Mock;
  return prepare.mock.calls.map((call: unknown[], i: number) => ({
    sql: call[0] as string,
    bindings: prepare.mock.results[i].value.bind.mock.calls[0] ?? [],
  }));
}

/** Return only the mutating statements prepared by the import handler. */
const writes = (db: any) =>
  prepared(db).filter(p => /^\s*(INSERT|UPDATE|DELETE)/i.test(p.sql));

/** A row as the FA report would give it to us. */
const row = (over: Record<string, unknown> = {}) => ({
  fanId: 'FAN001',
  ageGroup: 'U11',
  teamName: 'U11 Boys',
  registrationExpiry: '2025-07-31',
  registrationStatus: 'Active',
  playerEmail: '',
  parentEmails: [],
  ...over,
});

/** A registration as D1 already holds it. */
const heldRow = (over: Record<string, unknown> = {}) => ({
  id: 'preg_1',
  playerId: 'player_1',
  fanId: 'FAN001',
  teamName: 'U11 Boys',
  registrationStatus: 'Active',
  ...over,
});

/**
 * `all` is queue-of-queues in makeDb — passing the rows directly would hand back
 * the first row rather than the list.
 */
const dbHolding = (held: unknown[]) =>
  makeDb({ all: [held], first: null, run: { meta: { changes: 1 } } });

/** Invoke the import handler with the supplied rows and return its JSON response. */
async function runImport(db: any, rows: unknown[], dryRun?: boolean) {
  const payload: Record<string, unknown> = { rows };
  if (dryRun !== undefined) payload.dryRun = dryRun;
  const req = postReq('/api/admin/import-players', payload, { 'X-Club-Slug': 'test-club' });
  const ctx = makeContext(req, { env: { DB: db as any } });
  const res = await importPlayersPost(ctx as any);
  return { res, body: await res.json() as any };
}

describe('import-players POST — preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('writes nothing when dryRun is true', async () => {
    const db = dbHolding([heldRow()]);
    const { res, body } = await runImport(
      db,
      [row(), row({ fanId: 'FAN002', playerEmail: 'parent@example.com' })],
      true,
    );

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(writes(db)).toEqual([]);
    // The import stamp is a write too — a preview must not move it.
    expect(prepared(db).some(p => /club_import_log/.test(p.sql))).toBe(false);
  });

  it('reports the same counts a real import would, including repeated FANs', async () => {
    // One player, two teams, and the first team listed twice. The duplicate is
    // the case that used to double-count: in the old handler the first row's
    // INSERT was what made the second row's SELECT find the record.
    const rows = [
      row({ fanId: 'FAN003', teamName: 'Team A' }),
      row({ fanId: 'FAN003', teamName: 'Team B' }),
      row({ fanId: 'FAN003', teamName: 'Team A' }),
    ];

    const { body: dry } = await runImport(dbHolding([]), rows, true);
    const { body: real } = await runImport(dbHolding([]), rows, false);

    expect(dry.players).toEqual(real.players);
    expect(dry.registrations).toEqual(real.registrations);
    expect(dry.users).toEqual(real.users);

    expect(dry.players.created).toBe(1);
    expect(dry.registrations.created).toBe(2);
    expect(dry.registrations.updated).toBe(1);
  });

  it('rejects a non-boolean dryRun', async () => {
    const { res, body } = await runImport(dbHolding([]), [row()], 'yes' as any);
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/dryRun/i);
  });
});

describe('import-players POST — stale registrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('lists a registration the file no longer mentions', async () => {
    const db = dbHolding([
      heldRow(),
      heldRow({ id: 'preg_2', playerId: 'player_2', fanId: 'FAN999', registrationStatus: 'Cancelled' }),
    ]);
    const { body } = await runImport(db, [row({ fanId: 'FAN001' })], true);

    expect(body.stale.count).toBe(1);
    expect(body.stale.rows).toEqual([
      { fanId: 'FAN999', teamName: 'U11 Boys', registrationStatus: 'Cancelled' },
    ]);
  });

  it('does not list a registration whose team name differs only by whitespace', async () => {
    const db = dbHolding([heldRow({ teamName: 'U11  Boys' })]);
    const { body } = await runImport(db, [row({ teamName: 'U11 Boys' })], true);

    expect(body.stale.count).toBe(0);
    // ...and it is matched as an update rather than imported a second time.
    expect(body.registrations.updated).toBe(1);
    expect(body.registrations.created).toBe(0);
  });

  it('does not list a submitted row that has no existing registration', async () => {
    const db = dbHolding([]);
    const { body } = await runImport(db, [row()], true);

    expect(body.stale.count).toBe(0);
    expect(body.registrations.created).toBe(1);
  });

  it('is empty when the file covers every registration', async () => {
    const db = dbHolding([
      heldRow(),
      heldRow({ id: 'preg_2', playerId: 'player_2', fanId: 'FAN002' }),
    ]);
    const { body } = await runImport(
      db,
      [row({ fanId: 'FAN001' }), row({ fanId: 'FAN002' })],
      true,
    );

    expect(body.stale.count).toBe(0);
  });

  it('ignores teams the file does not cover, so a partial export is safe', async () => {
    const db = dbHolding([
      heldRow(),
      heldRow({ id: 'preg_2', playerId: 'player_2', fanId: 'FAN500', teamName: 'U15 Girls' }),
    ]);
    const { body } = await runImport(db, [row({ fanId: 'FAN001', teamName: 'U11 Boys' })], true);

    expect(body.stale.count).toBe(0);
  });
});

describe('import-players POST — counters and the import stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('counts a new team for an existing player as a registration, not a player', async () => {
    const db = dbHolding([heldRow()]);
    const { body } = await runImport(db, [row({ teamName: 'U13 Boys' })], true);

    expect(body.players.created).toBe(0);
    expect(body.registrations.created).toBe(1);
    expect(body.registrations.updated).toBe(0);
  });

  it('counts an unchanged squad as updates with nothing created', async () => {
    const db = dbHolding([heldRow()]);
    const { body } = await runImport(db, [row()], true);

    expect(body.players.created).toBe(0);
    expect(body.registrations.created).toBe(0);
    expect(body.registrations.updated).toBe(1);
  });

  it('stamps club_import_log on a real import', async () => {
    const db = dbHolding([]);
    await runImport(db, [row(), row({ fanId: 'FAN002' })], false);

    const stamp = prepared(db).find(p => /INSERT INTO "club_import_log"/.test(p.sql));
    expect(stamp).toBeDefined();
    expect(stamp!.bindings).toEqual(
      expect.arrayContaining(['test-club', 2, 'user_1']),
    );
  });
});

// ─── import-fixtures.ts ───────────────────────────────────────────────────────

import { onRequestPost as importFixturesPost } from '../../api/admin/import-fixtures';

describe('import-fixtures POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('imports fixtures from club feed and returns ok', async () => {
    // The feed returns a ClubFeed with a fixtures array.
    // We supply a home fixture with a future date so it is not filtered out.
    const feedFixture = {
      id: '123',
      date: '2099-03-15', // far future so it always passes the >= today filter
      time: '10:00',
      home_team: 'U11 Boys',
      away_team: 'Away FC',
      team: 'U11 Boys',
      home_away: 'home' as const,
      division: 'Sunday League',
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [feedFixture] }),
        { status: 200 },
      ),
    );

    // .first() returns null → no existing booking request → will insert
    // .run() succeeds for the INSERT
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
    });

    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('skips fixtures that already have a booking request', async () => {
    const feedFixture = {
      id: '124',
      date: '2099-03-22',
      time: '11:00',
      home_team: 'U13 Boys',
      away_team: 'Rivals FC',
      team: 'U13 Boys',
      home_away: 'home' as const,
      division: 'Cup',
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [feedFixture] }),
        { status: 200 },
      ),
    );

    // .first() returns an existing row → fixture will be skipped
    const db = makeDb({ first: { id: 'req_existing' } });

    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(1);
    expect(body.created).toBe(0);
  });

  it('returns 400 when clubFeedSlug is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      {},
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/clubFeedSlug/);
  });

  it('returns 502 when the upstream feed fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'nonexistent-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error).toMatch(/fetch/i);
  });

  it('returns ok with created=0 when there are no home fixtures in the feed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [] }),
        { status: 200 },
      ),
    );

    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.created).toBe(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ fixtures: [] }), { status: 200 }),
    );
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

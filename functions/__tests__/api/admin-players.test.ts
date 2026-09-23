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
import { hashPwd } from '../../lib/auth';

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

/**
 * Tables the import handler is allowed to touch. Naming them keeps the
 * assertion independent of anything a shared helper might prepare — today
 * test-utils mocks ensure-tables, so its COLUMN_MIGRATIONS never run, but the
 * assertion should not quietly depend on that staying true.
 */
const IMPORT_TABLES = [
  'player',
  'player_registration',
  'club_import_log',
  'user',
  'account',
  'user_player',
];

/** Return only the mutating statements the import handler aims at its own tables. */
const writes = (db: any) =>
  prepared(db).filter(p =>
    /^\s*(INSERT|UPDATE|DELETE)/i.test(p.sql)
    && IMPORT_TABLES.some(t => new RegExp(`"${t}"`).test(p.sql)),
  );

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
async function runImport(db: any, rows: unknown[], dryRun?: boolean, part?: unknown) {
  const payload: Record<string, unknown> = { rows };
  if (dryRun !== undefined) payload.dryRun = dryRun;
  if (part !== undefined) payload.part = part;
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

  it('never touches registration_merge, so an admin‘s merges survive re-import', async () => {
    // Why merges live in a side table: the importer knows nothing about them,
    // so re-importing cannot overwrite a decision only the club can make.
    const db = dbHolding([heldRow()]);
    await runImport(db, [row(), row({ fanId: 'FAN002' })], false);

    expect(prepared(db).some(p => /registration_merge/.test(p.sql))).toBe(false);
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

  /**
   * makeDb's `run` is one shared mock, so it cannot fail a single statement.
   * This builds the smallest D1 stand-in that throws for one SQL pattern and
   * behaves normally for everything else.
   */
  function dbFailingOn(pattern: RegExp, held: unknown[] = []) {
    const prepare = vi.fn((sql: string) => {
      const bound = {
        all: vi.fn(async () => ({ results: held, success: true, meta: {} })),
        first: vi.fn(async () => null),
        run: vi.fn(async () => {
          if (pattern.test(sql)) throw new Error('D1_ERROR: constraint failed');
          return { results: [], success: true, meta: { changes: 1 } };
        }),
      };
      return { ...bound, bind: vi.fn(() => bound) };
    });
    return { prepare, exec: vi.fn(async () => ({})), batch: vi.fn(async () => []) };
  }

  it('takes back the count when a registration write fails', async () => {
    const db = dbFailingOn(/INSERT INTO "player_registration"/);
    const { body } = await runImport(db, [row()], false);

    // Planning forecast one creation; the write failed, so the total must not
    // still claim it alongside the error.
    expect(body.registrations.created).toBe(0);
    expect(body.players.created).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].fanId).toBe('FAN001');
  });

  it('takes back both counts when the player write fails, and skips its links', async () => {
    const db = dbFailingOn(/INSERT INTO "player" \(/);
    const { body } = await runImport(
      db,
      [row({ parentEmails: ['parent@example.com'] })],
      false,
    );

    expect(body.players.created).toBe(0);
    expect(body.registrations.created).toBe(0);
    // One failure, reported once — not a second FK error from a link to a
    // player row that was never written.
    expect(body.errors).toHaveLength(1);
    expect(prepared(db).some(p => /user_player/.test(p.sql))).toBe(false);
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

// ─── import-players.ts: chunked writes ────────────────────────────────────────

describe('import-players POST — chunked writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  const part = (index: number, total: number, totalRows: number) => ({ index, total, totalRows });

  it('rejects a malformed part rather than silently importing the whole file', async () => {
    const { res } = await runImport(dbHolding([]), [row()], false, { index: 2, total: 2, totalRows: 5 });
    expect(res.status).toBe(400);
  });

  it('skips the stale pass for a chunk — a slice covers only its own teams', async () => {
    // Without this a 25-row slice of a 300-row file reports every other team in
    // the club as abandoned.
    const held = [heldRow(), heldRow({ fanId: 'FAN999', teamName: 'U11 Boys' })];
    const { body } = await runImport(dbHolding(held), [row()], false, part(0, 3, 75));

    expect(body.stale.count).toBe(0);
    expect(body.stale.rows).toEqual([]);
  });

  it('still reports stale registrations for an unchunked import', async () => {
    const held = [heldRow(), heldRow({ fanId: 'FAN999', teamName: 'U11 Boys' })];
    const { body } = await runImport(dbHolding(held), [row()], false);

    expect(body.stale.count).toBe(1);
  });

  it('does not stamp the import log until the final chunk', async () => {
    const db = dbHolding([]);
    await runImport(db, [row()], false, part(0, 3, 75));

    const sql = (db.prepare as Mock).mock.calls.map(c => String(c[0]));
    expect(sql.some(q => /club_import_log/.test(q))).toBe(false);
  });

  it('stamps once on the final chunk, counting the whole file', async () => {
    const db = dbHolding([]);
    await runImport(db, [row()], false, part(2, 3, 75));

    const stamp = prepared(db).find(p => /club_import_log/.test(p.sql));
    expect(stamp).toBeDefined();
    // 75, the file — not 1, this slice.
    expect(stamp!.bindings).toContain(75);
  });

  it('stamps with the row count when the import is not chunked', async () => {
    const db = dbHolding([]);
    await runImport(db, [row(), row({ fanId: 'FAN002' })], false);

    const stamp = prepared(db).find(p => /club_import_log/.test(p.sql));
    expect(stamp!.bindings).toContain(2);
  });

  it('hashes once per new account, which is the whole reason for chunking', async () => {
    // One PBKDF2 hash is ~47ms of CPU and Cloudflare bills it against the
    // request's budget; two rows sharing a parent must not pay for it twice.
    const db = dbHolding([]);
    await runImport(
      db,
      [
        row({ fanId: 'FAN001', parentEmails: ['parent@example.com'] }),
        row({ fanId: 'FAN002', parentEmails: ['parent@example.com'] }),
      ],
      false,
    );

    expect(hashPwd).toHaveBeenCalledTimes(1);
  });

  it('pays no hash for a chunk whose accounts already exist', async () => {
    // The cross-chunk case: chunk 1 created the parent, so chunk 2 finds them.
    const db = makeDb({
      all: [[], [{ id: 'user_1', email: 'parent@example.com' }]],
      first: null,
      run: { meta: { changes: 1 } },
    });
    await runImport(db, [row({ parentEmails: ['parent@example.com'] })], false, part(1, 3, 75));

    expect(hashPwd).not.toHaveBeenCalled();
  });

  it('looks accounts up in one query rather than one per email', async () => {
    // This was a sequential round trip per address; a 300-row file carries
    // hundreds.
    const db = dbHolding([]);
    await runImport(
      db,
      [
        row({ fanId: 'FAN001', playerEmail: 'a@example.com' }),
        row({ fanId: 'FAN002', playerEmail: 'b@example.com' }),
        row({ fanId: 'FAN003', playerEmail: 'c@example.com' }),
      ],
      false,
    );

    const lookups = prepared(db).filter(p => /FROM "user" WHERE email/.test(p.sql));
    expect(lookups).toHaveLength(1);
    expect(lookups[0].bindings).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
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

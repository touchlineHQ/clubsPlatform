import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, makeDb, adminSession, getReq } from '../test-utils';
import { createSchemaDb, preparedSql, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet } from '../../api/my-registrations';

/**
 * The personal query, run against a real SQLite database.
 *
 * The club scan this file also used to cover has moved to
 * /api/admin/registrations, whose suite exercises the same ground against the
 * same harness. What is left is the personal tab, which is bounded by a user's
 * own registrations and so was never paginated — but still has to resolve a
 * billing group, because a parent can be linked to a merged registration.
 */

const CLUB = 'test-club';
const NOW = 1_700_000_000_000;

/** Run the handler against the mock purely to capture the SQL it builds. */
async function capture(clubRows: unknown[]) {
  mockGetSession.mockResolvedValue(adminSession);
  const db = makeDb({ all: [[], clubRows], batch: [[[]]], first: null });
  await onRequestGet(makeContext(
    getReq('/api/my-registrations', { 'X-Club-Slug': CLUB }),
    { env: { DB: db as any } },
  ) as any);

  const sql = preparedSql(db);
  const personal = sql.find(q => q.includes('FROM user_player up'));
  const club = sql.find(q => q.includes('GROUP_CONCAT(la."v"'));
  const audit = sql.find(q => q.includes('admin_audit_log'));
  return { personal, club, audit };
}

/**
 * One player, two registrations in the same age group. U15 Tuesday is the
 * group's primary and carries the only payment; U15 Thursday is a secondary.
 * Deliberately no row for the primary is handed to the caller — that is the
 * off-page case.
 */
function seedMergedGroup(db: SqliteDb) {
  db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
  db.exec(`INSERT INTO "player_registration" VALUES
    ('reg_tue','${CLUB}','p1','U15 Tuesday','U15','2026-07-31','Registered',${NOW},${NOW}),
    ('reg_thu','${CLUB}','p1','U15 Thursday','U15','2026-07-31','Registered',${NOW},${NOW})`);
  db.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_thu','reg_tue',${NOW},${NOW})`);
  db.exec(`INSERT INTO "player_payment"
    ("id","clubSlug","registrationId","reference","mandateId","subscriptionId","status","createdAt","updatedAt")
    VALUES ('pay_1','${CLUB}','reg_tue','REF-1','MD-1','SUB-1','active',${NOW},${NOW})`);
  db.exec(`INSERT INTO "user" VALUES ('u1','Guardian','guardian@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
  db.exec(`INSERT INTO "user_player" VALUES ('up1','u1','p1','guardian',${NOW})`);
}

describe('my-registrations personal query, executed', () => {
  let db: SqliteDb;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createSchemaDb();
  });
  afterEach(() => db.close());

  /** Run the handler against the mock purely to capture the SQL it builds. */
  async function personalSql(): Promise<string> {
    mockGetSession.mockResolvedValue(adminSession);
    const spy = makeDb({ all: [[]], batch: [[[]]], first: null });
    await onRequestGet(makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': CLUB }),
      { env: { DB: spy as never } },
    ) as never);
    const sql = preparedSql(spy).find(q => q.includes('FROM user_player up'));
    expect(sql, 'personal query not found').toBeTruthy();
    return sql!;
  }

  function seedMergedGroup(target: SqliteDb) {
    target.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    target.exec(`INSERT INTO "player_registration" VALUES
      ('reg_tue','${CLUB}','p1','U15 Tuesday','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_thu','${CLUB}','p1','U15 Thursday','U15','2026-07-31','Registered',${NOW},${NOW})`);
    target.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_thu','reg_tue',${NOW},${NOW})`);
    target.exec(`INSERT INTO "player_payment"
      ("id","clubSlug","registrationId","reference","mandateId","subscriptionId","status","createdAt","updatedAt")
      VALUES ('pay_1','${CLUB}','reg_tue','REF-1','MD-1','SUB-1','active',${NOW},${NOW})`);
    target.exec(`INSERT INTO "user" VALUES ('u1','Guardian','guardian@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    target.exec(`INSERT INTO "user_player" VALUES ('up1','u1','p1','guardian',${NOW})`);
  }

  it('gives a linked secondary its group‘s payment status', async () => {
    // The payment hangs off reg_tue, so keyed on the row's own id reg_thu reads
    // "Outstanding" and a parent is chased for money already paid.
    const sql = await personalSql();
    seedMergedGroup(db);

    const rows = db.prepare(sql).all('u1', CLUB) as Record<string, unknown>[];
    const secondary = rows.find(r => r.registrationId === 'reg_thu')!;

    expect(secondary.paymentStatus).toBe('active');
    expect(secondary.billedWithTeamName).toBe('U15 Tuesday');
  });

  it('collapses a manual override to completed for the player', async () => {
    // A manually-paid player must look identical to one who paid in full; only
    // the admin table distinguishes them.
    const sql = await personalSql();
    seedMergedGroup(db);
    db.exec(`UPDATE "player_payment" SET "status" = 'manual' WHERE "id" = 'pay_1'`);

    const rows = db.prepare(sql).all('u1', CLUB) as Record<string, unknown>[];
    expect(rows.every(r => r.paymentStatus === 'completed')).toBe(true);
  });

  it('never reads a billing team from another club', async () => {
    const sql = await personalSql();
    seedMergedGroup(db);
    db.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player_registration" VALUES
      ('reg_other','other-club','p2','Other United','U15','2026-07-31','Registered',${NOW},${NOW})`);

    const rows = db.prepare(sql).all('u1', CLUB) as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.registrationId !== 'reg_other')).toBe(true);
  });

  it('carries the indexes the read depends on', async () => {
    // ensure-tables and migrations/ are hand-synced copies; this catches an
    // index that reached the migration but not the runtime schema.
    const names = (db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`,
    ).all() as { name: string }[]).map(r => r.name);

    expect(names).toEqual(expect.arrayContaining([
      'idx_admin_audit_log_target',
      'idx_player_payment_reg_status',
      'idx_player_registration_club_team',
      'idx_player_registration_club_status',
    ]));
  });
});

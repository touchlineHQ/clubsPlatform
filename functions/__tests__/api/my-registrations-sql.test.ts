import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, adminSession, getReq } from '../test-utils';
import { createSchemaDb, preparedSql, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet } from '../../api/my-registrations';

/**
 * The queries this endpoint builds, run against a real SQLite database.
 *
 * Everything in my-registrations.test.ts asserts the SQL is SHAPED correctly,
 * because the D1 double cannot execute it. These tests close that gap for the
 * one thing shape cannot prove: that a secondary whose primary is absent from
 * the result set still reports its group's payment status. That is the
 * regression resolving the merge in SQL exists to prevent, and it is the case
 * pagination will make routine.
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

describe('my-registrations SQL, executed', () => {
  let db: SqliteDb;
  beforeEach(() => {
    vi.clearAllMocks();
    db = createSchemaDb();
  });

  it('gives a secondary its group‘s payment status when the primary is not in the result', async () => {
    // The payment hangs off reg_tue. Keyed on the row's own id, reg_thu has no
    // payment of its own and reads "Outstanding" — and the JS pass that used to
    // correct that could only reach a primary it had already loaded.
    const { club } = await capture([]);
    seedMergedGroup(db);

    const rows = db.prepare(club!).all(CLUB) as Record<string, unknown>[];
    const byId = Object.fromEntries(rows.map(r => [r.registrationId as string, r]));

    expect(byId.reg_thu.paymentStatus).toBe('active');
    expect(byId.reg_thu.billingRegistrationId).toBe('reg_tue');
    expect(byId.reg_thu.billedWithTeamName).toBe('U15 Tuesday');
  });

  it('names every team a primary is billed for', async () => {
    const { club } = await capture([]);
    seedMergedGroup(db);
    db.exec(`INSERT INTO "player_registration" VALUES
      ('reg_sun','${CLUB}','p1','U15 Sunday','U15','2026-07-31','Registered',${NOW},${NOW})`);
    db.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_sun','reg_tue',${NOW},${NOW})`);

    const rows = db.prepare(club!).all(CLUB) as Record<string, unknown>[];
    const primary = rows.find(r => r.registrationId === 'reg_tue')!;

    // Ordered by team name, so this string cannot flicker between requests.
    expect(primary.mergedTeamNames).toBe('U15 Sunday, U15 Thursday');
  });

  it('leaves an unmerged registration‘s merge columns null', async () => {
    const { club } = await capture([]);
    db.exec(`INSERT INTO "player" VALUES ('p9','FAN009',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player_registration" VALUES
      ('reg_solo','${CLUB}','p9','U11 Reds','U11','2026-07-31','Registered',${NOW},${NOW})`);

    const [row] = db.prepare(club!).all(CLUB) as Record<string, unknown>[];

    expect(row.billingRegistrationId).toBe(null);
    expect(row.billedWithTeamName).toBe(null);
    expect(row.mergedTeamNames).toBe(null);
    expect(row.paymentStatus).toBe(null);
  });

  it('never lets the merge join cross clubs', async () => {
    // The registrations belong to this club, but the merge row does not.
    const { club } = await capture([]);
    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player_registration" VALUES
      ('reg_primary','${CLUB}','p1','U15 Tuesday','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_secondary','${CLUB}','p1','U15 Thursday','U15','2026-07-31','Registered',${NOW},${NOW})`);
    db.exec(`INSERT INTO "registration_merge" VALUES ('other-club','reg_secondary','reg_primary',${NOW},${NOW})`);

    const rows = db.prepare(club!).all(CLUB) as Record<string, unknown>[];
    const secondary = rows.find(r => r.registrationId === 'reg_secondary')!;

    expect(rows).toHaveLength(2);
    expect(secondary.billingRegistrationId).toBe(null);
    expect(secondary.billedWithTeamName).toBe(null);
  });

  it('does not read a billing team from another club', async () => {
    const { club } = await capture([]);
    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player_registration" VALUES
      ('reg_secondary','${CLUB}','p1','U15 Thursday','U15','2026-07-31','Registered',${NOW},${NOW}),
      ('reg_primary','other-club','p1','Other United','U15','2026-07-31','Registered',${NOW},${NOW})`);
    db.exec(`INSERT INTO "registration_merge" VALUES ('${CLUB}','reg_secondary','reg_primary',${NOW},${NOW})`);

    const [secondary] = db.prepare(club!).all(CLUB) as Record<string, unknown>[];

    expect(secondary.billedWithTeamName).toBe(null);
  });

  it('returns one row per registration however many guardians are linked', async () => {
    // linkedAccounts is a scalar subquery now; the join-plus-GROUP BY form it
    // replaced would fan out here.
    const { club } = await capture([]);
    seedMergedGroup(db);
    db.exec(`INSERT INTO "user" VALUES ('u2','Other','second@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    db.exec(`INSERT INTO "user_player" VALUES ('up2','u2','p1','guardian',${NOW})`);

    const rows = db.prepare(club!).all(CLUB) as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    // Ordered by email, so the cell cannot reorder between requests either.
    expect(rows[0].linkedAccounts)
      .toBe('guardian@example.com|guardian,second@example.com|guardian');
  });

  it('resolves the merge on the personal query too', async () => {
    // Dropping the JS pass without this would leave the personal tab unresolved.
    const { personal } = await capture([]);
    seedMergedGroup(db);

    const rows = db.prepare(personal!).all('u1', CLUB) as Record<string, unknown>[];
    const secondary = rows.find(r => r.registrationId === 'reg_thu')!;

    expect(secondary.paymentStatus).toBe('active');
    expect(secondary.billedWithTeamName).toBe('U15 Tuesday');
  });

  it('reads manual attribution for the group through the primary', async () => {
    const manualRow = { registrationId: 'reg_thu', paymentStatus: 'manual', billingRegistrationId: 'reg_tue' };
    const { audit } = await capture([manualRow]);
    seedMergedGroup(db);

    db.exec(`UPDATE "player_payment" SET "status" = 'manual' WHERE "id" = 'pay_1'`);
    db.exec(`INSERT INTO "admin_audit_log"
      ("id","clubSlug","adminId","action","targetTable","targetId","oldStatus","newStatus","note","createdAt")
      VALUES ('al_1','${CLUB}','u1','manual_paid','player_payment','pay_1',NULL,'manual','cash at training',${NOW})`);

    const rows = db.prepare(audit!).all(CLUB, 'reg_tue') as Record<string, unknown>[];

    expect(rows).toHaveLength(1);
    expect(rows[0].registrationId).toBe('reg_tue');
    expect(rows[0].manualPaidBy).toBe('guardian@example.com');
    expect(rows[0].manualNote).toBe('cash at training');
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

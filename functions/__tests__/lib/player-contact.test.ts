import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emailForSend, isContactSendable } from '../../lib/player-contact';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';
const OTHER = 'other-club';

const MIGRATION = readFileSync(
  resolve(__dirname, '../../../migrations/0029_add_player_contact.sql'),
  'utf8',
);

/** Strip comments and split the migration into executable statements. */
function migrationStatements(sql: string): string[] {
  const withoutLineComments = sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  return withoutLineComments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('player_contact schema', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createSchemaDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates the state machine and both opt-in columns', () => {
    const cols = db
      .prepare(`PRAGMA table_info("player_contact")`)
      .all() as { name: string; dflt_value: string | null; notnull: number }[];
    const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

    expect(byName.state.dflt_value).toBe("'pending'");
    expect(byName.operationalOptIn.dflt_value).toBe('0');
    expect(byName.marketingOptIn.dflt_value).toBe('0');
    for (const required of [
      'id', 'clubSlug', 'playerId', 'email', 'relationship', 'state',
      'operationalOptIn', 'marketingOptIn', 'sourcedBy', 'sourcedAt', 'signoffId',
      'confirmedAt', 'withdrawnAt', 'activationTokenHash', 'activationExpiresAt',
    ]) {
      expect(byName[required]).toBeDefined();
    }
  });

  it('allows the same address for two players in a club, and independently at another club', () => {
    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);

    db.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','pending',0,0,NULL,${NOW})`);
    db.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_2','${CLUB}','p2','parent@example.com','guardian','pending',0,0,NULL,${NOW})`);
    db.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_3','${OTHER}','p1','parent@example.com','guardian','pending',0,0,NULL,${NOW})`);

    const count = db.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number };
    expect(count.n).toBe(3);

    expect(() => {
      db.exec(`INSERT INTO "player_contact"
        (id, clubSlug, playerId, email, relationship, state,
         operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
        VALUES ('pc_dup','${CLUB}','p1','parent@example.com','guardian','pending',0,0,NULL,${NOW})`);
    }).toThrow();
  });

  it('can delete a contact without touching user, account or user_player', () => {
    db.exec(`INSERT INTO "user" VALUES
      ('u1','Guardian','guardian@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    db.exec(`INSERT INTO "account"
      (id, accountId, providerId, userId, password, createdAt, updatedAt)
      VALUES ('a1','guardian@example.com','credential','u1','hash',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    db.exec(`INSERT INTO "user_player" VALUES ('up1','u1','p1','guardian',${NOW})`);
    db.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','guardian@example.com','guardian','pending',0,0,NULL,${NOW})`);

    db.exec(`DELETE FROM "player_contact" WHERE id = 'pc_1'`);

    expect((db.prepare(`SELECT COUNT(*) AS n FROM "user"`).get() as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "account"`).get() as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "user_player"`).get() as { n: number }).n).toBe(1);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number }).n).toBe(0);
  });

  it('backfills import-created addresses as pending, never confirmed', () => {
    // Fresh schema already has the table from TABLE_STATEMENTS. Drop and
    // recreate via the migration file so the backfill INSERT actually runs.
    db.exec(`DROP TABLE IF EXISTS "player_contact"`);

    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    db.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
    // Import signature: empty name, role member, clubSlug set.
    db.exec(`INSERT INTO "user" VALUES
      ('u1','','parent@example.com',0,NULL,'member','${CLUB}',${NOW},${NOW})`);
    db.exec(`INSERT INTO "user" VALUES
      ('u2','Real Parent','real@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    db.exec(`INSERT INTO "user_player" VALUES ('up1','u1','p1','guardian',${NOW})`);
    db.exec(`INSERT INTO "user_player" VALUES ('up2','u1','p2','guardian',${NOW})`);
    db.exec(`INSERT INTO "user_player" VALUES ('up3','u2','p1','guardian',${NOW})`);

    for (const stmt of migrationStatements(MIGRATION)) {
      db.exec(stmt);
    }

    const rows = db
      .prepare(`SELECT email, state, operationalOptIn, marketingOptIn, playerId
                  FROM "player_contact" ORDER BY playerId`)
      .all() as {
        email: string; state: string; operationalOptIn: number;
        marketingOptIn: number; playerId: string;
      }[];

    // Only the empty-name import user is backfilled; two siblings → two rows.
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.email === 'parent@example.com')).toBe(true);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect(rows.every((r) => r.operationalOptIn === 0 && r.marketingOptIn === 0)).toBe(true);
    expect(rows.map((r) => r.playerId).sort()).toEqual(['p1', 'p2']);
  });
});

describe('emailForSend / isContactSendable', () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createSchemaDb();
    db.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
  });

  afterEach(() => {
    db.close();
  });

  function seed(over: {
    id?: string; state?: string; operational?: number; marketing?: number;
  } = {}) {
    const id = over.id ?? 'pc_1';
    const state = over.state ?? 'confirmed';
    const operational = over.operational ?? 1;
    const marketing = over.marketing ?? 0;
    db.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('${id}','${CLUB}','p1','parent@example.com','guardian','${state}',
              ${operational},${marketing},NULL,${NOW})`);
    return id;
  }

  it('rejects pending, withdrawn, bounced, and purpose mismatches', () => {
    expect(isContactSendable(
      { state: 'pending', operationalOptIn: 1, marketingOptIn: 1 }, 'operational',
    )).toBe(false);
    expect(isContactSendable(
      { state: 'withdrawn', operationalOptIn: 1, marketingOptIn: 1 }, 'operational',
    )).toBe(false);
    expect(isContactSendable(
      { state: 'bounced', operationalOptIn: 1, marketingOptIn: 1 }, 'operational',
    )).toBe(false);
    expect(isContactSendable(
      { state: 'confirmed', operationalOptIn: 0, marketingOptIn: 0 }, 'operational',
    )).toBe(false);
    expect(isContactSendable(
      { state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0 }, 'marketing',
    )).toBe(false);
    expect(isContactSendable(
      { state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0 }, 'operational',
    )).toBe(true);
  });

  it('returns the address only through the helper when eligible', async () => {
    const id = seed({ state: 'confirmed', operational: 1, marketing: 0 });
    const d1 = d1Over(db);

    expect(await emailForSend(d1 as any, CLUB, id, 'operational')).toBe('parent@example.com');
    expect(await emailForSend(d1 as any, CLUB, id, 'marketing')).toBeNull();
    expect(await emailForSend(d1 as any, CLUB, 'missing', 'operational')).toBeNull();
  });

  it('never returns a pending address', async () => {
    const id = seed({ state: 'pending', operational: 1, marketing: 1 });
    expect(await emailForSend(d1Over(db) as any, CLUB, id, 'operational')).toBeNull();
    expect(await emailForSend(d1Over(db) as any, CLUB, id, 'marketing')).toBeNull();
  });

  it('does not resolve a contact from another club', async () => {
    const id = seed({ state: 'confirmed', operational: 1, marketing: 0 });
    expect(await emailForSend(d1Over(db) as any, 'other-club', id, 'operational')).toBeNull();
    expect(await emailForSend(d1Over(db) as any, CLUB, id, 'operational')).toBe('parent@example.com');
  });
});

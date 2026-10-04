import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CONTACT_SUPPRESSION_SALT_V1,
  D1_FREE_QUERIES_PER_INVOCATION,
  D1_MAX_STATEMENTS_PER_BATCH,
  clearEmailSuppression,
  contactPurgeWriteStatements,
  hashContactEmailForSuppression,
  isEmailSuppressed,
  planBulkPurgeChunk,
  purgeContactsForClub,
  purgeContactsForTeam,
  purgeContactsMatchingEmail,
  purgePlayerContact,
} from '../../lib/contact-purge';
import { recordMarketingConsentGrant, currentMarketingConsentPolicy } from '../../lib/consent';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';
const EMAIL = 'parent@example.com';

function seedBase(sqlite: SqliteDb) {
  sqlite.exec(`INSERT INTO "user" VALUES
    ('u_parent','Parent One','${EMAIL}',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "user" VALUES
    ('u_admin','Admin','admin@example.com',1,NULL,'admin','${CLUB}',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "account"
    (id, accountId, providerId, userId, password, createdAt, updatedAt)
    VALUES ('acc1','u_parent','credential','u_parent','hashed-secret',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "user_player" VALUES ('up1','u_parent','p1','guardian',${NOW})`);
  sqlite.exec(`INSERT INTO "player_registration"
    (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
    VALUES ('reg1','${CLUB}','p1','U12 Blues','U12','2027-06-30','Active',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "player_registration"
    (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
    VALUES ('reg2','${CLUB}','p2','U10 Reds','U10','2027-06-30','Active',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "player_contact"
    (id, clubSlug, playerId, email, relationship, state,
     operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
    VALUES ('pc_1','${CLUB}','p1','${EMAIL}','guardian','confirmed',1,0,NULL,${NOW})`);
  sqlite.exec(`INSERT INTO "player_contact"
    (id, clubSlug, playerId, email, relationship, state,
     operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
    VALUES ('pc_2','${CLUB}','p2','other@example.com','guardian','pending',0,0,NULL,${NOW})`);
  sqlite.exec(`INSERT INTO "player_payment"
    (id, clubSlug, registrationId, reference, mandateId, status, createdAt, updatedAt)
    VALUES ('pay1','${CLUB}','reg1','ref1','man1','active',${NOW},${NOW})`);
}

describe('contact purge (#134)', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    seedBase(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('hard-deletes the contact row and related consent', async () => {
    const db = d1Over(sqlite);
    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const result = await purgePlayerContact(db as any, {
      clubSlug: CLUB,
      contactId: 'pc_1',
      actor: { actorId: 'u_admin', source: 'admin' },
    });
    expect(result).toEqual({
      contactId: 'pc_1',
      playerId: 'p1',
      clubSlug: CLUB,
    });

    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact" WHERE id = 'pc_1'`).get() as { n: number }).n,
    ).toBe(0);
    expect(
      (sqlite.prepare(
        `SELECT COUNT(*) AS n FROM "consent_record" WHERE subjectId = 'pc_1'`,
      ).get() as { n: number }).n,
    ).toBe(0);
  });

  it.each(['not-an-email', '', '   ', `${'x'.repeat(250)}@example.com`])(
    'purges invalid stored email %j and its consent without adding suppression',
    async (email) => {
      sqlite.prepare('UPDATE "player_contact" SET email = ? WHERE id = ?').run!(email, 'pc_1');
      const db = d1Over(sqlite) as any;
      const policy = await currentMarketingConsentPolicy();
      await recordMarketingConsentGrant(db, {
        clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc_1',
        ipAddress: null, policy,
      });
      const purged = (await purgeContactsForClub(db, { clubSlug: CLUB, actorId: 'u_admin' })).purged;
      expect(purged).toHaveLength(2);
      expect(sqlite.prepare('SELECT * FROM "player_contact"').all()).toEqual([]);
      expect(sqlite.prepare('SELECT * FROM "consent_record"').all()).toEqual([]);
      // The other, valid contact still gets suppression and both get audits.
      expect(sqlite.prepare('SELECT * FROM "contact_email_suppression"').all()).toHaveLength(1);
      expect(await isEmailSuppressed(db, CLUB, 'other@example.com')).toBe(true);
      expect(sqlite.prepare('SELECT * FROM "admin_audit_log"').all()).toHaveLength(2);
    },
  );

  it('leaves FAN, registration, payment and parent account intact', async () => {
    const db = d1Over(sqlite);
    await purgePlayerContact(db as any, {
      clubSlug: CLUB,
      contactId: 'pc_1',
      actor: { actorId: 'u_admin', source: 'admin' },
    });

    expect(
      (sqlite.prepare(`SELECT fanId FROM "player" WHERE id = 'p1'`).get() as { fanId: string }).fanId,
    ).toBe('FAN001');
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_registration" WHERE id = 'reg1'`).get() as { n: number }).n,
    ).toBe(1);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_payment" WHERE id = 'pay1'`).get() as { n: number }).n,
    ).toBe(1);
    const user = sqlite.prepare(`SELECT email, name FROM "user" WHERE id = 'u_parent'`).get() as {
      email: string; name: string;
    };
    expect(user.email).toBe(EMAIL);
    expect(user.name).toBe('Parent One');
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "account" WHERE userId = 'u_parent'`).get() as { n: number }).n,
    ).toBe(1);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "user_player" WHERE userId = 'u_parent'`).get() as { n: number }).n,
    ).toBe(1);
  });

  it('stores a salted hash so silent re-import is blocked', async () => {
    const db = d1Over(sqlite);
    await purgePlayerContact(db as any, {
      clubSlug: CLUB,
      contactId: 'pc_1',
      actor: { actorId: 'u_admin', source: 'admin' },
    });

    expect(await isEmailSuppressed(db as any, CLUB, EMAIL)).toBe(true);
    expect(await isEmailSuppressed(db as any, CLUB, 'other@example.com')).toBe(false);
    expect(await isEmailSuppressed(db as any, 'other-club', EMAIL)).toBe(false);

    const row = sqlite.prepare(
      `SELECT emailHash, salt, hashVersion FROM "contact_email_suppression" WHERE clubSlug = ?`,
    ).get(CLUB) as { emailHash: string; salt: string; hashVersion: number };
    expect(row.salt).toBe(CONTACT_SUPPRESSION_SALT_V1);
    expect(row.hashVersion).toBe(1);
    // Never store plaintext.
    const dump = JSON.stringify(
      sqlite.prepare(`SELECT * FROM "contact_email_suppression"`).all(),
    );
    expect(dump.toLowerCase()).not.toContain(EMAIL);
    expect(dump.toLowerCase()).not.toContain('parent@');

    const expected = await hashContactEmailForSuppression(CLUB, EMAIL);
    expect(row.emailHash).toBe(expected.emailHash);
  });

  it('audit entry records player + admin and never the deleted address', async () => {
    const db = d1Over(sqlite);
    await purgePlayerContact(db as any, {
      clubSlug: CLUB,
      contactId: 'pc_1',
      actor: { actorId: 'u_admin', source: 'admin' },
    });

    const audit = sqlite.prepare(
      `SELECT action, targetTable, targetId, adminId, clubSlug, note FROM "admin_audit_log"`,
    ).get() as {
      action: string; targetTable: string; targetId: string;
      adminId: string; clubSlug: string; note: string;
    };
    expect(audit.action).toBe('contact_purged');
    expect(audit.targetTable).toBe('player_contact');
    expect(audit.targetId).toBe('pc_1');
    expect(audit.adminId).toBe('u_admin');
    expect(audit.clubSlug).toBe(CLUB);
    expect(audit.note).toContain('playerId=p1');
    expect(audit.note.toLowerCase()).not.toContain(EMAIL);
    expect(JSON.stringify(audit).toLowerCase()).not.toContain('parent@');
  });

  it('bulk purges by team with one audit entry per contact', async () => {
    // Second contact on the same team.
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1b','${CLUB}','p1','sibling@example.com','guardian','pending',0,0,NULL,${NOW})`);

    const db = d1Over(sqlite);
    const page = await purgeContactsForTeam(db as any, {
      clubSlug: CLUB,
      teamName: 'U12 Blues',
      actorId: 'u_admin',
    });
    expect(page.remaining).toBe(0);
    expect(page.cursor).toBeNull();
    const purged = page.purged;
    expect(purged.map((p) => p.contactId).sort()).toEqual(['pc_1', 'pc_1b']);
    // Other team's contact survives.
    expect(
      (sqlite.prepare(`SELECT id FROM "player_contact" WHERE id = 'pc_2'`).get() as { id: string }).id,
    ).toBe('pc_2');

    const audits = sqlite.prepare(
      `SELECT action, targetId FROM "admin_audit_log" ORDER BY targetId`,
    ).all() as Array<{ action: string; targetId: string }>;
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => a.action === 'contact_purged_bulk_team')).toBe(true);
    expect(audits.map((a) => a.targetId)).toEqual(['pc_1', 'pc_1b']);
  });

  it('bulk purges by club', async () => {
    const db = d1Over(sqlite);
    const purged = (await purgeContactsForClub(db as any, {
      clubSlug: CLUB,
      actorId: 'u_admin',
    })).purged;
    expect(purged).toHaveLength(2);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number }).n,
    ).toBe(0);
    const audits = sqlite.prepare(
      `SELECT COUNT(*) AS n FROM "admin_audit_log" WHERE action = 'contact_purged_bulk_club'`,
    ).get() as { n: number };
    expect(audits.n).toBe(2);
  });

  it('parent self-purge removes matching contacts without destroying login', async () => {
    const db = d1Over(sqlite);
    const purged = await purgeContactsMatchingEmail(db as any, {
      clubSlug: CLUB,
      email: EMAIL,
      actorId: 'u_parent',
      source: 'parent',
    });
    expect(purged).toHaveLength(1);
    expect(purged[0].contactId).toBe('pc_1');
    // Unrelated address remains.
    expect(
      (sqlite.prepare(`SELECT email FROM "player_contact" WHERE id = 'pc_2'`).get() as { email: string }).email,
    ).toBe('other@example.com');
    const user = sqlite.prepare(`SELECT email FROM "user" WHERE id = 'u_parent'`).get() as { email: string };
    expect(user.email).toBe(EMAIL);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "account" WHERE userId = 'u_parent'`).get() as { n: number }).n,
    ).toBe(1);
    const audit = sqlite.prepare(
      `SELECT action, adminId, note FROM "admin_audit_log"`,
    ).get() as { action: string; adminId: string; note: string };
    expect(audit.action).toBe('contact_purged_by_parent');
    expect(audit.adminId).toBe('u_parent');
    expect(audit.note.toLowerCase()).not.toContain(EMAIL);
  });

  it('clearEmailSuppression allows explicit admin re-add', async () => {
    const db = d1Over(sqlite);
    await purgePlayerContact(db as any, {
      clubSlug: CLUB,
      contactId: 'pc_1',
      actor: { actorId: 'u_admin', source: 'admin' },
    });
    expect(await isEmailSuppressed(db as any, CLUB, EMAIL)).toBe(true);
    expect(await clearEmailSuppression(db as any, CLUB, EMAIL)).toBe(true);
    expect(await isEmailSuppressed(db as any, CLUB, EMAIL)).toBe(false);
  });

  it('caps a bulk chunk under the Free D1 query budget and continues', async () => {
    const emails = Array.from({ length: 30 }, (_, i) => ({
      email: i === 10 ? 'not-an-email' : `parent${String(i).padStart(2, '0')}@example.com`,
    }));
    const planned = planBulkPurgeChunk(emails);
    expect(planned.chunk.length).toBeGreaterThan(0);
    expect(planned.chunk.length).toBeLessThan(emails.length);
    expect(planned.statements).toBeLessThanOrEqual(D1_MAX_STATEMENTS_PER_BATCH);
    expect(1 + planned.statements).toBeLessThan(D1_FREE_QUERIES_PER_INVOCATION);
    expect(planned.statements).toBe(
      planned.chunk.reduce((n, row) => n + contactPurgeWriteStatements(row.email), 0),
    );

    sqlite.exec(`DELETE FROM "player_contact"`);
    for (const [i, row] of emails.entries()) {
      const id = `pc_${String(i).padStart(2, '0')}`;
      sqlite.prepare(`INSERT INTO "player_contact"
        (id, clubSlug, playerId, email, relationship, state,
         operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
        VALUES (?, ?, 'p1', ?, 'guardian', 'pending', 0, 0, NULL, ?)`).run!(id, CLUB, row.email, NOW);
    }

    const raw = d1Over(sqlite);
    let executed = 0;
    let batchCalls = 0;
    let maxBatch = 0;
    const countExec = <T extends { all: Function; first: Function; run: Function }>(bound: T) => ({
      ...bound,
      all: async (...args: unknown[]) => { executed += 1; return bound.all(...args); },
      first: async (...args: unknown[]) => { executed += 1; return bound.first(...args); },
      run: async (...args: unknown[]) => { executed += 1; return bound.run(...args); },
    });
    const db = {
      prepare(sql: string) {
        const stmt = raw.prepare(sql) as { bind: (...params: unknown[]) => { all: Function; first: Function; run: Function } };
        return {
          bind: (...params: unknown[]) => countExec(stmt.bind(...params)),
        };
      },
      async batch(statements: unknown[]) {
        batchCalls += 1;
        maxBatch = Math.max(maxBatch, statements.length);
        executed += statements.length;
        return raw.batch(statements);
      },
    };

    const first = await purgeContactsForClub(db as any, { clubSlug: CLUB, actorId: 'u_admin' });
    expect(batchCalls).toBe(1);
    expect(maxBatch).toBeLessThanOrEqual(D1_MAX_STATEMENTS_PER_BATCH);
    expect(executed).toBeLessThan(D1_FREE_QUERIES_PER_INVOCATION);
    expect(first.purged.map((row) => row.contactId)).toEqual(
      planned.chunk.map((_, i) => `pc_${String(i).padStart(2, '0')}`),
    );
    expect(first.remaining).toBe(emails.length - planned.chunk.length);
    expect(first.cursor).toBe(first.purged[first.purged.length - 1].contactId);
    // A committed chunk is reported even though more contacts remain.
    expect(first.purged.length).toBeGreaterThan(0);

    executed = 0;
    batchCalls = 0;
    maxBatch = 0;
    const seen = new Set(first.purged.map((row) => row.contactId));
    let cursor = first.cursor;
    let remaining = first.remaining;
    while (remaining > 0) {
      const next = await purgeContactsForClub(db as any, {
        clubSlug: CLUB,
        actorId: 'u_admin',
        cursor,
      });
      expect(next.purged.length).toBeGreaterThan(0);
      expect(batchCalls).toBeGreaterThan(0);
      expect(maxBatch).toBeLessThanOrEqual(D1_MAX_STATEMENTS_PER_BATCH);
      for (const row of next.purged) seen.add(row.contactId);
      remaining = next.remaining;
      cursor = next.cursor;
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(emails.length);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number }).n,
    ).toBe(0);
  });

  it('team purge continues from the cursor without repeating a committed chunk', async () => {
    sqlite.exec(`DELETE FROM "player_contact"`);
    const total = 20;
    for (let i = 0; i < total; i += 1) {
      sqlite.prepare(`INSERT INTO "player_contact"
        (id, clubSlug, playerId, email, relationship, state,
         operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
        VALUES (?, ?, 'p1', ?, 'guardian', 'pending', 0, 0, NULL, ?)`).run!(
        `tm_${String(i).padStart(2, '0')}`,
        CLUB,
        `team${i}@example.com`,
        NOW,
      );
    }
    const db = d1Over(sqlite) as any;
    const first = await purgeContactsForTeam(db, {
      clubSlug: CLUB,
      teamName: 'U12 Blues',
      actorId: 'u_admin',
    });
    expect(first.remaining).toBeGreaterThan(0);
    expect(first.cursor).toBeTruthy();
    const second = await purgeContactsForTeam(db, {
      clubSlug: CLUB,
      teamName: 'u12 blues',
      actorId: 'u_admin',
      cursor: first.cursor,
    });
    const ids = [...first.purged, ...second.purged].map((row) => row.contactId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(second.purged[0].contactId > first.cursor!).toBe(true);
    let cursor = second.cursor;
    let remaining = second.remaining;
    const seen = new Set(ids);
    while (remaining > 0 && cursor) {
      const next = await purgeContactsForTeam(db, {
        clubSlug: CLUB, teamName: 'U12 Blues', actorId: 'u_admin', cursor,
      });
      for (const row of next.purged) seen.add(row.contactId);
      remaining = next.remaining;
      cursor = next.cursor;
    }
    expect(remaining).toBe(0);
    expect(seen.size).toBe(total);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number }).n,
    ).toBe(0);
  });
});

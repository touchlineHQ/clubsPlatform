import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteMemberData,
  exportMemberData,
  LastAdminDeleteError,
} from '../../lib/member-data';
import { recordMarketingConsentGrant, currentMarketingConsentPolicy } from '../../lib/consent';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

describe('member data export/delete', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u_member','Parent One','parent@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u_admin','Admin','admin@example.com',1,NULL,'admin','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user_player" VALUES ('up1','u_member','p1','guardian',${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('reg1','${CLUB}','p1','U12 Blues','U12','2027-06-30','Registered',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','confirmed',1,0,NULL,${NOW})`);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('exports club-scoped personal data for a member', async () => {
    const db = d1Over(sqlite);
    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const bundle = await exportMemberData(db as any, CLUB, 'u_member');
    expect(bundle).not.toBeNull();
    expect(bundle!.user.email).toBe('parent@example.com');
    expect(bundle!.players).toEqual([
      expect.objectContaining({ fanId: 'FAN001', relationship: 'guardian' }),
    ]);
    expect(bundle!.registrations).toHaveLength(1);
    expect(bundle!.contacts).toHaveLength(1);
    expect(bundle!.consentRecords.some((c) => c.state === 'granted')).toBe(true);
  });

  it('excludes a linked player that has no registration or contact at this club', async () => {
    sqlite.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user_player" VALUES ('up2','u_member','p2','guardian',${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('reg2','other-club','p2','U12 Reds','U12','2027-06-30','Registered',${NOW},${NOW})`);

    const bundle = await exportMemberData(d1Over(sqlite) as any, CLUB, 'u_member');
    expect(bundle!.players.map((p) => p.fanId)).toEqual(['FAN001']);
  });

  it('deletes contacts and consent while retaining the FAN registration', async () => {
    const db = d1Over(sqlite);
    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const result = await deleteMemberData(db as any, {
      clubSlug: CLUB,
      userId: 'u_member',
      adminId: 'u_admin',
    });
    expect(result).toEqual(expect.objectContaining({
      deletedContacts: 1,
      deletedConsentRecords: 1,
      anonymisedUser: true,
    }));

    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM "consent_record"`).get() as { n: number }).n).toBe(0);
    expect((sqlite.prepare(`SELECT fanId FROM "player" WHERE id = 'p1'`).get() as { fanId: string }).fanId)
      .toBe('FAN001');
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_registration"`).get() as { n: number }).n)
      .toBe(1);

    const user = sqlite.prepare(`SELECT name, email FROM "user" WHERE id = 'u_member'`).get() as {
      name: string; email: string;
    };
    expect(user.name).toBe('');
    expect(user.email).toContain('deleted+');
    expect(user.email).not.toContain('parent@');

    const audit = sqlite.prepare(
      `SELECT action, note FROM "admin_audit_log" WHERE targetId = 'u_member'`,
    ).get() as { action: string; note: string };
    expect(audit.action).toBe('member_data_deleted');
    expect(audit.note).not.toContain('parent@');
  });

  function seedPrivateData() {
    for (const userId of ['u_member', 'u_admin']) {
      sqlite.prepare(`INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
        VALUES (?, ?, ?, ?, ?, ?)`).run!(userId, NOW + 10000, `token-${userId}`, NOW, NOW, userId);
      sqlite.prepare(`INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, 'stored-hash', ?, ?)`).run!(userId, userId, userId, NOW, NOW);
    }
    for (const [id, userId, clubSlug] of [
      ['local', 'u_member', CLUB], ['unscoped', 'u_member', null],
      ['other-club', 'u_member', 'other'], ['other-user', 'u_admin', CLUB],
    ]) {
      sqlite.prepare(`INSERT INTO booking_request
        (id, userId, clubSlug, teamName, date, timeStart, timeEnd, format, notes, createdAt, updatedAt)
        VALUES (?, ?, ?, 'U12', '2026-09-01', '10:00', '11:00', '5v5', 'private notes', ?, ?)`)
        .run!(id, userId, clubSlug, NOW, NOW);
    }
  }

  it('clears scoped and unscoped booking notes and revokes only the deleted user authentication', async () => {
    seedPrivateData();
    await deleteMemberData(d1Over(sqlite) as any, { clubSlug: CLUB, userId: 'u_member', adminId: 'u_admin' });
    expect(sqlite.prepare(`SELECT id, notes FROM booking_request ORDER BY id`).all()).toEqual([
      { id: 'local', notes: null }, { id: 'other-club', notes: 'private notes' },
      { id: 'other-user', notes: 'private notes' }, { id: 'unscoped', notes: null },
    ]);
    for (const table of ['session', 'account']) {
      expect(sqlite.prepare(`SELECT userId FROM "${table}"`).all()).toEqual([{ userId: 'u_admin' }]);
    }
  });

  it('rolls back notes and credential revocation if anonymization fails', async () => {
    seedPrivateData();
    sqlite.exec(`CREATE TRIGGER fail_anonymization BEFORE UPDATE ON user
      BEGIN SELECT RAISE(ABORT, 'forced anonymization failure'); END`);
    await expect(deleteMemberData(d1Over(sqlite) as any, {
      clubSlug: CLUB, userId: 'u_member', adminId: 'u_admin',
    })).rejects.toThrow('forced anonymization failure');
    expect(sqlite.prepare(`SELECT DISTINCT notes FROM booking_request`).all()).toEqual([{ notes: 'private notes' }]);
    for (const table of ['session', 'account']) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()).toEqual({ n: 2 });
    }
    expect(sqlite.prepare(`SELECT email FROM user WHERE id = 'u_member'`).get()).toEqual({ email: 'parent@example.com' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM player_contact`).get()).toEqual({ n: 1 });
  });

  it('refuses to delete the last admin', async () => {
    const db = d1Over(sqlite);
    await expect(deleteMemberData(db as any, {
      clubSlug: CLUB,
      userId: 'u_admin',
      adminId: 'u_admin',
    })).rejects.toBeInstanceOf(LastAdminDeleteError);
  });
});

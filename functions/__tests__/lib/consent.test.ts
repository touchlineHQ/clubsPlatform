import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MARKETING_CONSENT_POLICY_VERSION,
  MARKETING_CONSENT_WORDING,
  currentMarketingConsentPolicy,
  hasCurrentMarketingConsent,
  hashWording,
  parseConsentPolicy,
  recordMarketingConsentGrant,
  unsubscribePath,
  withdrawMarketingConsentByToken,
} from '../../lib/consent';
import { emailForSend } from '../../lib/player-contact';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

describe('marketing consent policy', () => {
  it('exposes versioned wording with a stable sha-256 hash', async () => {
    const payload = await currentMarketingConsentPolicy();
    expect(payload.policyVersion).toBe(MARKETING_CONSENT_POLICY_VERSION);
    expect(payload.wording).toBe(MARKETING_CONSENT_WORDING);
    expect(payload.wordingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.wordingHash).toBe(await hashWording(MARKETING_CONSENT_WORDING));
  });

  it('rejects incomplete policy submissions', () => {
    expect(parseConsentPolicy(null)).toBeNull();
    expect(parseConsentPolicy({ policyVersion: '1' })).toBeNull();
    expect(parseConsentPolicy({ policyVersion: '1', wordingHash: 'abc' })).toEqual({
      policyVersion: '1',
      wordingHash: 'abc',
    });
  });
});

async function validPolicy() {
  const payload = await currentMarketingConsentPolicy();
  return { policyVersion: payload.policyVersion, wordingHash: payload.wordingHash };
}

describe('consent_record persistence', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','confirmed',
              1,0,NULL,${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('reg_1','${CLUB}','p1','U12',NULL,NULL,'Active',${NOW},${NOW})`);
  });

  afterEach(() => {
    sqlite.close();
  });

  it('records grant with policy version, wording hash and withdraw token hash', async () => {
    const db = d1Over(sqlite);
    const { recordId, withdrawToken } = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: '203.0.113.9',
      policy: await validPolicy(),
    });

    expect(recordId).toMatch(/^consent_/);
    expect(withdrawToken).toMatch(/^[a-f0-9]{64}$/);
    expect(unsubscribePath(withdrawToken)).toContain(withdrawToken);

    const row = sqlite.prepare(
      `SELECT cr.state AS state, cr.policyVersion, cr.wordingHash, cr.withdrawTokenHash,
              cr.ipAddress, pc.marketingOptIn
         FROM "consent_record" cr
         JOIN "player_contact" pc ON pc.id = cr.subjectId
        WHERE cr.id = ?`,
    ).get(recordId) as {
      state: string; policyVersion: string; wordingHash: string;
      withdrawTokenHash: string; ipAddress: string; marketingOptIn: number;
    };

    expect(row.state).toBe('granted');
    expect(row.policyVersion).toBe(MARKETING_CONSENT_POLICY_VERSION);
    expect(row.wordingHash).toBe((await validPolicy()).wordingHash);
    expect(row.withdrawTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.withdrawTokenHash).not.toBe(withdrawToken);
    expect(row.ipAddress).toBe('203.0.113.9');
    expect(row.marketingOptIn).toBe(1);
    expect(await hasCurrentMarketingConsent(db as any, CLUB, 'player_contact', 'pc_1')).toBe(true);
  });

  it('keeps an older policy version on existing grants when wording changes are simulated', async () => {
    const db = d1Over(sqlite);
    await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: await validPolicy(),
    });

    // Simulate a historical grant under an older wording — insert directly.
    sqlite.exec(`INSERT INTO "consent_record"
      (id, clubSlug, subjectType, subjectId, purpose, channel, state,
       recordedAt, ipAddress, policyVersion, wordingHash, withdrawTokenHash, supersedesId)
      VALUES ('consent_old','${CLUB}','player_contact','pc_1','marketing','email','granted',
              ${NOW - 10_000},NULL,'0','oldhash',NULL,NULL)`);

    const versions = sqlite.prepare(
      `SELECT DISTINCT policyVersion FROM "consent_record" WHERE subjectId = 'pc_1' ORDER BY policyVersion`,
    ).all() as { policyVersion: string }[];
    expect(versions.map((v) => v.policyVersion)).toEqual(['0', MARKETING_CONSENT_POLICY_VERSION]);
  });

  it('withdraws via one-click token and blocks marketing send afterwards', async () => {
    const db = d1Over(sqlite);
    const { withdrawToken } = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: await validPolicy(),
    });

    expect(await emailForSend(db as any, CLUB, 'pc_1', 'marketing')).toBe('parent@example.com');

    const result = await withdrawMarketingConsentByToken(db as any, withdrawToken, '198.51.100.1');
    expect(result.ok).toBe(true);
    expect(await hasCurrentMarketingConsent(db as any, CLUB, 'player_contact', 'pc_1')).toBe(false);
    expect(await emailForSend(db as any, CLUB, 'pc_1', 'marketing')).toBeNull();
    // Operational still allowed when opted in
    expect(await emailForSend(db as any, CLUB, 'pc_1', 'operational')).toBe('parent@example.com');

    const optIn = sqlite.prepare(
      `SELECT marketingOptIn FROM "player_contact" WHERE id = 'pc_1'`,
    ).get() as { marketingOptIn: number };
    expect(optIn.marketingOptIn).toBe(0);

    // Idempotent second click
    const again = await withdrawMarketingConsentByToken(db as any, withdrawToken, null);
    expect(again.ok).toBe(true);
  });

  it('rolls back withdrawal when the contact mirror update fails', async () => {
    const db = d1Over(sqlite);
    const { withdrawToken } = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc_1',
      ipAddress: null, policy: await validPolicy(),
    });
    sqlite.exec(`CREATE TRIGGER fail_mirror BEFORE UPDATE ON player_contact
      BEGIN SELECT RAISE(ABORT, 'forced mirror failure'); END`);
    await expect(withdrawMarketingConsentByToken(db as any, withdrawToken, null)).rejects.toThrow('forced mirror failure');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM consent_record WHERE state = 'withdrawn'`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT marketingOptIn FROM player_contact`).get()).toEqual({ marketingOptIn: 1 });
    sqlite.exec(`DROP TRIGGER fail_mirror`);
    expect((await withdrawMarketingConsentByToken(db as any, withdrawToken, null)).ok).toBe(true);
    expect(sqlite.prepare(`SELECT marketingOptIn FROM player_contact`).get()).toEqual({ marketingOptIn: 0 });
  });

  it('withdraws consent for a user subject without changing player contacts', async () => {
    const db = d1Over(sqlite);
    const { withdrawToken } = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB, subjectType: 'user', subjectId: 'u1',
      ipAddress: null, policy: await validPolicy(),
    });
    sqlite.exec(`CREATE TRIGGER fail_mirror BEFORE UPDATE ON player_contact
      BEGIN SELECT RAISE(ABORT, 'unexpected mirror update'); END`);
    expect((await withdrawMarketingConsentByToken(db as any, withdrawToken, null)).ok).toBe(true);
    expect(await hasCurrentMarketingConsent(db as any, CLUB, 'user', 'u1')).toBe(false);
  });

  it('uses an older unsubscribe token to withdraw a newer grant', async () => {
    const db = d1Over(sqlite);
    const policy = await validPolicy();
    const first = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc_1',
      ipAddress: null, policy,
    });
    await withdrawMarketingConsentByToken(db as any, first.withdrawToken, null);
    const second = await recordMarketingConsentGrant(db as any, {
      clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc_1',
      ipAddress: null, policy,
    });
    expect(await hasCurrentMarketingConsent(db as any, CLUB, 'player_contact', 'pc_1')).toBe(true);

    const result = await withdrawMarketingConsentByToken(db as any, first.withdrawToken, null);
    expect(result.ok).toBe(true);
    expect(await hasCurrentMarketingConsent(db as any, CLUB, 'player_contact', 'pc_1')).toBe(false);
    expect(await emailForSend(db as any, CLUB, 'pc_1', 'marketing')).toBeNull();
    expect(second.withdrawToken).not.toBe(first.withdrawToken);
  });

  it('does not send marketing when marketingOptIn is stale without a consent_record', async () => {
    sqlite.exec(`UPDATE "player_contact" SET marketingOptIn = 1 WHERE id = 'pc_1'`);
    const db = d1Over(sqlite);
    expect(await emailForSend(db as any, CLUB, 'pc_1', 'marketing')).toBeNull();
    expect(await emailForSend(db as any, CLUB, 'pc_1', 'operational')).toBe('parent@example.com');
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EMAIL_SIGNOFF_LIABILITIES,
  EMAIL_SIGNOFF_LIABILITY_IDS,
  EMAIL_SIGNOFF_POLICY_VERSION,
  currentAcceptedLiabilities,
  currentPolicyPayload,
  currentSignoffAcceptanceId,
  hasCurrentEmailSignoff,
  hashWording,
  parseSignoffTicks,
  recordEmailSignoff,
  requestIp,
} from '../../lib/club-email-signoff';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const ALL_TICKS = {
  operational_split: true,
  right_to_object: true,
} as const;

describe('club-email-signoff policy', () => {
  it('exposes exactly two independently named liabilities under v2', () => {
    expect(EMAIL_SIGNOFF_POLICY_VERSION).toBe('2');
    expect(EMAIL_SIGNOFF_LIABILITY_IDS).toEqual([
      'operational_split',
      'right_to_object',
    ]);
    for (const id of EMAIL_SIGNOFF_LIABILITY_IDS) {
      expect(EMAIL_SIGNOFF_LIABILITIES[id].wording.length).toBeGreaterThan(20);
    }
  });

  it('does not call TouchlineHQ a processor or third party in current wording', () => {
    const joined = EMAIL_SIGNOFF_LIABILITY_IDS
      .map((id) => EMAIL_SIGNOFF_LIABILITIES[id].wording)
      .join(' ')
      .toLowerCase();
    expect(joined).not.toMatch(/touchline/);
    expect(joined).not.toMatch(/processor/);
    expect(joined).not.toMatch(/third[- ]party/);
  });

  it('hashes wording stably (sha-256 hex)', async () => {
    const a = await hashWording(EMAIL_SIGNOFF_LIABILITIES.operational_split.wording);
    const b = await hashWording(EMAIL_SIGNOFF_LIABILITIES.operational_split.wording);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    const other = await hashWording(EMAIL_SIGNOFF_LIABILITIES.right_to_object.wording);
    expect(other).not.toBe(a);
  });

  it('rejects partial or bundled tick payloads', () => {
    expect(parseSignoffTicks(null)).toBeNull();
    expect(parseSignoffTicks({ operational_split: true })).toBeNull();
    expect(parseSignoffTicks({
      operational_split: true,
      right_to_object: false,
    })).toBeNull();
    // Legacy parental_consent alone / with only one current tick is not enough
    expect(parseSignoffTicks({
      parental_consent: true,
      operational_split: true,
      right_to_object: true,
    })).toEqual(ALL_TICKS);
    expect(parseSignoffTicks(ALL_TICKS)).toEqual(ALL_TICKS);
  });

  it('reads CF-Connecting-IP preferentially', () => {
    const req = new Request('https://example.test', {
      headers: {
        'CF-Connecting-IP': '203.0.113.9',
        'X-Forwarded-For': '198.51.100.1, 203.0.113.9',
      },
    });
    expect(requestIp(req)).toBe('203.0.113.9');
  });
});

async function validPolicy() {
  const payload = await currentPolicyPayload();
  return {
    policyVersion: payload.policyVersion,
    wordingHashes: Object.fromEntries(payload.liabilities.map((l) => [l.id, l.wordingHash])) as any,
  };
}

describe('club-email-signoff persistence', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('records one row per liability with version and wording hash', async () => {
    const db = d1Over(sqlite);

    const { acceptanceId } = await recordEmailSignoff(db as any, {
      clubSlug: 'test-club',
      userId: 'user_1',
      ipAddress: '203.0.113.9',
      ticks: ALL_TICKS,
      policy: await validPolicy(),
    });

    expect(acceptanceId).toMatch(/^emsign_/);
    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(true);
    expect(await currentSignoffAcceptanceId(db as any, 'test-club')).toBe(acceptanceId);

    const rows = sqlite.prepare(
      `SELECT liability, policyVersion, wordingHash, userId, ipAddress, acceptanceId
         FROM "club_email_signoff" ORDER BY liability`,
    ).all() as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.policyVersion === EMAIL_SIGNOFF_POLICY_VERSION)).toBe(true);
    expect(rows.every((r) => r.acceptanceId === acceptanceId)).toBe(true);
    expect(rows.every((r) => r.userId === 'user_1')).toBe(true);
    expect(rows.every((r) => r.ipAddress === '203.0.113.9')).toBe(true);

    for (const row of rows) {
      const id = row.liability as keyof typeof EMAIL_SIGNOFF_LIABILITIES;
      expect(row.wordingHash).toBe(await hashWording(EMAIL_SIGNOFF_LIABILITIES[id].wording));
    }
  });

  it('treats a club with only partial acceptance as unsigned', async () => {
    const db = d1Over(sqlite);
    const hash = await hashWording(EMAIL_SIGNOFF_LIABILITIES.operational_split.wording);
    sqlite.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('r1','a1','test-club','operational_split','user_1',1,NULL,'${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(false);
    expect(await currentAcceptedLiabilities(db as any, 'test-club')).toEqual(['operational_split']);
  });

  it('fills a partial shared acceptance atomically under one acceptanceId', async () => {
    const db = d1Over(sqlite);
    const policy = await validPolicy();
    const hash = await hashWording(EMAIL_SIGNOFF_LIABILITIES.operational_split.wording);
    sqlite.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('partial','shared_a','test-club','operational_split','user_1',1,NULL,'${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);

    const { acceptanceId } = await recordEmailSignoff(db as any, {
      clubSlug: 'test-club', userId: 'user_2', ipAddress: null,
      ticks: ALL_TICKS,
      policy,
    });
    expect(acceptanceId).toBe('shared_a');
    const rows = sqlite.prepare(`SELECT DISTINCT acceptanceId FROM "club_email_signoff" WHERE clubSlug = 'test-club'`).all() as { acceptanceId: string }[];
    expect(rows).toEqual([{ acceptanceId: 'shared_a' }]);
  });

  it('keeps old-version rows but treats the club as unsigned for new collection', async () => {
    const db = d1Over(sqlite);
    // Historical v1 accepted all three liabilities (including removed parental_consent)
    for (const liability of ['parental_consent', 'operational_split', 'right_to_object']) {
      sqlite.exec(`INSERT INTO "club_email_signoff"
        (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
        VALUES ('old_${liability}','old_a','test-club','${liability}','user_1',1,NULL,'1','oldhash_${liability}')`);
    }

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(false);

    await recordEmailSignoff(db as any, {
      clubSlug: 'test-club',
      userId: 'user_2',
      ipAddress: null,
      ticks: ALL_TICKS,
      policy: await validPolicy(),
    });

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(true);
    const versions = sqlite.prepare(
      `SELECT DISTINCT policyVersion AS v FROM "club_email_signoff" WHERE clubSlug = 'test-club' ORDER BY v`,
    ).all() as { v: string }[];
    expect(versions.map((r) => r.v)).toEqual(['1', EMAIL_SIGNOFF_POLICY_VERSION]);
  });
});

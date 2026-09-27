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

describe('club-email-signoff policy', () => {
  it('exposes exactly three independently named liabilities', () => {
    expect(EMAIL_SIGNOFF_LIABILITY_IDS).toEqual([
      'parental_consent',
      'operational_split',
      'right_to_object',
    ]);
    for (const id of EMAIL_SIGNOFF_LIABILITY_IDS) {
      expect(EMAIL_SIGNOFF_LIABILITIES[id].wording.length).toBeGreaterThan(20);
    }
  });

  it('hashes wording stably (sha-256 hex)', async () => {
    const a = await hashWording(EMAIL_SIGNOFF_LIABILITIES.parental_consent.wording);
    const b = await hashWording(EMAIL_SIGNOFF_LIABILITIES.parental_consent.wording);
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    const other = await hashWording(EMAIL_SIGNOFF_LIABILITIES.operational_split.wording);
    expect(other).not.toBe(a);
  });

  it('rejects partial or bundled tick payloads', () => {
    expect(parseSignoffTicks(null)).toBeNull();
    expect(parseSignoffTicks({ parental_consent: true })).toBeNull();
    expect(parseSignoffTicks({
      parental_consent: true,
      operational_split: true,
      right_to_object: false,
    })).toBeNull();
    expect(parseSignoffTicks({
      parental_consent: true,
      operational_split: true,
      right_to_object: true,
    })).toEqual({
      parental_consent: true,
      operational_split: true,
      right_to_object: true,
    });
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
    const ticks = {
      parental_consent: true,
      operational_split: true,
      right_to_object: true,
    } as const;

    const { acceptanceId } = await recordEmailSignoff(db as any, {
      clubSlug: 'test-club',
      userId: 'user_1',
      ipAddress: '203.0.113.9',
      ticks,
      policy: await validPolicy(),
    });

    expect(acceptanceId).toMatch(/^emsign_/);
    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(true);
    expect(await currentSignoffAcceptanceId(db as any, 'test-club')).toBe(acceptanceId);

    const rows = sqlite.prepare(
      `SELECT liability, policyVersion, wordingHash, userId, ipAddress, acceptanceId
         FROM "club_email_signoff" ORDER BY liability`,
    ).all() as Record<string, unknown>[];

    expect(rows).toHaveLength(3);
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
    const hash = await hashWording(EMAIL_SIGNOFF_LIABILITIES.parental_consent.wording);
    sqlite.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('r1','a1','test-club','parental_consent','user_1',1,NULL,'${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(false);
    expect(await currentAcceptedLiabilities(db as any, 'test-club')).toEqual(['parental_consent']);
  });

  it('fills a partial shared acceptance atomically under one acceptanceId', async () => {
    const db = d1Over(sqlite);
    const policy = await validPolicy();
    const hash = await hashWording(EMAIL_SIGNOFF_LIABILITIES.parental_consent.wording);
    sqlite.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('partial','shared_a','test-club','parental_consent','user_1',1,NULL,'${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);

    const { acceptanceId } = await recordEmailSignoff(db as any, {
      clubSlug: 'test-club', userId: 'user_2', ipAddress: null,
      ticks: { parental_consent: true, operational_split: true, right_to_object: true },
      policy,
    });
    expect(acceptanceId).toBe('shared_a');
    const rows = sqlite.prepare(`SELECT DISTINCT acceptanceId FROM "club_email_signoff" WHERE clubSlug = 'test-club'`).all() as { acceptanceId: string }[];
    expect(rows).toEqual([{ acceptanceId: 'shared_a' }]);
  });

  it('keeps old-version rows but treats the club as unsigned for new collection', async () => {
    const db = d1Over(sqlite);
    for (const liability of EMAIL_SIGNOFF_LIABILITY_IDS) {
      const hash = await hashWording(EMAIL_SIGNOFF_LIABILITIES[liability].wording);
      sqlite.exec(`INSERT INTO "club_email_signoff"
        (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
        VALUES ('old_${liability}','old_a','test-club','${liability}','user_1',1,NULL,'0','${hash}')`);
    }

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(false);

    await recordEmailSignoff(db as any, {
      clubSlug: 'test-club',
      userId: 'user_2',
      ipAddress: null,
      ticks: {
        parental_consent: true,
        operational_split: true,
        right_to_object: true,
      },
      policy: await validPolicy(),
    });

    expect(await hasCurrentEmailSignoff(db as any, 'test-club')).toBe(true);
    const versions = sqlite.prepare(
      `SELECT DISTINCT policyVersion AS v FROM "club_email_signoff" WHERE clubSlug = 'test-club' ORDER BY v`,
    ).all() as { v: string }[];
    expect(versions.map((r) => r.v)).toEqual(['0', EMAIL_SIGNOFF_POLICY_VERSION]);
  });
});

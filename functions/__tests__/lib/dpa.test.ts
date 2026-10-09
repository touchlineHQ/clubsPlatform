import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DPA_POLICY_VERSION,
  DPA_WORDING,
  currentDpaPolicy,
  hasCurrentDpaAcceptance,
  parseDpaAcceptance,
  recordDpaAcceptance,
} from '../../lib/dpa';
import { hashWording } from '../../lib/club-email-signoff';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

describe('dpa policy', () => {
  it('exposes versioned wording and ICO fee note', async () => {
    const payload = await currentDpaPolicy();
    expect(payload.policyVersion).toBe(DPA_POLICY_VERSION);
    expect(payload.wording).toBe(DPA_WORDING);
    expect(payload.wordingHash).toBe(await hashWording(DPA_WORDING));
    expect(payload.icoFeeNote.toLowerCase()).toContain('ico');
  });

  it('requires accepted=true with version and hash', () => {
    expect(parseDpaAcceptance(null)).toBeNull();
    expect(parseDpaAcceptance({ accepted: false, policyVersion: '1', wordingHash: 'x' })).toBeNull();
    expect(parseDpaAcceptance({ accepted: true, policyVersion: '1', wordingHash: 'x' })).toEqual({
      accepted: true,
      policyVersion: '1',
      wordingHash: 'x',
    });
  });
});

describe('dpa acceptance persistence', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('records acceptance with version and wording hash', async () => {
    const db = d1Over(sqlite);
    const policy = await currentDpaPolicy();
    const { acceptanceId, alreadyHeld } = await recordDpaAcceptance(db as any, {
      clubSlug: 'riverside-fc',
      userId: 'user_1',
      ipAddress: '203.0.113.9',
      policy: {
        accepted: true,
        policyVersion: policy.policyVersion,
        wordingHash: policy.wordingHash,
      },
    });

    expect(alreadyHeld).toBe(false);
    expect(acceptanceId).toMatch(/^dpa_/);
    expect(await hasCurrentDpaAcceptance(db as any, 'riverside-fc')).toBe(true);

    const row = sqlite.prepare(
      `SELECT userId, policyVersion, wordingHash, ipAddress FROM "club_dpa_acceptance" WHERE id = ?`,
    ).get(acceptanceId) as {
      userId: string; policyVersion: string; wordingHash: string; ipAddress: string;
    };
    expect(row.userId).toBe('user_1');
    expect(row.policyVersion).toBe(DPA_POLICY_VERSION);
    expect(row.wordingHash).toBe(policy.wordingHash);
    expect(row.ipAddress).toBe('203.0.113.9');

    const again = await recordDpaAcceptance(db as any, {
      clubSlug: 'riverside-fc',
      userId: 'user_1',
      ipAddress: null,
      policy: {
        accepted: true,
        policyVersion: policy.policyVersion,
        wordingHash: policy.wordingHash,
      },
    });
    expect(again.alreadyHeld).toBe(true);
    expect(again.acceptanceId).toBe(acceptanceId);
  });
});

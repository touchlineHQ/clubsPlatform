import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACTIVATION_TOKEN_TTL_MS,
  askParentForContactConsent,
  consentFormPath,
  consentFormUrl,
  findContactByActivationToken,
  listContactsForFan,
  submitParentConsentForm,
  withdrawParentConsentByToken,
  ParentConsentError,
} from '../../lib/parent-consent';
import {
  currentMarketingConsentPolicy,
  currentOperationalConsentPolicy,
  hasCurrentMarketingConsent,
  latestConsentRecord,
} from '../../lib/consent';
import { emailForSend } from '../../lib/player-contact';
import { EMAIL_SIGNOFF_POLICY_VERSION, hashWording, EMAIL_SIGNOFF_LIABILITIES } from '../../lib/club-email-signoff';
import { purgePlayerContact } from '../../lib/contact-purge';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

async function seedSignoff(db: SqliteDb) {
  const acceptanceId = 'emsign_1';
  for (const liability of Object.values(EMAIL_SIGNOFF_LIABILITIES)) {
    const hash = await hashWording(liability.wording);
    db.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('${liability.id}_r','${acceptanceId}','${CLUB}','${liability.id}','admin_1',${NOW},NULL,
              '${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);
  }
}

describe('parent consent helpers', () => {
  let sqlite: SqliteDb;

  beforeEach(async () => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    // Live registration required for operational emailForSend (#133).
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('reg_1','${CLUB}','p1','U12 Blues',NULL,NULL,'Active',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, published, createdAt, data)
      VALUES ('club_1','${CLUB}','Test FC',1,1,${NOW},'{}')`);
    await seedSignoff(sqlite);
  });

  afterEach(() => sqlite.close());

  it('builds club-scoped consent URLs', () => {
    expect(consentFormPath('abc')).toBe('/#/consent/abc');
    expect(consentFormUrl('https://example.com', 'east-leake', 'tok', true))
      .toBe('https://example.com/east-leake/#/consent/tok');
    expect(consentFormUrl('https://example.com/', 'east-leake', 'tok', false))
      .toBe('https://example.com/#/consent/tok');
  });

  it('creates pending contact + token; parent submit confirms + consent_record', async () => {
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB,
      fanId: 'FAN001',
      email: 'Parent@Example.com',
      sourcedBy: 'admin_1',
    });
    expect(created.created).toBe(true);
    expect(created.state).toBe('pending');
    expect(created.email).toBe('parent@example.com');
    expect(created.token).toMatch(/^[a-f0-9]{64}$/);
    expect(created.expiresAt).toBeGreaterThan(Date.now());
    expect(created.expiresAt - Date.now()).toBeLessThanOrEqual(ACTIVATION_TOKEN_TTL_MS + 5_000);

    const pending = await findContactByActivationToken(d1, created.token);
    expect(pending?.state).toBe('pending');
    expect(await emailForSend(d1, CLUB, created.contactId, 'operational')).toBeNull();

    const operational = await currentOperationalConsentPolicy();
    const marketing = await currentMarketingConsentPolicy();
    const result = await submitParentConsentForm(d1, {
      token: created.token,
      email: 'parent@example.com',
      operationalPolicy: {
        policyVersion: operational.policyVersion,
        wordingHash: operational.wordingHash,
      },
      marketingOptIn: true,
      marketingPolicy: {
        policyVersion: marketing.policyVersion,
        wordingHash: marketing.wordingHash,
      },
      ipAddress: '203.0.113.9',
    });
    expect(result.state).toBe('confirmed');

    const row = sqlite.prepare(
      `SELECT state, operationalOptIn, marketingOptIn, email FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as {
      state: string; operationalOptIn: number; marketingOptIn: number; email: string;
    };
    expect(row).toEqual({
      state: 'confirmed',
      operationalOptIn: 1,
      marketingOptIn: 1,
      email: 'parent@example.com',
    });

    const opRecord = await latestConsentRecord(d1, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: created.contactId,
      purpose: 'operational',
    });
    expect(opRecord?.state).toBe('granted');
    expect(opRecord?.ipAddress).toBe('203.0.113.9');
    expect(opRecord?.wordingHash).toBe(operational.wordingHash);

    expect(await hasCurrentMarketingConsent(d1, CLUB, 'player_contact', created.contactId)).toBe(true);
    expect(await emailForSend(d1, CLUB, created.contactId, 'operational')).toBe('parent@example.com');
    expect(await emailForSend(d1, CLUB, created.contactId, 'marketing')).toBe('parent@example.com');
  });

  it('does not set marketing when parent leaves the optional tick off', async () => {
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'a@b.co', sourcedBy: 'admin_1',
    });
    const operational = await currentOperationalConsentPolicy();
    await submitParentConsentForm(d1, {
      token: created.token,
      email: 'a@b.co',
      operationalPolicy: {
        policyVersion: operational.policyVersion,
        wordingHash: operational.wordingHash,
      },
      marketingOptIn: false,
      marketingPolicy: null,
      ipAddress: null,
    });
    const row = sqlite.prepare(
      `SELECT marketingOptIn FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as { marketingOptIn: number };
    expect(row.marketingOptIn).toBe(0);
    expect(await hasCurrentMarketingConsent(d1, CLUB, 'player_contact', created.contactId)).toBe(false);
    expect(await emailForSend(d1, CLUB, created.contactId, 'marketing')).toBeNull();
  });

  async function pendingSubmission() {
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'parent@example.com', sourcedBy: 'admin_1',
    });
    return {
      d1, created,
      input: {
        token: created.token,
        email: 'updated@example.com',
        operationalPolicy: await currentOperationalConsentPolicy(),
        marketingOptIn: true,
        marketingPolicy: await currentMarketingConsentPolicy(),
        ipAddress: '203.0.113.9',
      },
    };
  }

  function snapshot() {
    return {
      contacts: sqlite.prepare('SELECT * FROM "player_contact"').all(),
      records: sqlite.prepare('SELECT * FROM "consent_record" ORDER BY rowid').all(),
    };
  }

  it.each(['operational', 'marketing', 'missing marketing'])(
    'rejects an invalid %s policy without changing contact or consent evidence',
    async (purpose) => {
      const { d1, input } = await pendingSubmission();
      const before = snapshot();
      const submission = {
        ...input,
        operationalPolicy: purpose === 'operational'
          ? { ...input.operationalPolicy, wordingHash: 'stale' } : input.operationalPolicy,
        marketingPolicy: purpose === 'missing marketing' ? null
          : purpose === 'marketing' ? { ...input.marketingPolicy, policyVersion: 'stale' }
            : input.marketingPolicy,
      };
      await expect(submitParentConsentForm(d1, submission))
        .rejects.toMatchObject({ code: 'policy_mismatch' });
      expect(snapshot()).toEqual(before);
    },
  );

  it.each(['confirmed', 'withdrawn', 'bounced'])(
    'rejects submission for a %s contact without changing existing evidence',
    async (state) => {
      const { d1, created, input } = await pendingSubmission();
      await submitParentConsentForm(d1, input);
      sqlite.prepare('UPDATE "player_contact" SET state = ? WHERE id = ?').run!(state, created.contactId);
      const before = snapshot();
      await expect(submitParentConsentForm(d1, { ...input, email: 'other@example.com' }))
        .rejects.toMatchObject({ code: 'invalid_state' });
      expect(snapshot()).toEqual(before);
    },
  );

  it.each(['marketing grant', 'contact update'])(
    'rolls back confirmation when the %s fails',
    async (failure) => {
      const { d1, input } = await pendingSubmission();
      const before = snapshot();
      sqlite.exec(failure === 'marketing grant'
        ? `CREATE TRIGGER fail_write BEFORE INSERT ON consent_record
           WHEN NEW.purpose = 'marketing' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
        : `CREATE TRIGGER fail_write BEFORE UPDATE ON player_contact
           BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
      await expect(submitParentConsentForm(d1, input)).rejects.toThrow('forced failure');
      expect(snapshot()).toEqual(before);
    },
  );

  it.each(['marketing withdrawal', 'contact update'])(
    'rolls back withdrawal when the %s fails',
    async (failure) => {
      const { d1, created, input } = await pendingSubmission();
      await submitParentConsentForm(d1, input);
      const before = snapshot();
      sqlite.exec(failure === 'marketing withdrawal'
        ? `CREATE TRIGGER fail_write BEFORE INSERT ON consent_record
           WHEN NEW.purpose = 'marketing' BEGIN SELECT RAISE(ABORT, 'forced failure'); END`
        : `CREATE TRIGGER fail_write BEFORE UPDATE ON player_contact
           BEGIN SELECT RAISE(ABORT, 'forced failure'); END`);
      await expect(withdrawParentConsentByToken(d1, created.token, null))
        .rejects.toThrow('forced failure');
      expect(snapshot()).toEqual(before);
      sqlite.exec('DROP TRIGGER fail_write');
      await withdrawParentConsentByToken(d1, created.token, null);
      for (const purpose of ['operational', 'marketing'] as const) {
        const latest = await latestConsentRecord(d1, {
          clubSlug: CLUB, subjectType: 'player_contact', subjectId: created.contactId, purpose,
        });
        expect(latest?.state).toBe('withdrawn');
        expect(latest?.supersedesId).toBeTruthy();
      }
      expect(sqlite.prepare('SELECT state, operationalOptIn, marketingOptIn, activationTokenHash FROM player_contact').get())
        .toEqual({ state: 'withdrawn', operationalOptIn: 0, marketingOptIn: 0, activationTokenHash: null });
    },
  );

  it('refuses collection without club email sign-off', async () => {
    sqlite.exec(`DELETE FROM "club_email_signoff"`);
    const d1 = d1Over(sqlite) as any;
    await expect(askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'a@b.co', sourcedBy: 'admin_1',
    })).rejects.toMatchObject({ code: 'no_signoff' });
  });

  it('lists contacts for admin status view', async () => {
    const d1 = d1Over(sqlite) as any;
    await askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'a@b.co', sourcedBy: 'admin_1',
    });
    const list = await listContactsForFan(d1, CLUB, 'FAN001');
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe('pending');
    expect(list[0].hasActiveToken).toBe(true);
    expect(list[0].marketingOptIn).toBe(0);
  });

  it('allows withdraw via the same activation token after confirm', async () => {
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'a@b.co', sourcedBy: 'admin_1',
    });
    const operational = await currentOperationalConsentPolicy();
    await submitParentConsentForm(d1, {
      token: created.token,
      email: 'a@b.co',
      operationalPolicy: {
        policyVersion: operational.policyVersion,
        wordingHash: operational.wordingHash,
      },
      marketingOptIn: false,
      marketingPolicy: null,
      ipAddress: '1.2.3.4',
    });
    await withdrawParentConsentByToken(d1, created.token, '1.2.3.4');
    const row = sqlite.prepare(
      `SELECT state, operationalOptIn, marketingOptIn, activationTokenHash FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as {
      state: string; operationalOptIn: number; marketingOptIn: number; activationTokenHash: string | null;
    };
    expect(row.state).toBe('withdrawn');
    expect(row.operationalOptIn).toBe(0);
    expect(row.marketingOptIn).toBe(0);
    expect(row.activationTokenHash).toBeNull();
    expect(await emailForSend(d1, CLUB, created.contactId, 'operational')).toBeNull();

    const op = await latestConsentRecord(d1, {
      clubSlug: CLUB, subjectType: 'player_contact', subjectId: created.contactId, purpose: 'operational',
    });
    expect(op?.state).toBe('withdrawn');
  });

  it('rejects confirm of an unknown token', async () => {
    const d1 = d1Over(sqlite) as any;
    const operational = await currentOperationalConsentPolicy();
    await expect(submitParentConsentForm(d1, {
      token: 'deadbeef',
      email: 'a@b.co',
      operationalPolicy: {
        policyVersion: operational.policyVersion,
        wordingHash: operational.wordingHash,
      },
      marketingOptIn: false,
      marketingPolicy: null,
      ipAddress: null,
    })).rejects.toBeInstanceOf(ParentConsentError);
  });

  it('blocks silent re-add of a purged address until confirmSuppressedReAdd', async () => {
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB,
      fanId: 'FAN001',
      email: 'purge-me@example.com',
      sourcedBy: 'admin_1',
    });
    await purgePlayerContact(d1, {
      clubSlug: CLUB,
      contactId: created.contactId,
      actor: { actorId: 'admin_1', source: 'admin' },
    });

    await expect(askParentForContactConsent(d1, {
      clubSlug: CLUB,
      fanId: 'FAN001',
      email: 'purge-me@example.com',
      sourcedBy: 'admin_1',
    })).rejects.toMatchObject({ code: 'suppressed' });

    const readded = await askParentForContactConsent(d1, {
      clubSlug: CLUB,
      fanId: 'FAN001',
      email: 'purge-me@example.com',
      sourcedBy: 'admin_1',
      confirmSuppressedReAdd: true,
    });
    expect(readded.created).toBe(true);
    expect(readded.email).toBe('purge-me@example.com');
  });
});

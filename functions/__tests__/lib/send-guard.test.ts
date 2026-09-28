import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  currentMarketingConsentPolicy,
  recordMarketingConsentGrant,
} from '../../lib/consent';
import {
  evaluateContactForPurpose,
  isLiveRegistrationStatus,
  listEmailSendEvents,
  resolveAudienceRecipients,
  sendClubEmail,
} from '../../lib/send-guard';
import { emailForSend } from '../../lib/player-contact';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

describe('isLiveRegistrationStatus', () => {
  it('treats cancelled and transferred as lapsed, and blank as not live', () => {
    expect(isLiveRegistrationStatus('Active')).toBe(true);
    expect(isLiveRegistrationStatus('active')).toBe(true);
    expect(isLiveRegistrationStatus('Pending')).toBe(true);
    expect(isLiveRegistrationStatus('Cancelled')).toBe(false);
    expect(isLiveRegistrationStatus('transferred')).toBe(false);
    expect(isLiveRegistrationStatus('')).toBe(false);
    expect(isLiveRegistrationStatus(null)).toBe(false);
  });
});

describe('send guard eligibility (#133)', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
  });

  afterEach(() => sqlite.close());

  function seedContact(over: {
    id?: string;
    playerId?: string;
    state?: string;
    operational?: number;
    marketing?: number;
    email?: string;
  } = {}) {
    const id = over.id ?? 'pc_1';
    const playerId = over.playerId ?? 'p1';
    const state = over.state ?? 'confirmed';
    const operational = over.operational ?? 1;
    const marketing = over.marketing ?? 0;
    const email = over.email ?? `${id}@example.com`;
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('${id}','${CLUB}','${playerId}','${email}','guardian','${state}',
              ${operational},${marketing},NULL,${NOW})`);
    return id;
  }

  function seedRegistration(
    playerId: string,
    status: string,
    teamName = 'U12 Blues',
    id = `reg_${playerId}`,
  ) {
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('${id}','${CLUB}','${playerId}','${teamName}','U12',NULL,'${status}',${NOW},${NOW})`);
  }

  it('lapsed registration blocks operational; live registration allows it', async () => {
    const liveId = seedContact({ id: 'pc_live', playerId: 'p1', email: 'live@example.com' });
    const lapsedId = seedContact({ id: 'pc_lapsed', playerId: 'p2', email: 'lapsed@example.com' });
    seedRegistration('p1', 'Active');
    seedRegistration('p2', 'Cancelled');

    const d1 = d1Over(sqlite) as any;
    const live = await evaluateContactForPurpose(
      d1, CLUB,
      {
        id: liveId, email: 'live@example.com', playerId: 'p1',
        state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0,
      },
      'operational',
    );
    const lapsed = await evaluateContactForPurpose(
      d1, CLUB,
      {
        id: lapsedId, email: 'lapsed@example.com', playerId: 'p2',
        state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0,
      },
      'operational',
    );

    expect(live.eligible).toBe(true);
    expect(lapsed.eligible).toBe(false);
    if (!lapsed.eligible) expect(lapsed.dropReason).toBe('lapsed_registration');
    expect(lapsed.registrationStatus?.toLowerCase()).toBe('cancelled');

    expect(await emailForSend(d1, CLUB, liveId, 'operational')).toBe('live@example.com');
    expect(await emailForSend(d1, CLUB, lapsedId, 'operational')).toBeNull();
  });

  it('missing marketing opt-in / consent blocks marketing', async () => {
    const id = seedContact({ id: 'pc_m', marketing: 0 });
    seedRegistration('p1', 'Active');
    const d1 = d1Over(sqlite) as any;

    const without = await evaluateContactForPurpose(
      d1, CLUB,
      {
        id, email: 'pc_m@example.com', playerId: 'p1',
        state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0,
      },
      'marketing',
    );
    expect(without.eligible).toBe(false);
    if (!without.eligible) expect(without.dropReason).toBe('missing_marketing_consent');
    expect(await emailForSend(d1, CLUB, id, 'marketing')).toBeNull();

    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(d1, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: id,
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const withConsent = await evaluateContactForPurpose(
      d1, CLUB,
      {
        id, email: 'pc_m@example.com', playerId: 'p1',
        state: 'confirmed', operationalOptIn: 1, marketingOptIn: 1,
      },
      'marketing',
    );
    expect(withConsent.eligible).toBe(true);
    expect(await emailForSend(d1, CLUB, id, 'marketing')).toBe('pc_m@example.com');
  });

  it('pending blocks both operational and marketing', async () => {
    const id = seedContact({ id: 'pc_pending', state: 'pending', operational: 1, marketing: 1 });
    seedRegistration('p1', 'Active');
    const d1 = d1Over(sqlite) as any;

    for (const purpose of ['operational', 'marketing'] as const) {
      const result = await evaluateContactForPurpose(
        d1, CLUB,
        {
          id, email: 'pc_pending@example.com', playerId: 'p1',
          state: 'pending', operationalOptIn: 1, marketingOptIn: 1,
        },
        purpose,
      );
      expect(result.eligible).toBe(false);
      if (!result.eligible) expect(result.dropReason).toBe('pending');
      expect(await emailForSend(d1, CLUB, id, purpose)).toBeNull();
    }
  });

  it('transactional reaches confirmed contacts without registration or marketing', async () => {
    const id = seedContact({ id: 'pc_tx', operational: 0, marketing: 0 });
    const d1 = d1Over(sqlite) as any;
    expect(await emailForSend(d1, CLUB, id, 'transactional')).toBe('pc_tx@example.com');

    const pending = seedContact({
      id: 'pc_tx_pending', state: 'pending', email: 'txp@example.com',
    });
    expect(await emailForSend(d1, CLUB, pending, 'transactional')).toBeNull();
  });

  it('derives team audience recipients and never accepts caller-supplied addresses', async () => {
    seedContact({ id: 'pc_a', playerId: 'p1', email: 'a@example.com' });
    seedContact({ id: 'pc_b', playerId: 'p2', email: 'b@example.com' });
    seedRegistration('p1', 'Active', 'U12 Blues');
    seedRegistration('p2', 'Transferred', 'U12 Blues');

    const d1 = d1Over(sqlite) as any;
    const resolution = await resolveAudienceRecipients(
      d1, CLUB, 'operational', { type: 'team', teamName: 'U12 Blues' },
    );

    expect(resolution.eligible.map((r) => r.contactId)).toEqual(['pc_a']);
    expect(resolution.dropped).toHaveLength(1);
    expect(resolution.dropped[0].dropReason).toBe('lapsed_registration');
    expect(resolution.eligible[0].email).toBe('a@example.com');
  });

  it('records purpose, contact id, state relied on, and drop reasons', async () => {
    seedContact({ id: 'pc_ok', playerId: 'p1', email: 'ok@example.com' });
    seedContact({
      id: 'pc_no', playerId: 'p2', email: 'no@example.com', marketing: 0,
    });
    seedRegistration('p1', 'Active', 'U10');
    seedRegistration('p2', 'Active', 'U10');

    const d1 = d1Over(sqlite) as any;
    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(d1, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_ok',
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const mailer = {
      send: vi.fn(async () => ({ id: 'msg_1' })),
    };

    const result = await sendClubEmail({}, d1, {
      clubSlug: CLUB,
      purpose: 'marketing',
      audience: { type: 'team', teamName: 'U10' },
      subject: 'Shop open',
      html: '<p>Shop</p>',
      text: 'Shop',
      initiatedBy: 'admin_1',
      mailer,
    });

    expect(result.mailConfigured).toBe(true);
    expect(result.sent).toEqual([{ contactId: 'pc_ok', outcome: 'sent' }]);
    expect(result.dropped).toEqual([
      { contactId: 'pc_no', dropReason: 'missing_marketing_consent' },
    ]);
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const sentMessage = (mailer.send.mock.calls as unknown as Array<[{ to: string }]>)[0][0];
    expect(sentMessage.to).toBe('ok@example.com');

    const events = await listEmailSendEvents(d1, CLUB);
    expect(events).toHaveLength(2);

    const sent = events.find((e) => e.outcome === 'sent')!;
    expect(sent.purpose).toBe('marketing');
    expect(sent.contactId).toBe('pc_ok');
    expect(sent.marketingConsentState).toBe('granted');
    expect(sent.marketingOptIn).toBe(1);
    expect(sent.initiatedBy).toBe('admin_1');

    const dropped = events.find((e) => e.outcome === 'dropped')!;
    expect(dropped.contactId).toBe('pc_no');
    expect(dropped.dropReason).toBe('missing_marketing_consent');
    expect(dropped.marketingConsentState).toBeNull();
  });

  it('dedupes the same parent address across sibling contacts', async () => {
    seedContact({ id: 'pc_sib1', playerId: 'p1', email: 'Parent@Example.com' });
    seedContact({ id: 'pc_sib2', playerId: 'p2', email: 'parent@example.com' });
    seedRegistration('p1', 'Active', 'U12 Blues');
    seedRegistration('p2', 'Active', 'U12 Blues');

    const d1 = d1Over(sqlite) as any;
    const resolution = await resolveAudienceRecipients(
      d1, CLUB, 'operational', { type: 'team', teamName: 'U12 Blues' },
    );
    expect(resolution.eligible).toHaveLength(1);
    expect(resolution.eligible[0].email.toLowerCase()).toBe('parent@example.com');
    expect(resolution.dropped.some((d) => d.dropReason === 'duplicate_email')).toBe(true);
  });

  it('skips provider when unconfigured but still records eligibility', async () => {
    seedContact({ id: 'pc_skip' });
    seedRegistration('p1', 'Active');
    const d1 = d1Over(sqlite) as any;

    const result = await sendClubEmail({}, d1, {
      clubSlug: CLUB,
      purpose: 'operational',
      audience: { type: 'contact', contactId: 'pc_skip' },
      subject: 'Training moved',
      html: '<p>Moved</p>',
      text: 'Moved',
      mailer: null,
    });

    expect(result.mailConfigured).toBe(false);
    expect(result.sent).toEqual([
      { contactId: 'pc_skip', outcome: 'skipped_unconfigured' },
    ]);
    const events = await listEmailSendEvents(d1, CLUB, { outcome: 'skipped_unconfigured' });
    expect(events).toHaveLength(1);
    expect(events[0].registrationStatus).toBe('Active');
    expect(events[0].purpose).toBe('operational');
  });
});

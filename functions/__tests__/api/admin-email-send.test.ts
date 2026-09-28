import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  currentMarketingConsentPolicy,
  recordMarketingConsentGrant,
} from '../../lib/consent';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestPost as sendPost } from '../../api/admin/email-send';
import { onRequestGet as sendsGet } from '../../api/admin/email-sends';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

describe('admin email-send / email-sends (#133)', () => {
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
      VALUES ('reg_1','${CLUB}','p1','U12 Blues',NULL,NULL,'Active',${NOW},${NOW})`);
    mockGetSession.mockResolvedValue(adminSession);
  });

  afterEach(() => sqlite.close());

  it('rejects transactional purpose on the admin send endpoint', async () => {
    const d1 = d1Over(sqlite) as any;
    const res = await sendPost(makeContext(
      postReq('/api/admin/email-send', {
        purpose: 'transactional',
        audience: { type: 'contact', contactId: 'pc_1' },
        subject: 'Reset',
        text: 'Reset',
      }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1 } },
    ) as any);
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('transactional_not_admin');
  });

  it('rejects caller-supplied recipients and marketing preference fields', async () => {
    const d1 = d1Over(sqlite) as any;
    for (const field of ['to', 'emails', 'recipients', 'marketingOptIn']) {
      const res = await sendPost(makeContext(
        postReq('/api/admin/email-send', {
          purpose: 'operational',
          audience: { type: 'team', teamName: 'U12 Blues' },
          subject: 'Hi',
          text: 'Hi',
          [field]: field === 'marketingOptIn' ? true : ['x@y.z'],
        }, { 'X-Club-Slug': CLUB }),
        { env: { DB: d1 } },
      ) as any);
      expect(res.status).toBe(403);
    }
  });

  it('sends operational to live confirmed contacts and surfaces drops', async () => {
    sqlite.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_pending','${CLUB}','p2','pending@example.com','guardian','pending',
              1,0,NULL,${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('reg_2','${CLUB}','p2','U12 Blues',NULL,NULL,'Active',${NOW},${NOW})`);

    const d1 = d1Over(sqlite) as any;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'msg_abc' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const res = await sendPost(makeContext(
        postReq('/api/admin/email-send', {
          purpose: 'operational',
          audience: { type: 'team', teamName: 'U12 Blues' },
          subject: 'Training cancelled',
          text: 'Training is cancelled',
          html: '<p>Training is cancelled</p>',
        }, { 'X-Club-Slug': CLUB }),
        {
          env: {
            DB: d1,
            RESEND_API_KEY: 'test-key',
            FROM_EMAIL: 'noreply@example.com',
          },
        },
      ) as any);

      expect(res.status).toBe(200);
      const body = await res.json() as {
        mailConfigured: boolean;
        sent: Array<{ contactId: string; outcome: string }>;
        dropped: Array<{ contactId: string; dropReason: string }>;
      };
      expect(body.mailConfigured).toBe(true);
      expect(body.sent).toEqual([{ contactId: 'pc_1', outcome: 'sent' }]);
      expect(body.dropped).toEqual([
        { contactId: 'pc_pending', dropReason: 'pending' },
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const list = await sendsGet(makeContext(
        getReq('/api/admin/email-sends?outcome=dropped', { 'X-Club-Slug': CLUB }),
        { env: { DB: d1 } },
      ) as any);
      expect(list.status).toBe(200);
      const listed = await list.json() as {
        events: Array<{ dropReason: string; purpose: string; contactId: string }>;
      };
      expect(listed.events).toHaveLength(1);
      expect(listed.events[0]).toMatchObject({
        contactId: 'pc_pending',
        dropReason: 'pending',
        purpose: 'operational',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('blocks marketing without consent and records the drop for admin', async () => {
    const d1 = d1Over(sqlite) as any;
    const res = await sendPost(makeContext(
      postReq('/api/admin/email-send', {
        purpose: 'marketing',
        audience: { type: 'contact', contactId: 'pc_1' },
        subject: 'Sponsor news',
        text: 'Buy shirts',
      }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1 } },
    ) as any);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      dropped: Array<{ dropReason: string }>;
      sent: unknown[];
      mailConfigured: boolean;
    };
    expect(body.mailConfigured).toBe(false);
    expect(body.sent).toEqual([]);
    expect(body.dropped[0].dropReason).toBe('missing_marketing_consent');

    const policy = await currentMarketingConsentPolicy();
    await recordMarketingConsentGrant(d1, {
      clubSlug: CLUB,
      subjectType: 'player_contact',
      subjectId: 'pc_1',
      ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });

    const res2 = await sendPost(makeContext(
      postReq('/api/admin/email-send', {
        purpose: 'marketing',
        audience: { type: 'contact', contactId: 'pc_1' },
        subject: 'Sponsor news',
        text: 'Buy shirts',
      }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1 } },
    ) as any);
    const body2 = await res2.json() as {
      sent: Array<{ outcome: string }>;
      dropped: unknown[];
    };
    expect(body2.dropped).toEqual([]);
    expect(body2.sent[0].outcome).toBe('skipped_unconfigured');
  });
});

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  EMAIL_SIGNOFF_LIABILITIES,
  EMAIL_SIGNOFF_POLICY_VERSION,
  hashWording,
} from '../../lib/club-email-signoff';
import {
  currentMarketingConsentPolicy,
  currentOperationalConsentPolicy,
} from '../../lib/consent';
import { askParentForContactConsent } from '../../lib/parent-consent';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import {
  onRequestGet as adminContactsGet,
  onRequestPost as adminContactsPost,
} from '../../api/admin/player-contacts';
import {
  onRequestGet as formGet,
  onRequestPost as formPost,
} from '../../api/consent/form';

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

describe('admin player-contacts + parent consent form', () => {
  let sqlite: SqliteDb;

  beforeEach(async () => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, published, createdAt, data)
      VALUES ('club_1','${CLUB}','Test FC',1,1,${NOW},'{"email":"sec@test.example"}')`);
    await seedSignoff(sqlite);
    mockGetSession.mockResolvedValue(adminSession);
  });

  afterEach(() => sqlite.close());

  it('admin creates pending + token; parent submit confirms; admin cannot set marketing', async () => {
    const d1 = d1Over(sqlite) as any;

    const forbidden = await adminContactsPost(makeContext(
      postReq('/api/admin/player-contacts', {
        fanId: 'FAN001',
        email: 'parent@example.com',
        marketingOptIn: true,
      }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1 } },
    ) as any);
    expect(forbidden.status).toBe(403);

    const createRes = await adminContactsPost(makeContext(
      postReq('/api/admin/player-contacts', {
        fanId: 'FAN001',
        email: 'parent@example.com',
        relationship: 'guardian',
      }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1, MULTI_CLUB: 'true' } },
    ) as any);
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as {
      token: string; consentUrl: string; state: string; contactId: string;
    };
    expect(created.state).toBe('pending');
    expect(created.consentUrl).toContain(`/${CLUB}/#/consent/`);
    expect(created.token).toBeTruthy();

    const listRes = await adminContactsGet(makeContext(
      getReq(`/api/admin/player-contacts?fanId=FAN001`, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1 } },
    ) as any);
    expect(listRes.status).toBe(200);
    const list = await listRes.json() as { contacts: Array<{ state: string; marketingOptIn: number }> };
    expect(list.contacts[0].state).toBe('pending');
    expect(list.contacts[0].marketingOptIn).toBe(0);

    const formRes = await formGet(makeContext(
      getReq(`/api/consent/form?token=${encodeURIComponent(created.token)}`),
      { env: { DB: d1 } },
    ) as any);
    expect(formRes.status).toBe(200);
    const form = await formRes.json() as {
      club: { name: string }; contact: { email: string; state: string };
      operational: { wordingHash: string }; marketing: { wordingHash: string };
    };
    expect(form.club.name).toBe('Test FC');
    expect(form.contact.email).toBe('parent@example.com');
    expect(form.contact.state).toBe('pending');

    const operational = await currentOperationalConsentPolicy();
    const marketing = await currentMarketingConsentPolicy();
    const submitRes = await formPost(makeContext(
      postReq('/api/consent/form', {
        action: 'submit',
        token: created.token,
        email: 'parent@example.com',
        operationalAgreed: true,
        operational: {
          policyVersion: operational.policyVersion,
          wordingHash: operational.wordingHash,
        },
        marketingOptIn: true,
        marketing: {
          policyVersion: marketing.policyVersion,
          wordingHash: marketing.wordingHash,
        },
      }),
      { env: { DB: d1 } },
    ) as any);
    expect(submitRes.status).toBe(200);
    const submitted = await submitRes.json() as { state: string; marketingOptIn: boolean };
    expect(submitted.state).toBe('confirmed');
    expect(submitted.marketingOptIn).toBe(true);

    const row = sqlite.prepare(
      `SELECT state, operationalOptIn, marketingOptIn FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as { state: string; operationalOptIn: number; marketingOptIn: number };
    expect(row).toEqual({ state: 'confirmed', operationalOptIn: 1, marketingOptIn: 1 });

    const withdrawRes = await formPost(makeContext(
      postReq('/api/consent/form', { action: 'withdraw', token: created.token }),
      { env: { DB: d1 } },
    ) as any);
    expect(withdrawRes.status).toBe(200);
    const after = sqlite.prepare(
      `SELECT state, operationalOptIn, marketingOptIn FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as { state: string; operationalOptIn: number; marketingOptIn: number };
    expect(after.state).toBe('withdrawn');
    expect(after.operationalOptIn).toBe(0);
    expect(after.marketingOptIn).toBe(0);
  });

  it('FA import path never marks an address confirmed (guard regression)', async () => {
    // Directly assert the pending-only insert shape used by import-players.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(
      resolve(__dirname, '../../api/admin/import-players.ts'),
      'utf8',
    );
    expect(src).toMatch(/SELECT \?, \?, \?, \?, \?, 'pending', 0, 0/);
    expect(src).not.toMatch(/SET state\s*=\s*'confirmed'/);
    expect(src).not.toMatch(/state = 'confirmed'/);

    // And the helper refuses to leave marketing/operational on from admin ask.
    const d1 = d1Over(sqlite) as any;
    const created = await askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'x@y.z', sourcedBy: 'admin_1',
    });
    const row = sqlite.prepare(
      `SELECT state, operationalOptIn, marketingOptIn FROM "player_contact" WHERE id = ?`,
    ).get(created.contactId) as { state: string; operationalOptIn: number; marketingOptIn: number };
    expect(row).toEqual({ state: 'pending', operationalOptIn: 0, marketingOptIn: 0 });
  });
});

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, makeDb, memberSession, adminSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  currentMarketingConsentPolicy,
  recordMarketingConsentGrant,
} from '../../lib/consent';
import { currentDpaPolicy } from '../../lib/dpa';
import { currentPolicyPayload } from '../../lib/club-email-signoff';
import { onRequestPost as registerPost } from '../../api/clubs/register';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as consentPolicyGet } from '../../api/consent-policy';
import { onRequestGet as dpaPolicyGet } from '../../api/dpa-policy';
import { onRequestGet as privacyNoticeGet } from '../../api/privacy-notice';
import { onRequestGet as unsubscribeGet, onRequestPost as unsubscribePost } from '../../api/unsubscribe';
import { onRequestPost as consentGrantPost } from '../../api/consent/grant';
import {
  onRequestGet as memberDataGet,
  onRequestDelete as memberDataDelete,
  onRequestPatch as memberDataPatch,
} from '../../api/admin/member-data';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';

describe('consent-policy / dpa-policy GET', () => {
  it('returns public marketing consent wording', async () => {
    const res = await consentPolicyGet({} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.purpose).toBe('marketing');
    expect(body.wordingHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns public DPA wording with ICO note', async () => {
    const res = await dpaPolicyGet({} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.policyVersion).toBeTruthy();
    expect(body.icoFeeNote.toLowerCase()).toContain('ico');
  });
});

describe('privacy-notice GET', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, published, createdAt, data)
      VALUES ('club_1','${CLUB}','Test FC',1,1,${NOW},
      '{"email":"sec@test.example","address":{"line1":"1 Road","postcode":"TE1 1ST"}}')`);
  });

  afterEach(() => sqlite.close());

  it('returns a notice naming the club as controller', async () => {
    const req = getReq('/api/privacy-notice', { 'X-Club-Slug': CLUB });
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await privacyNoticeGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.controller.name).toBe('Test FC');
    expect(body.controller.email).toBe('sec@test.example');
    expect(body.processor.name).toBe('touchlineHQ');
  });

  it.each([
    [{ line1: 42, line2: 'Valid Road', postcode: {} }, 'Valid Road'],
    [[], null], [42, null], ['Road', null], [null, null],
  ])('filters invalid address fields: %j', async (address, expected) => {
    sqlite.prepare(`UPDATE club_config SET data = ?`).run!(JSON.stringify({ email: 'sec@test.example', address }));
    const res = await privacyNoticeGet(makeContext(getReq('/api/privacy-notice', { 'X-Club-Slug': CLUB }), {
      env: { DB: d1Over(sqlite) as any },
    }) as any);
    expect(res.status).toBe(200);
    expect((await res.json() as any).controller.address).toBe(expected);
  });

  it.each(['{}', 'null', '{bad', '{"email":" ","address":{"line1":42}}'])('withholds a notice without contact details: %s', async (data) => {
    sqlite.prepare(`UPDATE club_config SET data = ?`).run!(data);
    const res = await privacyNoticeGet(makeContext(getReq('/api/privacy-notice', { 'X-Club-Slug': CLUB }), {
      env: { DB: d1Over(sqlite) as any },
    }) as any);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: expect.stringContaining('contact details') });
  });

  it('returns 400 without club slug', async () => {
    const req = getReq('/api/privacy-notice');
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await privacyNoticeGet(ctx as any);
    expect(res.status).toBe(400);
  });
});

describe('unsubscribe + consent grant', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    mockGetSession.mockReset();
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u1','Parent','parent@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user_player" VALUES ('up1','u1','p1','guardian',${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','confirmed',1,0,NULL,${NOW})`);
  });

  afterEach(() => sqlite.close());

  it('grants marketing consent for the subject and withdraws via token', async () => {
    mockGetSession.mockResolvedValue({
      ...memberSession,
      user: { ...memberSession.user, id: 'u1', email: 'parent@example.com', clubSlug: CLUB },
    });
    const policy = await currentMarketingConsentPolicy();
    const req = postReq('/api/consent/grant', {
      contactId: 'pc_1',
      policyVersion: policy.policyVersion,
      wordingHash: policy.wordingHash,
    }, { 'X-Club-Slug': CLUB });
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await consentGrantPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.unsubscribePath).toMatch(/^\/api\/unsubscribe\?token=/);

    const token = new URL(body.unsubscribePath, 'https://example.test').searchParams.get('token')!;
    const unsubReq = getReq(`/api/unsubscribe?token=${encodeURIComponent(token)}`);
    const unsubCtx = makeContext(unsubReq, { env: { DB: d1Over(sqlite) as any } });
    const previewRes = await unsubscribeGet(unsubCtx as any);
    expect(previewRes.status).toBe(200);
    expect(previewRes.headers.get('content-type')).toContain('text/html');
    expect(await previewRes.text()).toContain('Unsubscribe');

    const optInBeforePost = sqlite.prepare(
      `SELECT marketingOptIn FROM "player_contact" WHERE id = 'pc_1'`,
    ).get() as { marketingOptIn: number };
    expect(optInBeforePost).toEqual({ marketingOptIn: 1 });

    const postReqWithToken = postReq(`/api/unsubscribe?token=${encodeURIComponent(token)}`, undefined);
    const postCtx = makeContext(postReqWithToken, { env: { DB: d1Over(sqlite) as any } });
    const unsubRes = await unsubscribePost(postCtx as any);
    expect(unsubRes.status).toBe(200);
    const unsubBody = await unsubRes.json() as any;
    expect(unsubBody.withdrawn).toBe(true);

    const optIn = sqlite.prepare(
      `SELECT marketingOptIn FROM "player_contact" WHERE id = 'pc_1'`,
    ).get() as { marketingOptIn: number };
    expect(optIn.marketingOptIn).toBe(0);
  });

  it.each(['pending', 'withdrawn', 'bounced'])('rejects consent for a %s contact before ownership checks', async (state) => {
    sqlite.prepare(`UPDATE player_contact SET state = ?`).run!(state);
    mockGetSession.mockResolvedValue({ ...memberSession, user: { ...memberSession.user, id: 'u1', email: 'parent@example.com' } });
    const db = d1Over(sqlite);
    const prepare = vi.spyOn(db, 'prepare');
    const res = await consentGrantPost(makeContext(postReq('/api/consent/grant', {
      contactId: 'pc_1', ...await currentMarketingConsentPolicy(),
    }, { 'X-Club-Slug': CLUB }), { env: { DB: db as any } }) as any);
    expect(res.status).toBe(409);
    expect(prepare.mock.calls.some(([sql]) => /FROM "user_player"/.test(sql))).toBe(false);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM consent_record`).get()).toEqual({ n: 0 });
  });

  it('forbids an unrelated user from granting consent', async () => {
    mockGetSession.mockResolvedValue({
      ...memberSession,
      user: { ...memberSession.user, id: 'u_other', email: 'other@example.com', clubSlug: CLUB },
    });
    const policy = await currentMarketingConsentPolicy();
    const req = postReq('/api/consent/grant', {
      contactId: 'pc_1',
      policyVersion: policy.policyVersion,
      wordingHash: policy.wordingHash,
    }, { 'X-Club-Slug': CLUB });
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await consentGrantPost(ctx as any);
    expect(res.status).toBe(403);
  });
});

describe('admin member-data', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      ...adminSession,
      user: { ...adminSession.user, id: 'u_admin', clubSlug: CLUB },
    });
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u_admin','Admin','admin@example.com',1,NULL,'admin','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user" VALUES
      ('u_member','Parent','parent@example.com',1,NULL,'member','${CLUB}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user_player" VALUES ('up1','u_member','p1','guardian',${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','confirmed',1,0,NULL,${NOW})`);
  });

  afterEach(() => sqlite.close());

  it.each(['{bad', 'null', '{}', '{"name":"Parent","email":false}'])('returns 400 for invalid correction body: %s', async (body) => {
    const req = new Request('https://example.test/api/admin/member-data?userId=u_member', {
      method: 'PATCH', headers: { 'X-Club-Slug': CLUB, 'Content-Type': 'application/json' }, body,
    });
    const res = await memberDataPatch(makeContext(req, { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(res.status).toBe(400);
    expect(sqlite.prepare(`SELECT email FROM user WHERE id = 'u_member'`).get()).toEqual({ email: 'parent@example.com' });
  });

  it('corrects member account data for an admin', async () => {
    const req = patchReq('/api/admin/member-data?userId=u_member', {
      name: 'Corrected Parent', email: 'corrected@example.com',
    }, { 'X-Club-Slug': CLUB });
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await memberDataPatch(ctx as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      ok: true, user: { id: 'u_member', name: 'Corrected Parent', email: 'corrected@example.com' },
    }));
    const row = sqlite.prepare(`SELECT name, email FROM "user" WHERE id = 'u_member'`).get() as { name: string; email: string };
    expect(row).toEqual({ name: 'Corrected Parent', email: 'corrected@example.com' });
  });

  it('exports and deletes member data for an admin', async () => {
    const get = getReq('/api/admin/member-data?userId=u_member', { 'X-Club-Slug': CLUB });
    const getCtx = makeContext(get, { env: { DB: d1Over(sqlite) as any } });
    const getRes = await memberDataGet(getCtx as any);
    expect(getRes.status).toBe(200);
    const bundle = await getRes.json() as any;
    expect(bundle.user.email).toBe('parent@example.com');
    expect(bundle.contacts).toHaveLength(1);

    const del = deleteReq('/api/admin/member-data?userId=u_member', { 'X-Club-Slug': CLUB });
    const delCtx = makeContext(del, { env: { DB: d1Over(sqlite) as any } });
    const delRes = await memberDataDelete(delCtx as any);
    expect(delRes.status).toBe(200);
    const body = await delRes.json() as any;
    expect(body.ok).toBe(true);
    expect(body.deletedContacts).toBe(1);
  });
});


describe('atomic club registration', () => {
  let sqlite: SqliteDb;
  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "user" VALUES ('u1','Parent','parent@example.com',1,NULL,'member',NULL,${NOW},${NOW})`);
    mockGetSession.mockResolvedValue({ ...memberSession, user: { ...memberSession.user, id: 'u1' } });
  });
  afterEach(() => sqlite.close());

  async function register(stale = false) {
    const policy = await currentPolicyPayload();
    return registerPost(makeContext(postReq('/api/clubs/register', {
      clubName: 'New FC',
      emailSignoff: {
        liabilities: Object.fromEntries(policy.liabilities.map(l => [l.id, true])),
        policyVersion: policy.policyVersion,
        wordingHashes: Object.fromEntries(policy.liabilities.map(l => [l.id, l.wordingHash])),
      },
      dpaAcceptance: { ...await currentDpaPolicy(), accepted: true, ...(stale ? { wordingHash: 'stale' } : {}) },
    }), { env: { DB: d1Over(sqlite) as any, MULTI_CLUB: '1', ALLOW_CLUB_SELF_REGISTER: '1' } }) as any);
  }

  it('persists the club, admin role and all acceptances', async () => {
    expect((await register()).status).toBe(201);
    expect(sqlite.prepare(`SELECT slug, published FROM club_config`).get()).toEqual({ slug: 'new-fc', published: 0 });
    expect(sqlite.prepare(`SELECT role, clubSlug FROM user`).get()).toEqual({ role: 'admin', clubSlug: 'new-fc' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_dpa_acceptance`).get()).toEqual({ n: 1 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_email_signoff`).get()).toEqual({ n: 3 });
  });

  it.each(['club_config', 'user', 'club_email_signoff', 'club_dpa_acceptance'])('rolls back registration when %s fails', async table => {
    sqlite.exec(`CREATE TRIGGER fail_registration BEFORE ${table === 'user' ? 'UPDATE' : 'INSERT'} ON "${table}"
      BEGIN SELECT RAISE(ABORT, 'forced registration failure'); END`);
    await expect(register()).rejects.toThrow('forced registration failure');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_config`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT role, clubSlug FROM user`).get()).toEqual({ role: 'member', clubSlug: null });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_email_signoff`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_dpa_acceptance`).get()).toEqual({ n: 0 });
  });

  it('returns 409 for stale DPA wording without writing', async () => {
    expect((await register(true)).status).toBe(409);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM club_config`).get()).toEqual({ n: 0 });
    expect(sqlite.prepare(`SELECT role FROM user`).get()).toEqual({ role: 'member' });
  });
});

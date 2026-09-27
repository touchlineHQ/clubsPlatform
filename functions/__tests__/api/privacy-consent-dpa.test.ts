import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, makeDb, memberSession, adminSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  currentMarketingConsentPolicy,
  recordMarketingConsentGrant,
} from '../../lib/consent';
import { currentDpaPolicy } from '../../lib/dpa';

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

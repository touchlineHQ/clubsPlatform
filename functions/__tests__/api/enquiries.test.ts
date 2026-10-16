import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, secretarySession, treasurerSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));
const sent = vi.hoisted(() => [] as Array<{ to: string; subject: string; text: string; replyTo?: string }>);
vi.mock('../../lib/email', () => ({
  getMailer: vi.fn(() => ({ send: vi.fn(async (m: any) => { sent.push(m); return {}; }) })),
}));

import { onRequestGet, onRequestPost, HONEYPOT_FIELD } from '../../api/enquiries';
import * as admin from '../../api/admin/enquiries';
import { RATE_LIMIT_PER_HOUR, STALE_AFTER_MS, TURNSTILE_VERIFY_URL, purgeStaleEnquiries, getTurnstileConfig, resetTurnstileWarning } from '../../lib/enquiries';

const CLUB = { 'X-Club-Slug': 'test-club', 'CF-Connecting-IP': '203.0.113.9' };
const ENV = { TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' };

const enquiry = (over: Record<string, unknown> = {}) => ({
  ageGroup: 'U12', team: 'U12 Reds', enquirerType: 'guardian', contactName: 'Pat Parent',
  contactEmail: 'Pat@Example.com', contactPhone: '07700 900123', playerFirstName: 'Sam Smith',
  consent: true, turnstileToken: 'good', ...over,
});

describe('/api/enquiries (#73)', () => {
  let sqlite: SqliteDb;
  let db: ReturnType<typeof d1Over>;
  let turnstile: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sent.length = 0;
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
    const now = Date.now();
    sqlite.exec(`INSERT INTO club_config (id, slug, name, data, createdAt) VALUES ('c1', 'test-club', 'Test FC', '{"email":"club@test.fc"}', ${now})`);
    sqlite.exec(`INSERT INTO team_section (id, clubSlug, sectionKey, name, subtitle, icon, createdAt, updatedAt) VALUES ('s1', 'test-club', 'youth', 'Youth', '', '', ${now}, ${now})`);
    for (const [id, name] of [['t1', 'U12 Reds'], ['t2', 'U12 Blues'], ['t3', 'U8 Tigers'], ['t4', 'First Team']]) {
      sqlite.exec(`INSERT INTO team (id, sectionId, name, description, manager, coach, contact, createdAt, updatedAt) VALUES ('${id}', 's1', '${name}', '', '', '', '', ${now}, ${now})`);
    }
    sqlite.exec(`INSERT INTO "user" (id, name, email, role, clubSlug, createdAt, updatedAt) VALUES ('u1', 'Sec', 'sec@test.fc', 'secretary', 'test-club', 1, 1), ('u2', 'Adm', 'adm@test.fc', 'admin', 'test-club', 1, 1)`);
    turnstile = vi.fn(async (_url: string, init: RequestInit) => {
      const token = (init.body as FormData).get('response');
      return new Response(JSON.stringify({ success: token === 'good' }));
    });
    vi.stubGlobal('fetch', turnstile);
  });
  afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); });

  const env = (over: Record<string, unknown> = {}) => ({ DB: db as any, ...ENV, ...over });
  const post = (body: unknown, over: Record<string, unknown> = {}, headers = CLUB) =>
    onRequestPost(makeContext(postReq('/api/enquiries', body, headers), { env: env(over) }) as any);
  const rows = () => sqlite.prepare('SELECT * FROM player_enquiry').all() as any[];

  it('GET lists age groups from the club teams, youngest first, with the site key', async () => {
    const res = await onRequestGet(makeContext(getReq('/api/enquiries', CLUB), { env: env() }) as any);
    const data = await res.json() as any;
    expect(data.ageGroups.map((g: any) => g.ageGroup)).toEqual(['U8', 'U12', 'Open Age']);
    expect(data.ageGroups[1]).toEqual({ ageGroup: 'U12', under16: true, teams: ['U12 Reds', 'U12 Blues'] });
    expect(data.ageGroups[2].under16).toBe(false);
    expect(data).toMatchObject({ turnstileSiteKey: 'site', enabled: true });
  });

  it('GET reports the form disabled without a Turnstile secret', async () => {
    const res = await onRequestGet(makeContext(getReq('/api/enquiries', CLUB), { env: env({ TURNSTILE_SECRET_KEY: undefined }) }) as any);
    expect(await res.json()).toMatchObject({ turnstileSiteKey: null, enabled: false });
  });

  it('accepts an enquiry without an account and emails the secretary and the enquirer', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await post(enquiry());
    expect(res.status).toBe(200);
    const [row] = rows();
    expect(row).toMatchObject({ clubSlug: 'test-club', ageGroup: 'U12', team: 'U12 Reds', status: 'new',
      contactEmail: 'pat@example.com', playerFirstName: 'Sam' });
    expect(sent.map(m => m.to).sort()).toEqual(['pat@example.com', 'sec@test.fc']);
    const ack = sent.find(m => m.to === 'pat@example.com')!;
    expect(ack.text).toContain('https://myaccount.thefa.com');
    const notify = sent.find(m => m.to === 'sec@test.fc')!;
    expect(notify.replyTo).toBe('pat@example.com');
    expect(notify.text).toContain('Pat Parent');
  });

  it('uses the club FA invite link and falls back to admins when there is no secretary', async () => {
    sqlite.exec(`UPDATE club_config SET data = '{"faRegistrationUrl":"https://clubs.thefa.com/invite/abc"}'`);
    sqlite.exec(`DELETE FROM "user" WHERE role = 'secretary'`);
    await post(enquiry());
    expect(sent.map(m => m.to).sort()).toEqual(['adm@test.fc', 'pat@example.com']);
    expect(sent.find(m => m.to === 'pat@example.com')!.text).toContain('https://clubs.thefa.com/invite/abc');
  });

  it('rejects a player enquiring for themselves under 16, allows it for open age', async () => {
    expect((await post(enquiry({ enquirerType: 'player' }))).status).toBe(400);
    expect((await post(enquiry({ ageGroup: 'Open Age', team: null, enquirerType: 'player' }))).status).toBe(200);
  });

  it('rejects unknown age groups, foreign teams, missing consent and bad email', async () => {
    expect((await post(enquiry({ ageGroup: 'U19' }))).status).toBe(400);
    expect((await post(enquiry({ team: 'U8 Tigers' }))).status).toBe(400);
    expect((await post(enquiry({ consent: false }))).status).toBe(400);
    expect((await post(enquiry({ contactEmail: 'nope' }))).status).toBe(400);
    expect(rows()).toHaveLength(0);
  });

  it('does not store fields outside the form', async () => {
    await post(enquiry({ medical: 'asthma', notes: 'anything' }));
    expect(JSON.stringify(rows()[0])).not.toMatch(/asthma|anything/);
  });

  it('Turnstile rejects an automated submission', async () => {
    const res = await post(enquiry({ turnstileToken: 'forged' }));
    expect(res.status).toBe(403);
    expect(turnstile).toHaveBeenCalledWith(TURNSTILE_VERIFY_URL, expect.anything());
    expect((await post(enquiry({ turnstileToken: undefined }))).status).toBe(403);
    expect(rows()).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('refuses submissions when Turnstile is not configured', async () => {
    expect((await post(enquiry(), { TURNSTILE_SECRET_KEY: undefined })).status).toBe(503);
  });

  describe('Turnstile env guard', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { resetTurnstileWarning(); warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
    afterEach(() => { warn.mockRestore(); });

    const getConfig = async (over: Record<string, unknown>) =>
      (await onRequestGet(makeContext(getReq('/api/enquiries', CLUB), { env: env(over) }) as any)).json() as Promise<any>;

    it('unset secret: GET disabled, POST 503 without verifying or storing, warns once', async () => {
      const over = { TURNSTILE_SECRET_KEY: undefined };
      expect(await getConfig(over)).toMatchObject({ turnstileSiteKey: null, enabled: false });
      const res = await post(enquiry(), over);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'Enquiries are not configured for this club yet' });
      expect(turnstile).not.toHaveBeenCalled();
      expect(rows()).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('TURNSTILE_SECRET_KEY');
    });

    it('unset site key: GET does not hand out a widget, POST 503, warns once', async () => {
      const over = { TURNSTILE_SITE_KEY: undefined };
      expect(await getConfig(over)).toMatchObject({ turnstileSiteKey: null, enabled: false });
      expect((await post(enquiry(), over)).status).toBe(503);
      expect(turnstile).not.toHaveBeenCalled();
      expect(rows()).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('TURNSTILE_SITE_KEY');
    });

    it('blank values count as unset', async () => {
      expect(getTurnstileConfig({ TURNSTILE_SECRET_KEY: '  ', TURNSTILE_SITE_KEY: '' })).toBeNull();
      expect(String(warn.mock.calls[0][0])).toContain('TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY');
    });

    it('both set: form enabled, submission verified and stored, no warning', async () => {
      expect(await getConfig({})).toMatchObject({ turnstileSiteKey: 'site', enabled: true });
      expect((await post(enquiry())).status).toBe(200);
      expect(turnstile).toHaveBeenCalledWith(TURNSTILE_VERIFY_URL, expect.anything());
      expect(rows()).toHaveLength(1);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('silently drops honeypot submissions', async () => {
    const res = await post(enquiry({ [HONEYPOT_FIELD]: 'http://spam' }));
    expect(res.status).toBe(200);
    expect(rows()).toHaveLength(0);
    expect(turnstile).not.toHaveBeenCalled();
  });

  it('rate limits per IP, storing only a hash', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) expect((await post(enquiry())).status).toBe(200);
    expect((await post(enquiry())).status).toBe(429);
    expect((await post(enquiry(), {}, { ...CLUB, 'CF-Connecting-IP': '198.51.100.1' })).status).toBe(200);
    const keys = sqlite.prepare('SELECT key FROM enquiry_rate_limit').all() as { key: string }[];
    expect(JSON.stringify(keys)).not.toContain('203.0.113.9');
  });

  it('does not count validation failures against the rate limit', async () => {
    for (let i = 0; i < RATE_LIMIT_PER_HOUR + 2; i++) {
      expect((await post(enquiry({ contactPhone: 'not a phone' }))).status).toBe(400);
    }
    expect((await post(enquiry())).status).toBe(200);
  });

  it('still returns 200 when post-insert purge or mail setup fails', async () => {
    const enquiriesLib = await import('../../lib/enquiries');
    const purgeSpy = vi.spyOn(enquiriesLib, 'purgeStaleEnquiries').mockRejectedValue(new Error('purge down'));
    const { getMailer } = await import('../../lib/email');
    (getMailer as any).mockImplementationOnce(() => { throw new Error('mailer boom'); });
    const res = await post(enquiry({ contactEmail: 'survive@example.com' }));
    expect(res.status).toBe(200);
    expect((await res.json() as any).ok).toBe(true);
    expect(rows().some((r: any) => r.contactEmail === 'survive@example.com')).toBe(true);
    purgeSpy.mockRestore();
  });

  describe('admin triage', () => {
    const call = (fn: any, req: Request) => fn(makeContext(req, { env: env() }) as any);
    const ADMIN = { 'X-Club-Slug': 'test-club' };

    beforeEach(async () => {
      await post(enquiry());
      mockGetSession.mockResolvedValue(secretarySession);
    });

    it('lets a secretary list enquiries but not a treasurer', async () => {
      const res = await call(admin.onRequestGet, getReq('/api/admin/enquiries', ADMIN));
      const body = await res.json() as any;
      expect(body.items[0]).toMatchObject({ contactName: 'Pat Parent', status: 'new' });
      expect(body).toMatchObject({ hasMore: false, offset: 0, limit: 200 });
      mockGetSession.mockResolvedValue(treasurerSession);
      expect((await call(admin.onRequestGet, getReq('/api/admin/enquiries', ADMIN))).status).toBe(403);
    });

    it('pages past LIST_LIMIT with offset and hasMore', async () => {
      const { LIST_LIMIT } = await import('../../api/admin/enquiries');
      const now = Date.now();
      // One row already from beforeEach; add enough more to cross the page boundary.
      for (let i = 1; i <= LIST_LIMIT; i++) {
        sqlite.exec(
          `INSERT INTO player_enquiry (id, clubSlug, ageGroup, team, enquirerType, contactName, contactEmail,
            contactPhone, playerFirstName, status, consentAt, createdAt, updatedAt)
           VALUES ('enq_page_${i}', 'test-club', 'U12', NULL, 'guardian', 'N', 'n${i}@ex.com', NULL, 'P', 'new', ${now}, ${now - i}, ${now})`,
        );
      }
      const page1 = await (await call(admin.onRequestGet, getReq('/api/admin/enquiries', ADMIN))).json() as any;
      expect(page1.items).toHaveLength(LIST_LIMIT);
      expect(page1.hasMore).toBe(true);
      const page2 = await (await call(admin.onRequestGet, getReq(`/api/admin/enquiries?offset=${LIST_LIMIT}`, ADMIN))).json() as any;
      expect(page2.items.length).toBeGreaterThanOrEqual(1);
      expect(page2.hasMore).toBe(false);
      expect(page2.offset).toBe(LIST_LIMIT);
    });

    it('keeps contact fields through non-terminal statuses', async () => {
      const id = rows()[0].id;
      for (const status of ['contacted', 'fa_sent']) {
        expect((await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status }, ADMIN))).status).toBe(200);
      }
      expect(rows()[0]).toMatchObject({ status: 'fa_sent', contactEmail: 'pat@example.com' });
    });

    it.each(['registered', 'declined'])('reaching %s nulls the contact fields', async (status) => {
      mockGetSession.mockResolvedValue(adminSession);
      const id = rows()[0].id;
      expect((await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status }, ADMIN))).status).toBe(200);
      const row = rows()[0];
      expect(row).toMatchObject({ status, ageGroup: 'U12', contactName: null, contactEmail: null, contactPhone: null, playerFirstName: null });
      expect(row.contactPurgedAt).not.toBeNull();
    });

    it('rejects a status change once the enquiry is terminal', async () => {
      mockGetSession.mockResolvedValue(adminSession);
      const id = rows()[0].id;
      expect((await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status: 'registered' }, ADMIN))).status).toBe(200);
      const res = await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status: 'new' }, ADMIN));
      expect(res.status).toBe(409);
      expect(rows()[0]).toMatchObject({ status: 'registered', contactEmail: null });
    });

    it('rejects bad statuses and other clubs', async () => {
      const id = rows()[0].id;
      expect((await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status: 'won' }, ADMIN))).status).toBe(400);
      mockGetSession.mockResolvedValue({ ...adminSession, user: { ...adminSession.user, clubSlug: null } });
      expect((await call(admin.onRequestPatch, patchReq('/api/admin/enquiries', { id, status: 'contacted' }, { 'X-Club-Slug': 'other' }))).status).toBe(404);
    });

    it('one-click delete removes the row', async () => {
      const id = rows()[0].id;
      expect((await call(admin.onRequestDelete, deleteReq(`/api/admin/enquiries?id=${id}`, ADMIN))).status).toBe(200);
      expect(rows()).toHaveLength(0);
      expect((await call(admin.onRequestDelete, deleteReq(`/api/admin/enquiries?id=${id}`, ADMIN))).status).toBe(404);
    });
  });

  describe('stale purge', () => {
    it('nulls contact fields of enquiries untouched for 6 months, and only those', async () => {
      await post(enquiry());
      await post(enquiry({ contactEmail: 'fresh@example.com' }));
      const [old] = rows();
      const now = Date.now();
      sqlite.prepare('UPDATE player_enquiry SET updatedAt = ? WHERE id = ?').run!(now - STALE_AFTER_MS - 1000, old.id);
      expect(await purgeStaleEnquiries(db as any, now)).toBe(1);
      const after = rows();
      expect(after.find(r => r.id === old.id)).toMatchObject({ contactEmail: null, contactName: null, ageGroup: 'U12', status: 'new' });
      expect(after.find(r => r.id !== old.id).contactEmail).toBe('fresh@example.com');
      expect(await purgeStaleEnquiries(db as any, now)).toBe(0);
    });

    it('runs on every admin list load', async () => {
      await post(enquiry());
      sqlite.exec(`UPDATE player_enquiry SET updatedAt = 0`);
      mockGetSession.mockResolvedValue(adminSession);
      const res = await admin.onRequestGet(makeContext(getReq('/api/admin/enquiries', { 'X-Club-Slug': 'test-club' }), { env: env() }) as any);
      expect((await res.json() as any).items[0].contactEmail).toBeNull();
    });
  });
});

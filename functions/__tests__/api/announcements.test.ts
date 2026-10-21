import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  makeContext, adminSession, secretarySession, managerSession, memberSession,
  getReq, postReq, putReq,
} from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestPost as announce } from '../../api/admin/announcements';
import { onRequestGet as groupGet, onRequestPut as groupPut } from '../../api/team-group-link';
import { onRequestGet as teamsGet } from '../../api/teams';
import { whatsappCopyText } from '../../lib/announcement';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';
const H = { 'X-Club-Slug': CLUB };

describe('announcement composer (#74)', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, createdAt) VALUES ('c1','${CLUB}','Test FC',1,${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state, operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_1','${CLUB}','p1','parent@example.com','guardian','confirmed',1,0,NULL,${NOW})`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p2','FAN002',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state, operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_2','${CLUB}','p2','pending@example.com','guardian','pending',1,0,NULL,${NOW})`);
    for (const [id, p] of [['r1', 'p1'], ['r2', 'p2']]) {
      sqlite.exec(`INSERT INTO "player_registration"
        (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
        VALUES ('${id}','${CLUB}','${p}','U12 Blues',NULL,NULL,'Active',${NOW},${NOW})`);
    }
    mockGetSession.mockResolvedValue(adminSession);
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  const post = (body: unknown, env: Record<string, unknown> = {}) =>
    announce(makeContext(postReq('/api/admin/announcements', body, H), {
      env: { DB: d1Over(sqlite) as any, ...env },
    }) as any);

  it('publishes to the club site and returns a WhatsApp copy block, without email by default', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await post({ title: 'Training cancelled', text: 'Pitch waterlogged tonight.' });
    expect(res.status).toBe(201);
    const body = await res.json() as { item: { id: string }; copyText: string; email: unknown };
    expect(body.email).toBeNull();
    expect(body.copyText).toContain('*Test FC: Training cancelled*');
    expect(body.copyText).toContain('Pitch waterlogged tonight.');
    expect(body.copyText).not.toMatch(/<[a-z]/i);
    const rows = sqlite.prepare(`SELECT id, clubSlug, title FROM news_item`).all();
    expect(rows).toEqual([{ id: body.item.id, clubSlug: CLUB, title: 'Training cancelled' }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emails only members with a valid basis through the send guard', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await post(
      { title: 'Kit day', text: 'Saturday 10am.', email: { type: 'team', teamName: 'U12 Blues' } },
      { RESEND_API_KEY: 'k', FROM_EMAIL: 'noreply@example.com' },
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { email: { sentCount: number; droppedCount: number; mailConfigured: boolean } };
    expect(body.email).toMatchObject({ sentCount: 1, droppedCount: 1, mailConfigured: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(sent).toContain('parent@example.com');
    expect(sent).not.toContain('pending@example.com');
  });

  it('needs content to publish; secretary (content + members) can publish and email', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const denied = await post({ title: 'x', text: 'y' });
    expect(denied.status).toBe(403);

    mockGetSession.mockResolvedValue(secretarySession);
    const ok = await post({ title: 'x', text: 'y', email: { type: 'club' } });
    expect(ok.status).toBe(201);
  });

  it('rejects caller-supplied recipients and missing fields', async () => {
    expect((await post({ title: 't', text: 'x', to: ['a@b.c'] })).status).toBe(403);
    expect((await post({ title: '', text: 'x' })).status).toBe(400);
    expect((await post({ title: 't', text: 'x', email: { type: 'contact', contactId: 'pc_1' } })).status).toBe(400);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM news_item`).get()).toEqual({ n: 0 });
  });

  it('formats WhatsApp copy as plain text', () => {
    expect(whatsappCopyText({ clubName: 'FC', title: '*Big* news', text: 'a\n\n\n\nb', link: 'https://x/#/news' }))
      .toBe('*FC: Big news*\n\na\n\nb\n\nhttps://x/#/news');
  });
});

describe('team group link access (#74)', () => {
  let sqlite: SqliteDb;
  const q = '/api/team-group-link?slug=u12-blues&league=jpl';

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.exec(`INSERT INTO "team_group_link" (clubSlug, teamSlug, teamLeague, url, updatedBy, updatedAt)
      VALUES ('${CLUB}','u12-blues','jpl','https://chat.whatsapp.com/abc',NULL,${NOW})`);
  });
  afterEach(() => sqlite.close());

  const get = () => groupGet(makeContext(getReq(q, H), { env: { DB: d1Over(sqlite) as any } }) as any);

  it('returns 403 for a signed-out user', async () => {
    mockGetSession.mockResolvedValue(null);
    expect((await get()).status).toBe(403);
  });

  it('returns 403 for a signed-in user not on the team, and for a mere follower', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    expect((await get()).status).toBe(403);
    sqlite.exec(`INSERT INTO "user_team_role" (id, clubSlug, userId, teamSlug, teamLeague, teamName, role, createdAt)
      VALUES ('utr1','${CLUB}','user_1','u12-blues','jpl','U12 Blues','subscriber',${NOW})`);
    expect((await get()).status).toBe(403);
  });

  it('returns the link to a coach or manager assigned to the team', async () => {
    sqlite.exec(`INSERT INTO "user_team_role" (id, clubSlug, userId, teamSlug, teamLeague, teamName, role, createdAt)
      VALUES ('utr1','${CLUB}','user_1','u12-blues','jpl','U12 Blues','manager',${NOW})`);
    mockGetSession.mockResolvedValue(memberSession);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://chat.whatsapp.com/abc' });
  });

  it('does not let an assignment in another club unlock this club', async () => {
    sqlite.exec(`INSERT INTO "user_team_role" (id, clubSlug, userId, teamSlug, teamLeague, teamName, role, createdAt)
      VALUES ('utr1','other-club','user_1','u12-blues','jpl','U12 Blues','manager',${NOW})`);
    mockGetSession.mockResolvedValue(memberSession);
    expect((await get()).status).toBe(403);
  });

  it('lets a content editor set and clear it, and refuses non-https', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const put = (url: unknown) => groupPut(makeContext(putReq(q, { url }, H), { env: { DB: d1Over(sqlite) as any } }) as any);
    expect((await put('javascript:alert(1)')).status).toBe(400);
    expect((await put('https://chat.whatsapp.com/new')).status).toBe(200);
    expect(await (await get()).json()).toEqual({ url: 'https://chat.whatsapp.com/new' });
    expect((await put(null)).status).toBe(200);
    expect(await (await get()).json()).toEqual({ url: null });

    mockGetSession.mockResolvedValue(memberSession);
    expect((await put('https://chat.whatsapp.com/x')).status).toBe(403);
  });

  it('never appears on the public teams listing', async () => {
    mockGetSession.mockResolvedValue(null);
    sqlite.exec(`INSERT INTO "team_section" (id, clubSlug, sectionKey, name, subtitle, icon, logo, sortOrder, createdAt, updatedAt)
      VALUES ('s1','${CLUB}','juniors','Juniors','','fa',NULL,0,${NOW},${NOW})`);
    try {
      sqlite.exec(`ALTER TABLE "team" ADD COLUMN "forConsolidation" INTEGER NOT NULL DEFAULT 0`);
    } catch { /* already present */ }
    sqlite.exec(`INSERT INTO "team" (id, sectionId, name, description, manager, coach, contact, slug, sortOrder, createdAt, updatedAt)
      VALUES ('t1','s1','U12 Blues','','','','','u12-blues',0,${NOW},${NOW})`);
    const res = await teamsGet(makeContext(getReq('/api/teams', H), { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).not.toContain('chat.whatsapp.com');
  });
});

describe('whatsappCopyText title (#74)', () => {
  it('keeps a multi-line title on one bold line', () => {
    const out = whatsappCopyText({ clubName: 'Test FC', title: 'Training\ncancelled', text: 'Pitch waterlogged.' });
    expect(out.split('\n')[0]).toBe('*Test FC: Training cancelled*');
  });
});

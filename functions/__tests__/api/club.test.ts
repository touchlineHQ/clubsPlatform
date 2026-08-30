import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { makeContext, makeDb, getReq, patchReq, adminSession, memberSession, platformAdminSession } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/seed', () => ({
  seedClubData: vi.fn(async () => {}),
}));

vi.mock('../../lib/audit-log', () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { onRequestGet, onRequestPatch } from '../../api/club';
import { writeAuditLog } from '../../lib/audit-log';

/** Every prepare() call paired with the bindings it was given. */
function prepared(db: any): { sql: string; bindings: unknown[] }[] {
  const prepare = db.prepare as Mock;
  return prepare.mock.calls.map((call: unknown[], i: number) => ({
    sql: call[0] as string,
    bindings: prepare.mock.results[i].value.bind.mock.calls[0] ?? [],
  }));
}

const clubRow = {
  slug: 'test-club',
  name: 'Test FC',
  primaryColor: null,
  data: JSON.stringify({ slug: 'test-club', name: 'Test FC', tagline: 'Play hard', email: 'info@test.com', address: {} }),
  seeded: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(adminSession);
});

describe('GET /api/club', () => {
  it('returns 400 when X-Club-Slug header is missing', async () => {
    const db = makeDb();
    const ctx = makeContext(getReq('/api/club'), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when club is not found in DB', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'unknown' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(404);
  });

  it('returns club data from DB when seeded=1', async () => {
    const db = makeDb({ first: clubRow });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; slug: string };
    expect(body.name).toBe('Test FC');
    expect(body.slug).toBe('test-club');
  });

  it('triggers seeding and re-fetches data when seeded=0', async () => {
    const unseededRow = { ...clubRow, seeded: 0, data: null };
    const reseededRow = { ...clubRow, data: JSON.stringify({ slug: 'test-club', name: 'Test FC' }) };
    const db = makeDb({ first: [unseededRow, reseededRow] as unknown });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), {
      env: { DB: db as never, ASSETS: { fetch: async () => new Response('{}', { status: 200 }) } as never },
    });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
  });

  it('uses defaultClub when row.data is null', async () => {
    const db = makeDb({ first: { ...clubRow, data: null } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as { name: string; slug: string };
    expect(body.name).toBe('Test FC');
    expect(body.slug).toBe('test-club');
  });

  it('includes primaryColor in response when set', async () => {
    const db = makeDb({ first: { ...clubRow, primaryColor: '#ff0000' } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as { primaryColor: string };
    expect(body.primaryColor).toBe('#ff0000');
  });

  // ─── Unpublished clubs ─────────────────────────────────────────────────────

  it('serves a published club without looking up a session', async () => {
    const db = makeDb({ first: { ...clubRow, published: 1 } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it('returns 404 for an unpublished club when nobody is signed in', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb({ first: { ...clubRow, published: 0 } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(404);
    // The same message a genuinely missing club gets — the response must not
    // confirm that a private club is there.
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Club not found');
  });

  it('returns 404 for an unpublished club when the viewer is not an admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const db = makeDb({ first: { ...clubRow, published: 0 } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(404);
  });

  it('serves an unpublished club to its own admin', async () => {
    const db = makeDb({ first: { ...clubRow, published: 0 } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string };
    expect(body.name).toBe('Test FC');
  });

  it('returns 404 for an unpublished club to an admin of a different club', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: { ...clubRow, slug: 'other-club', published: 0 } });
    const ctx = makeContext(
      getReq('/api/club', { 'X-Club-Slug': 'other-club' }),
      { env: { DB: db as never, MULTI_CLUB: '1' } },
    );
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(404);
  });

  it('serves an unpublished club to a platform admin', async () => {
    mockGetSession.mockResolvedValue(platformAdminSession);
    const db = makeDb({ first: { ...clubRow, published: 0 } });
    const ctx = makeContext(
      getReq('/api/club', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never, MULTI_CLUB: '1' } },
    );
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
  });
});

describe('PATCH /api/club', () => {
  it('returns 400 when X-Club-Slug header is missing', async () => {
    const db = makeDb();
    const ctx = makeContext(patchReq('/api/club', { name: 'New Name' }), { env: { DB: db as never } });
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when club is not found', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq('/api/club', { name: 'New Name' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(404);
  });

  it('updates club data and returns ok', async () => {
    const db = makeDb({ first: { data: JSON.stringify({ slug: 'test-club', name: 'Test FC' }) }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/club', { name: 'Updated FC' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('syncs primaryColor to club_config when primaryColor is in body', async () => {
    const db = makeDb({ first: { data: null }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/club', { primaryColor: '#00ff00' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  // ─── Go live / make private ────────────────────────────────────────────────

  const patchPublished = (published: boolean, wasPublished: number, env: Record<string, unknown> = {}) => {
    const db = makeDb({
      // The schema guard's PRAGMA reads the `all` queue before the row lookup.
      all: [[{ name: 'published' }]],
      first: { id: 'club_1', data: null, published: wasPublished },
      run: { meta: { changes: 1 } },
    });
    const ctx = makeContext(
      patchReq('/api/club', { published }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never, ...env } },
    );
    return { db, ctx };
  };

  it('takes a private club live and logs it', async () => {
    const { db, ctx } = patchPublished(true, 0);
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);

    const update = prepared(db).find(p => /UPDATE club_config SET/.test(p.sql));
    expect(update?.sql).toMatch(/published = \?/);
    expect(update?.bindings).toContain(1);
    expect(writeAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        clubSlug: 'test-club',
        action: 'club.publish',
        targetTable: 'club_config',
        targetId: 'club_1',
        oldStatus: 'private',
        newStatus: 'published',
      }),
    );
  });

  it('takes a live club private and logs it', async () => {
    const { db, ctx } = patchPublished(false, 1);
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);

    const update = prepared(db).find(p => /UPDATE club_config SET/.test(p.sql));
    expect(update?.bindings).toContain(0);
    expect(writeAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'club.unpublish', oldStatus: 'published', newStatus: 'private' }),
    );
  });

  // The whole reason this lives on /api/club rather than /api/clubs, which is
  // gated on multi-club mode: a single-club fork has to be able to go live.
  it('publishes on a single-club deployment', async () => {
    const { ctx } = patchPublished(true, 0);
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('publishes on a multi-club deployment', async () => {
    const { ctx } = patchPublished(true, 0, { MULTI_CLUB: '1' });
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });

  it('does not log when published is unchanged', async () => {
    const { ctx } = patchPublished(true, 1);
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('keeps published out of the stored content blob', async () => {
    const { db, ctx } = patchPublished(true, 0);
    await onRequestPatch(ctx as never);

    const update = prepared(db).find(p => /UPDATE club_config SET/.test(p.sql));
    const blob = JSON.parse(update?.bindings[0] as string) as Record<string, unknown>;
    // The column is the single source of truth; a copy in the blob could drift.
    expect(blob).not.toHaveProperty('published');
  });

  it('rejects a publish attempt from a non-admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const { ctx } = patchPublished(true, 0);
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a publish attempt against another club', async () => {
    mockGetSession.mockResolvedValue(adminSession); // admin of 'test-club'
    const db = makeDb({ first: { id: 'club_1', data: null, published: 0 } });
    const ctx = makeContext(
      patchReq('/api/club', { published: true }, { 'X-Club-Slug': 'other-club' }),
      { env: { DB: db as never, MULTI_CLUB: '1' } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 503 without updating when migration 0021 is not applied', async () => {
    const db = makeDb({ all: [[{ name: 'id' }]] });
    const ctx = makeContext(
      patchReq('/api/club', { published: true }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(503);
    expect(prepared(db).some(p => /UPDATE club_config SET/.test(p.sql))).toBe(false);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  // This endpoint carries every content save the Customise page makes. Naming
  // `published` on those would break saving outright on a database that has not
  // had migration 0021 applied — a far worse failure than a stuck toggle.
  it('never touches the published column on an ordinary content save', async () => {
    const db = makeDb({ first: { id: 'club_1', data: null }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/club', { name: 'Updated FC' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);

    const sql = prepared(db).map(p => p.sql).join('\n');
    expect(sql).not.toMatch(/published/);
    expect(sql).not.toMatch(/PRAGMA/);
  });
});

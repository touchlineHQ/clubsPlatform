import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest';
import { makeContext, makeDb, adminSession, platformAdminSession, memberSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/audit-log', () => ({ writeAuditLog: vi.fn(async () => {}) }));

// ─── clubs.ts ─────────────────────────────────────────────────────────────────

import {
  onRequestGet as clubsGet,
  onRequestPost as clubsPost,
  onRequestPatch as clubsPatch,
  onRequestDelete as clubsDelete,
} from '../../api/clubs';
import { writeAuditLog } from '../../lib/audit-log';

/** Every prepare() call paired with the bindings it was given. */
function prepared(db: any): { sql: string; bindings: unknown[] }[] {
  const prepare = db.prepare as Mock;
  return prepare.mock.calls.map((call: unknown[], i: number) => ({
    sql: call[0] as string,
    bindings: prepare.mock.results[i].value.bind.mock.calls[0] ?? [],
  }));
}

describe('clubs POST (create club in multi-club mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(platformAdminSession);
  });

  it('creates a club and returns 201', async () => {
    const req = postReq('/api/clubs', { slug: 'my-club', name: 'My Club FC' });
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        DB: makeDb({ first: null, run: { meta: { changes: 1 } } }),
      },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(body.slug).toBe('my-club');
  });

  it('returns 409 when the slug is already taken', async () => {
    const req = postReq('/api/clubs', { slug: 'my-club', name: 'My Club FC' });
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        DB: makeDb({ first: { id: 'club_existing' } }),
      },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error).toMatch(/already exists/);
  });

  it('returns 400 when slug is missing', async () => {
    const req = postReq('/api/clubs', { name: 'My Club FC' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/slug/);
  });

  it('returns 400 when name is missing', async () => {
    const req = postReq('/api/clubs', { slug: 'my-club' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/name/);
  });

  it('returns 400 when slug contains invalid characters', async () => {
    const req = postReq('/api/clubs', { slug: 'My Club!', name: 'My Club FC' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/slug/);
  });

  it('returns 403 when multi-club mode is not enabled', async () => {
    const req = postReq('/api/clubs', { slug: 'my-club', name: 'My Club FC' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Multi-club/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/clubs', { slug: 'my-club', name: 'My Club FC' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('clubs PATCH (update club)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(platformAdminSession);
  });

  it('updates a club and returns ok', async () => {
    const req = patchReq(
      '/api/clubs',
      { name: 'Updated FC', active: true },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        DB: makeDb({ first: { id: 'club_1' }, run: { meta: { changes: 1 } } }),
      },
    });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when club is not found', async () => {
    const req = patchReq(
      '/api/clubs',
      { name: 'Updated FC' },
      { 'X-Club-Slug': 'unknown-club' },
    );
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb({ first: null }) },
    });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Not found/);
  });

  it('returns 400 when X-Club-Slug header is missing', async () => {
    const req = patchReq('/api/clubs', { name: 'Updated FC' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/X-Club-Slug/);
  });

  it('returns 400 when body has nothing to update', async () => {
    const req = patchReq(
      '/api/clubs',
      {},
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        DB: makeDb({ first: { id: 'club_1' } }),
      },
    });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Nothing to update/);
  });

  it('returns 403 when multi-club mode is not enabled', async () => {
    const req = patchReq('/api/clubs', { name: 'Updated FC' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = patchReq('/api/clubs', { name: 'Updated FC' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(401);
  });

  // ─── Go live / make private ────────────────────────────────────────────────

  it('takes a private club live and logs it', async () => {
    const db = makeDb({ first: { id: 'club_1', published: 0 }, run: { meta: { changes: 1 } } });
    const req = patchReq('/api/clubs', { published: true }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { MULTI_CLUB: '1', DB: db } });

    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(200);

    const update = prepared(db).find(p => /UPDATE club_config SET/.test(p.sql));
    expect(update?.sql).toMatch(/published = \?/);
    expect(update?.bindings).toEqual([1, 'club_1']);
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
    const db = makeDb({ first: { id: 'club_1', published: 1 }, run: { meta: { changes: 1 } } });
    const req = patchReq('/api/clubs', { published: false }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { MULTI_CLUB: '1', DB: db } });

    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(200);

    const update = prepared(db).find(p => /UPDATE club_config SET/.test(p.sql));
    expect(update?.bindings).toEqual([0, 'club_1']);
    expect(writeAuditLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ action: 'club.unpublish', oldStatus: 'published', newStatus: 'private' }),
    );
  });

  it('does not log when published is unchanged', async () => {
    const db = makeDb({ first: { id: 'club_1', published: 1 }, run: { meta: { changes: 1 } } });
    const req = patchReq('/api/clubs', { published: true }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { MULTI_CLUB: '1', DB: db } });

    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(200);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('rejects a publish attempt from a non-admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const req = patchReq('/api/clubs', { published: true }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { MULTI_CLUB: '1', DB: makeDb() } });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a publish attempt against another club", async () => {
    mockGetSession.mockResolvedValue(adminSession); // admin of 'test-club'
    const req = patchReq('/api/clubs', { published: true }, { 'X-Club-Slug': 'other-club' });
    const ctx = makeContext(req, { env: { MULTI_CLUB: '1', DB: makeDb() } });
    const res = await clubsPatch(ctx as any);
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('clubs DELETE (soft-delete club)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(platformAdminSession);
  });

  it('soft-deletes a club and returns ok', async () => {
    const req = deleteReq('/api/clubs?id=club_1');
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        DB: makeDb({ run: { meta: { changes: 1 } } }),
      },
    });
    const res = await clubsDelete(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 400 when id query param is missing', async () => {
    const req = deleteReq('/api/clubs');
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsDelete(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/);
  });

  it('returns 403 when multi-club mode is not enabled', async () => {
    const req = deleteReq('/api/clubs?id=club_1');
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await clubsDelete(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = deleteReq('/api/clubs?id=club_1');
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await clubsDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── clubs/register.ts ────────────────────────────────────────────────────────

import { onRequestPost as registerPost } from '../../api/clubs/register';

describe('clubs/register POST (user self-registers a new club)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(memberSession);
  });

  it('registers a new club and returns 201 with slug', async () => {
    const req = postReq('/api/clubs/register', { clubName: 'Riverside FC' });
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        // First .all() returns empty set (no slug conflicts), two .run() calls follow
        DB: makeDb({ all: [[]], run: { meta: { changes: 1 } } }),
      },
    });
    const res = await registerPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(typeof body.slug).toBe('string');
    expect(body.slug).toMatch(/riverside-fc/);
  });

  it('appends a numeric suffix when slug is already taken', async () => {
    const req = postReq('/api/clubs/register', { clubName: 'Riverside FC' });
    const ctx = makeContext(req, {
      env: {
        MULTI_CLUB: '1',
        // .all() returns a row with the base slug already taken
        DB: makeDb({ all: [[{ slug: 'riverside-fc' }]], run: { meta: { changes: 1 } } }),
      },
    });
    const res = await registerPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    // Should have gotten a suffixed slug like 'riverside-fc-2'
    expect(body.slug).not.toBe('riverside-fc');
    expect(body.slug).toMatch(/riverside-fc-\d+/);
  });

  it('returns 400 when clubName is missing', async () => {
    const req = postReq('/api/clubs/register', {});
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await registerPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/clubName/);
  });

  it('returns 403 when multi-club mode is not enabled', async () => {
    const req = postReq('/api/clubs/register', { clubName: 'Riverside FC' });
    const ctx = makeContext(req, { env: { DB: makeDb() } });
    const res = await registerPost(ctx as any);
    expect(res.status).toBe(403);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Multi-club/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = postReq('/api/clubs/register', { clubName: 'Riverside FC' });
    const ctx = makeContext(req, {
      env: { MULTI_CLUB: '1', DB: makeDb() },
    });
    const res = await registerPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── Registry ─────────────────────────────────────────────────────────────────

describe('clubs GET (registry)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(null);
  });

  it('reports each club as live or private', async () => {
    const db = makeDb({
      all: [[
        { id: 'club_1', slug: 'live-fc', name: 'Live FC', active: 1, primaryColor: null, secondaryColor: null, published: 1, createdAt: 1 },
        { id: 'club_2', slug: 'quiet-fc', name: 'Quiet FC', active: 1, primaryColor: null, secondaryColor: null, published: 0, createdAt: 2 },
      ]],
    });
    const ctx = makeContext(getReq('/api/clubs'), { env: { MULTI_CLUB: '1', DB: db } });
    const res = await clubsGet(ctx as any);
    const body = await res.json() as any;
    expect(body.clubs.map((c: any) => [c.slug, c.published])).toEqual([
      ['live-fc', true],
      ['quiet-fc', false],
    ]);
  });

  it('keeps private clubs in the registry so their admins can still reach them', async () => {
    const db = makeDb({
      all: [[
        { id: 'club_2', slug: 'quiet-fc', name: 'Quiet FC', active: 1, primaryColor: null, secondaryColor: null, published: 0, createdAt: 2 },
      ]],
    });
    const ctx = makeContext(getReq('/api/clubs'), { env: { MULTI_CLUB: '1', DB: db } });
    const res = await clubsGet(ctx as any);
    const body = await res.json() as any;
    expect(body.clubs).toHaveLength(1);
  });

  it('treats every club as live when the published column is missing', async () => {
    // A deployment can land before migration 0021 has been applied; the
    // registry every club site depends on must not 500 in that window.
    const db = makeDb({
      all: [[
        { id: 'club_1', slug: 'live-fc', name: 'Live FC', active: 1, primaryColor: null, secondaryColor: null, published: 1, createdAt: 1 },
      ]],
    });
    let firstCall = true;
    const inner = db.prepare as Mock;
    const original = inner.getMockImplementation()!;
    inner.mockImplementation((...args: unknown[]) => {
      if (firstCall && String(args[0]).includes('published,')) {
        firstCall = false;
        return { all: vi.fn(async () => { throw new Error('no such column: published'); }), bind: vi.fn() };
      }
      return original(...args);
    });

    const ctx = makeContext(getReq('/api/clubs'), { env: { MULTI_CLUB: '1', DB: db } });
    const res = await clubsGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.clubs[0].published).toBe(true);
  });
});

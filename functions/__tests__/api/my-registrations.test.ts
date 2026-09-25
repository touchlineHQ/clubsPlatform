import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, memberSession, getReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

// Without this the read-cost tests build a real client and it attempts an HTTP
// call to the fake host, so the assertion passes while the test does I/O.
const mockCaptureImmediate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('posthog-node', () => ({
  PostHog: vi.fn(() => ({ captureImmediate: mockCaptureImmediate })),
}));

import { onRequestGet, onRequestDelete } from '../../api/my-registrations';

const sampleRegistration = {
  registrationId: 'reg_1',
  fanId: 'fan_001',
  teamName: 'U11s',
  ageGroup: 'U11',
  registrationExpiry: '2025-07-31',
  registrationStatus: 'active',
  relationship: 'parent',
  linkedAccounts: null,
  subscriptionLevelId: 'sl_1',
  subscriptionLevelName: 'Standard',
  paymentStatus: 'active',
};

const clubRegistration = {
  registrationId: 'reg_2',
  fanId: 'fan_002',
  teamName: 'U9s',
  ageGroup: 'U9',
  registrationExpiry: '2025-07-31',
  registrationStatus: 'active',
  relationship: null,
  linkedAccounts: 'parent@example.com|parent',
  subscriptionLevelId: null,
  subscriptionLevelName: null,
  paymentStatus: null,
};

beforeEach(() => vi.clearAllMocks());

// ─── onRequestGet ─────────────────────────────────────────────────────────────

describe('onRequestGet', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when X-Club-Slug header is missing', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const db = makeDb({ all: [[]] });
    const ctx = makeContext(
      getReq('/api/my-registrations'),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(400);
  });

  it('member scope: returns personal registrations with scope=user', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    // .all() is called once for personalRows
    const db = makeDb({ all: [[sampleRegistration]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.scope).toBe('user');
    expect(Array.isArray(body.personal)).toBe(true);
    expect(body.personal.length).toBe(1);
    expect(body.personal[0].registrationId).toBe('reg_1');
    // `club` is gone, not null: the club's rows come from /api/admin/registrations.
    expect(body).not.toHaveProperty('club');
  });

  it('member scope: returns empty personal array when no registrations', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const db = makeDb({ all: [[]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.scope).toBe('user');
    expect(body.personal).toEqual([]);
  });

  it('ranks a live subscription above a finished one, and both above a spent mandate', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[sampleRegistration], [clubRegistration]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    await onRequestGet(ctx as any);

    const [personalSql] = (db.prepare as any).mock.calls.map((c: unknown[]) => c[0] as string);
    const order = ['active', 'completed', 'manual', 'mandate_only'].map((s) =>
      personalSql.indexOf(`pp.status = '${s}'`),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    // Registrations are reused across seasons, so last season's completed plan
    // must not outrank this season's live subscription.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(personalSql.indexOf(`COUNT(pp.id) > 0 THEN 'inactive'`)).toBeGreaterThan(
      order[order.length - 1],
    );
  });
});

// ─── onRequestDelete ──────────────────────────────────────────────────────────

describe('onRequestDelete', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      deleteReq('/api/my-registrations?registrationId=reg_1', { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not an admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/my-registrations?registrationId=reg_1', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 when X-Club-Slug header is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/my-registrations?registrationId=reg_1'),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when registrationId query param is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('admin deletes a registration and returns ok', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      deleteReq('/api/my-registrations?registrationId=reg_1', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 when registration not found in this club', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ run: { meta: { changes: 0 } } });
    const ctx = makeContext(
      deleteReq('/api/my-registrations?registrationId=reg_missing', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(404);
  });

  function deleteCtx(db: any, id = 'reg_1') {
    return makeContext(
      deleteReq(`/api/my-registrations?registrationId=${id}`, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
  }

  it('refuses to delete a registration with a live GoCardless payment', async () => {
    // Cascades away the only record that GoCardless is still collecting.
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [{ status: 'active' }], run: { meta: { changes: 1 } } });
    const res = await onRequestDelete(deleteCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/live GoCardless payment/i);
  });

  it('refuses to delete a registration that other registrations are billed through', async () => {
    // ON DELETE RESTRICT would otherwise surface as a raw FK violation.
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [null, { n: 2 }], run: { meta: { changes: 1 } } });
    const res = await onRequestDelete(deleteCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/billed for 2 other registrations/i);
    expect(body.mergedCount).toBe(2);
  });

  it('allows deleting a registration that is billed through another one', async () => {
    // A secondary owns no group; its own merge row cascades away with it.
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [null, { n: 0 }], run: { meta: { changes: 1 } } });
    const res = await onRequestDelete(deleteCtx(db) as any);
    expect(res.status).toBe(200);
  });
});

// ─── Merged registrations ─────────────────────────────────────────────────────

describe('naming which read failed (#107)', () => {
  beforeEach(() => {
    mockGetSession.mockResolvedValue(adminSession);
    // Re-armed here because the afterEach below strips it back to a bare vi.fn().
    mockCaptureImmediate.mockResolvedValue(undefined);
    // These tests fail reads on purpose; the handler logs each one by design.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  const get = (db: any) => onRequestGet(makeContext(
    getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
    { env: { DB: db as any } },
  ) as any);

  /** A db whose Nth .all() rejects, the rest succeeding. */
  function failingAllAt(n: number) {
    const db = makeDb({ all: [[], []], batch: [[[]]], first: null });
    let call = 0;
    const realPrepare = db.prepare as any;
    (db as any).prepare = vi.fn((sql: string) => {
      const stmt = realPrepare(sql);
      const bound = stmt.bind();
      const guard = () => {
        call += 1;
        return call === n
          ? Promise.reject(new Error('D1_ERROR: too much'))
          : bound.all();
      };
      return { ...stmt, bind: vi.fn(() => ({ ...bound, all: guard })) };
    });
    return db;
  }

  it('names the personal scan when it is the one that dies', async () => {
    const res = await get(failingAllAt(1));
    const body = await res.json() as any;

    expect(res.status).toBe(500);
    expect(body.read).toBe('personal_scan');
    expect(body.error).toBe('Failed to load registrations');
  });

  it('names the import stamp when it is the one that dies', async () => {
    const db = makeDb({ all: [[], []], batch: [[[]]], first: null });
    const realPrepare = db.prepare as any;
    (db as any).prepare = vi.fn((sql: string) => {
      const stmt = realPrepare(sql);
      if (!/club_import_log/.test(sql)) return stmt;
      return {
        ...stmt,
        bind: vi.fn(() => ({ first: () => Promise.reject(new Error('boom')) })),
      };
    });

    const res = await get(db);
    const body = await res.json() as any;

    expect(res.status).toBe(500);
    expect(body.read).toBe('import_stamp');
  });

  it('logs the failing read rather than swallowing it', async () => {
    await get(failingAllAt(1));

    expect(console.error).toHaveBeenCalledWith('my-registrations read failed', expect.objectContaining({
      read: 'personal_scan',
      clubSlug: 'test-club',
    }));
  });

  it('does not report read cost on a small, fast load', async () => {
    // The endpoint suspected of being killed by a resource limit must not pay
    // for a capture on the healthy path.
    const captured: unknown[] = [];
    const ctx: any = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: makeDb({ all: [[], []], batch: [[[]]], first: null }) as any,
               POSTHOG_API_KEY: 'k', POSTHOG_HOST: 'https://ph.example.com' } },
    );
    ctx.waitUntil = (p: unknown) => captured.push(p);

    const res = await onRequestGet(ctx);

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(0);
    expect(mockCaptureImmediate).not.toHaveBeenCalled();
  });

  it('reports a read that touched a lot of rows even when it was fast', async () => {
    // The whole argument for sampling on rows_read: the club scan this work
    // removed read 7,495 rows in 23ms, so a duration-only threshold would never
    // have recorded it. Passing no rowsRead leaves this endpoint duration-only,
    // which is the blindness the change is meant to remove.
    const captured: unknown[] = [];
    const ctx: any = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: makeDb({
                 all: [[sampleRegistration], []],
                 batch: [[[]]],
                 first: null,
                 allMeta: { rows_read: 7495 },
               }) as any,
               POSTHOG_API_KEY: 'k', POSTHOG_HOST: 'https://ph.example.com' } },
    );
    ctx.waitUntil = (p: unknown) => captured.push(p);

    const res = await onRequestGet(ctx);

    expect(res.status).toBe(200);
    expect(captured).toHaveLength(1);
    expect(mockCaptureImmediate).toHaveBeenCalledWith(expect.objectContaining({
      event: 'registrations read',
      properties: expect.objectContaining({
        endpoint: 'my_registrations',
        rows_read: 7495,
        rows_returned: 1,
      }),
    }));
  });

});

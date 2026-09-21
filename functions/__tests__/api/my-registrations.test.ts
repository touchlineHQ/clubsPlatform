import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, memberSession, getReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
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
    expect(body.club).toBeNull();
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

  it('admin scope: returns both personal and club registrations with scope=admin', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    // .all() is called twice: first for personalRows, then for clubRows
    const db = makeDb({ all: [[sampleRegistration], [clubRegistration]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.scope).toBe('admin');
    expect(Array.isArray(body.personal)).toBe(true);
    expect(Array.isArray(body.club)).toBe(true);
    expect(body.club.length).toBe(1);
    expect(body.club[0].registrationId).toBe('reg_2');
  });

  it('admin scope: attaches who marked a registration as manually paid', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const manualRow = { ...clubRegistration, paymentStatus: 'manual' };
    const db = makeDb({
      all: [
        [sampleRegistration],
        [manualRow],
        // Newest first — reg_2 was re-marked after an undo.
        [
          { registrationId: 'reg_2', manualPaidBy: 'alice@club.com', manualPaidAt: 200, manualNote: 'cash' },
          { registrationId: 'reg_2', manualPaidBy: 'bob@club.com', manualPaidAt: 100, manualNote: 'older' },
        ],
      ],
    });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.club[0].manualPaidBy).toBe('alice@club.com');
    expect(body.club[0].manualPaidAt).toBe(200);
    expect(body.club[0].manualNote).toBe('cash');
  });

  it('admin scope: skips the attribution lookup when no row is manual', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[sampleRegistration], [clubRegistration]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    await onRequestGet(ctx as any);
    // Name the query rather than counting statements — the handler also reads
    // club_import_log for the "last imported" stamp, which is unrelated.
    const sql = (db.prepare as any).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(sql.some((s: string) => /admin_audit_log/.test(s))).toBe(false);
  });

  it('hides the manual override from players but keeps it for admins', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[sampleRegistration], [clubRegistration]] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    await onRequestGet(ctx as any);

    const [personalSql, clubSql] = (db.prepare as any).mock.calls.map((c: unknown[]) => c[0] as string);
    const manualBranch = `WHEN SUM(CASE WHEN pp.status = 'manual' THEN 1 ELSE 0 END) > 0 THEN`;
    // The player sees a manually-paid registration as paid in full, not as one
    // still collecting — 'active' now badges as "Paying".
    expect(personalSql).toContain(`${manualBranch} 'completed'`);
    expect(clubSql).toContain(`${manualBranch} 'manual'`);
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

  it('admin scope: club field is an array even when empty', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[], []] });
    const ctx = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.scope).toBe('admin');
    expect(body.personal).toEqual([]);
    expect(body.club).toEqual([]);
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
    // Deleting cascades the payment row away — the only record that GoCardless
    // is still collecting.
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [{ status: 'active' }], run: { meta: { changes: 1 } } });
    const res = await onRequestDelete(deleteCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/live GoCardless payment/i);
  });

  it('refuses to delete a registration that other registrations are billed through', async () => {
    // registration_merge.primaryRegistrationId is ON DELETE RESTRICT, so this
    // would otherwise surface as a raw FK violation.
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

describe('merged registrations', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  function prepared(db: any) {
    return (db.prepare as any).mock.calls.map((c: unknown[]) => String(c[0]));
  }

  it('reads payment status from the billing registration, so a secondary shows the group‘s', async () => {
    const db = makeDb({ all: [[sampleRegistration]] });
    await onRequestGet(makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    ) as any);

    const withStatus = prepared(db).find((sql: string) => sql.includes('AS paymentStatus'));
    expect(withStatus).toBeDefined();
    // Not `pp.registrationId = pr.id` — that would report a secondary unpaid
    // and re-offer it the mandate flow.
    expect(withStatus).toContain('registration_merge');
    expect(withStatus).not.toMatch(/pp\.registrationId = pr\.id/);
  });

  it('returns the columns the UI needs to show a group', async () => {
    const db = makeDb({ all: [[sampleRegistration]] });
    await onRequestGet(makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    ) as any);

    const query = prepared(db).find((sql: string) => sql.includes('AS billingRegistrationId'));
    expect(query).toContain('AS billedWithTeamName');
    expect(query).toContain('AS mergedTeamNames');
  });

  it('resolves manual attribution through the primary', async () => {
    // The manual row hangs off the group's primary, so a secondary would
    // otherwise show "Paid in full" with nobody's name against it.
    const secondary = { ...clubRegistration, registrationId: 'reg_sec', paymentStatus: 'manual' };
    const db = makeDb({
      all: [
        [sampleRegistration],
        [secondary],
        // attachManualAttribution: the audit lookup, then the merge map.
        [{
          registrationId: 'reg_primary',
          manualPaidBy: 'admin@example.com',
          manualPaidAt: 1,
          manualNote: 'cash',
        }],
        [{ registrationId: 'reg_sec', primaryRegistrationId: 'reg_primary' }],
      ],
    });

    const res = await onRequestGet(makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    ) as any);
    const body = await res.json() as any;

    expect(body.club[0].manualPaidBy).toBe('admin@example.com');
    expect(body.club[0].manualNote).toBe('cash');
  });
});

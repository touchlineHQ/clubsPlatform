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
      all: [[sampleRegistration], [manualRow]],
      // The attribution lookup is chunked, so it goes through batch() now.
      batch: [[
        // Newest first — reg_2 was re-marked after an undo.
        [
          { registrationId: 'reg_2', manualPaidBy: 'alice@club.com', manualPaidAt: 200, manualNote: 'cash' },
          { registrationId: 'reg_2', manualPaidBy: 'bob@club.com', manualPaidAt: 100, manualNote: 'older' },
        ],
      ]],
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

  it('names the club scan when it is the one that dies', async () => {
    const res = await get(failingAllAt(2));
    const body = await res.json() as any;

    expect(res.status).toBe(500);
    expect(body.read).toBe('club_scan');
  });

  it('names the audit read when it is the one that dies', async () => {
    // Reached only when a row is manual, and it goes through db.batch() rather
    // than .all(), so failingAllAt cannot get near it.
    const db = makeDb({
      all: [[], [{ ...clubRegistration, paymentStatus: 'manual' }]],
      batch: [[[]]],
      first: null,
    });
    (db as any).batch = vi.fn(() => Promise.reject(new Error('D1_ERROR: too much')));

    const res = await get(db);
    const body = await res.json() as any;

    expect(res.status).toBe(500);
    expect(body.read).toBe('audit_read');
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
    await get(failingAllAt(2));

    expect(console.error).toHaveBeenCalledWith('my-registrations read failed', expect.objectContaining({
      read: 'club_scan',
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

  it('reports read cost for a large club', async () => {
    const captured: unknown[] = [];
    const club = Array.from({ length: 1000 }, (_, i) => ({ ...clubRegistration, registrationId: `r${i}` }));
    const ctx: any = makeContext(
      getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: makeDb({ all: [[], club], batch: [[[]]], first: null }) as any,
               POSTHOG_API_KEY: 'k', POSTHOG_HOST: 'https://ph.example.com' } },
    );
    ctx.waitUntil = (p: unknown) => captured.push(p);

    await onRequestGet(ctx);

    // Off the response path, so it cannot add latency to the slow case.
    expect(captured).toHaveLength(1);
    expect(mockCaptureImmediate).toHaveBeenCalledWith(expect.objectContaining({
      event: 'registrations read',
      groups: { club: 'test-club' },
      properties: expect.objectContaining({
        club_slug: 'test-club',
        scope: 'admin',
        club_rows: 1000,
        personal_rows: 0,
      }),
    }));

    // Counts and durations only — a FAN number here would put personal data in
    // PostHog, which is the guardrail #94 set for the status report.
    const [payload] = mockCaptureImmediate.mock.calls[0];
    expect(JSON.stringify(payload)).not.toMatch(/fan_/i);
  });
});

describe('merged registrations', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  /**
   * A row as the SQL now hands it back. The merge is resolved in the query, so
   * these three columns arrive on the row rather than being overlaid in JS from
   * a separate whole-club read of registration_merge.
   */
  const merged = (over: Record<string, unknown>) => ({ ...clubRegistration, ...over });

  /**
   * The admin read order: personal rows, club rows, then the import stamp via
   * .first(). Manual attribution now goes through db.batch(), not .all().
   */
  function adminDb(over: {
    personal?: unknown[];
    club?: unknown[];
    audit?: unknown[];
  } = {}) {
    return makeDb({
      all: [over.personal ?? [], over.club ?? []],
      batch: [[over.audit ?? []]],
      first: null,
    });
  }

  const get = (db: any) => onRequestGet(makeContext(
    getReq('/api/my-registrations', { 'X-Club-Slug': 'test-club' }),
    { env: { DB: db as any } },
  ) as any);

  const sqlOf = (db: any) => (db.prepare as any).mock.calls.map((c: unknown[]) => String(c[0]));

  // ─── The regression the SQL resolution exists to prevent ────────────────────

  it('keys the payment status on the billing registration, not the row', async () => {
    // THE load-bearing assertion in this file.
    //
    // Keyed on pr.id, a secondary's status was corrected in JS by copying its
    // primary's — which only worked while every primary was guaranteed to be
    // loaded alongside it. Paginate the read and the primary is frequently on
    // another page, so the overlay silently leaves the secondary reading
    // "Outstanding" and a player gets chased for money already paid.
    //
    // The D1 double cannot execute SQL, so this asserts the query is SHAPED to
    // resolve the group rather than that it RETURNS the resolved rows. That is
    // the strongest guarantee available here; an executable SQLite harness is
    // what would close the gap.
    const db = adminDb({ club: [clubRegistration] });
    await get(db);

    for (const sql of sqlOf(db).filter((q: string) => q.includes('AS paymentStatus'))) {
      expect(sql).toMatch(/pp\.registrationId = COALESCE\(\s*rm0\."primaryRegistrationId"/);
      expect(sql).not.toMatch(/pp\.registrationId = pr\.id/);
    }
  });

  it('resolves the merge for the personal query too, not just the club one', async () => {
    // Dropping the JS pass without doing this would leave the personal tab with
    // no merge resolution at all.
    const db = adminDb({ personal: [sampleRegistration], club: [clubRegistration] });
    await get(db);

    const withStatus = sqlOf(db).filter((q: string) => q.includes('AS paymentStatus'));
    expect(withStatus).toHaveLength(2);
    for (const sql of withStatus) {
      expect(sql).toContain('billingRegistrationId');
      expect(sql).toContain('mergedTeamNames');
    }
  });

  it('scopes the merge join by club', async () => {
    // registration_merge is keyed on registrationId alone. A cross-club row —
    // which the API prevents but the schema permits — would otherwise pull
    // another club's team name onto the page.
    const db = adminDb({ club: [clubRegistration] });
    await get(db);

    for (const sql of sqlOf(db).filter((q: string) => q.includes('rm0'))) {
      expect(sql).toMatch(/rm0\."clubSlug"\s*=\s*pr\."clubSlug"/);
    }
  });

  it('joins to the billing row with LEFT, never INNER', async () => {
    // An inner join would DELETE the registration from the result if the
    // primary ever went missing. Hiding rows from the admin list is far worse
    // than showing a blank badge.
    const db = adminDb({ club: [clubRegistration] });
    await get(db);

    for (const sql of sqlOf(db).filter((q: string) => q.includes('rm0'))) {
      expect(sql).toMatch(/LEFT JOIN "registration_merge" rm0/);
      expect(sql).toMatch(/LEFT JOIN "player_registration" bpr/);
    }
  });

  it('never reads the club‘s whole registration_merge table', async () => {
    // The read this ticket exists to remove. Every remaining reference to
    // registration_merge is correlated to a registration, not a club scan.
    const db = adminDb({ club: [clubRegistration] });
    await get(db);

    for (const sql of sqlOf(db).filter((q: string) => /registration_merge/.test(q))) {
      expect(sql).not.toMatch(/FROM "registration_merge" rm\s+JOIN/);
    }
  });

  it('names a primary‘s siblings deterministically', async () => {
    // GROUP_CONCAT over a join has no defined argument order, so the same row
    // could list its teams differently on consecutive requests — which reads as
    // the text flickering between pages.
    const db = adminDb({ club: [clubRegistration] });
    await get(db);

    const sql = sqlOf(db).find((q: string) => q.includes('mergedTeamNames'));
    expect(sql).toMatch(/ORDER BY mpr\."teamName" COLLATE NOCASE/);
    expect(sql).toMatch(/rm2\."primaryRegistrationId" = pr\."id"/);
  });

  // ─── The wire contract ──────────────────────────────────────────────────────

  it('passes the SQL-resolved merge fields straight through', async () => {
    const primary = merged({
      registrationId: 'reg_tue', teamName: 'U15 Tuesday', paymentStatus: 'active',
      billingRegistrationId: null, billedWithTeamName: null,
      mergedTeamNames: 'U15 Thursday',
    });
    const secondary = merged({
      registrationId: 'reg_thu', teamName: 'U15 Thursday', paymentStatus: 'active',
      billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday',
      mergedTeamNames: null,
    });

    const body = await (await get(adminDb({ club: [primary, secondary] }))).json() as any;

    const [p, sec] = body.club;
    expect(sec.paymentStatus).toBe('active');
    expect(sec.billingRegistrationId).toBe('reg_tue');
    expect(sec.billedWithTeamName).toBe('U15 Tuesday');
    expect(p.mergedTeamNames).toBe('U15 Thursday');
  });

  it('sends no merge fields at all when the club has merged nothing', async () => {
    // Which is every club today. SQL returns NULL for all three on an unmerged
    // row; sending three null keys per row would be response weight for nothing
    // and would break the shape the page was built against.
    const unmerged = merged({
      billingRegistrationId: null, billedWithTeamName: null, mergedTeamNames: null,
    });
    const body = await (await get(adminDb({ club: [unmerged] }))).json() as any;

    expect(body.club[0]).not.toHaveProperty('billingRegistrationId');
    expect(body.club[0]).not.toHaveProperty('billedWithTeamName');
    expect(body.club[0]).not.toHaveProperty('mergedTeamNames');
  });

  it('keeps the merge fields on a row that is in a group', async () => {
    const body = await (await get(adminDb({
      club: [merged({
        billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday',
        mergedTeamNames: null,
      })],
    }))).json() as any;

    expect(body.club[0].billingRegistrationId).toBe('reg_tue');
    expect(body.club[0].billedWithTeamName).toBe('U15 Tuesday');
  });

  // ─── Manual attribution ─────────────────────────────────────────────────────

  it('asks for manual attribution by billing id, bound not interpolated', async () => {
    const secondary = merged({
      registrationId: 'reg_thu', teamName: 'U15 Thursday', paymentStatus: 'manual',
      billingRegistrationId: 'reg_tue', billedWithTeamName: 'U15 Tuesday',
    });
    const db = adminDb({
      club: [secondary],
      audit: [{ registrationId: 'reg_tue', manualPaidBy: 'admin@example.com', manualPaidAt: 1, manualNote: 'cash' }],
    });
    const body = await (await get(db)).json() as any;

    // The override hangs off the primary, so a secondary would otherwise show
    // "Paid in full" with nobody's name against it.
    expect(body.club[0].manualPaidBy).toBe('admin@example.com');
    expect(body.club[0].manualNote).toBe('cash');

    const idx = sqlOf(db).findIndex((q: string) => /admin_audit_log/.test(q));
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(sqlOf(db)[idx]).toContain('pp.registrationId IN (?)');
    expect(sqlOf(db)[idx]).not.toContain('reg_tue');
    expect((db.prepare as any).mock.results[idx].value.bind.mock.calls[0])
      .toEqual(['test-club', 'reg_tue']);
  });

  it('bounds the attribution lookup by id rather than scanning the club', async () => {
    // The unbounded form filtered only on clubSlug/targetTable/action, so it
    // degraded with admin activity rather than data volume.
    const db = adminDb({
      club: [merged({ paymentStatus: 'manual' })],
      audit: [],
    });
    await get(db);

    const sql = sqlOf(db).find((q: string) => /admin_audit_log/.test(q))!;
    expect(sql).toMatch(/pp\.registrationId IN \(/);
  });

  it('chunks the id list so a full page cannot breach D1‘s bind cap', async () => {
    // D1 caps a query at 100 bound parameters, which is why MAX_MERGE_GROUP is
    // 11. A 200-row page of distinct manual billing ids would be 201 bindings.
    const club = Array.from({ length: 200 }, (_, i) => merged({
      registrationId: `reg_${i}`, paymentStatus: 'manual',
      billingRegistrationId: null, billedWithTeamName: null, mergedTeamNames: null,
    }));
    const db = adminDb({ club, audit: [] });
    await get(db);

    const auditIdxs = sqlOf(db)
      .map((q: string, i: number) => (/admin_audit_log/.test(q) ? i : -1))
      .filter((i: number) => i >= 0);

    expect(auditIdxs.length).toBe(3); // 200 ids at 80 per statement
    for (const i of auditIdxs) {
      const binds = (db.prepare as any).mock.results[i].value.bind.mock.calls[0];
      expect(binds.length).toBeLessThanOrEqual(100);
    }
    // One round trip, not three.
    expect((db.batch as any).mock.calls).toHaveLength(1);
    expect((db.batch as any).mock.calls[0][0]).toHaveLength(3);
  });

  it('skips the lookup entirely when no row is manual', async () => {
    const db = adminDb({ club: [merged({ paymentStatus: 'active' })] });
    await get(db);

    expect(sqlOf(db).some((q: string) => /admin_audit_log/.test(q))).toBe(false);
    expect((db.batch as any).mock.calls).toHaveLength(0);
  });
});

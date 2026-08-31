import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mock } from 'vitest';
import {
  makeContext, makeDb, adminSession, managerSession, memberSession,
  postReq, deleteReq,
} from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/audit-log', () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { onRequestPost, onRequestDelete } from '../../api/admin/manual-payment';
import { writeAuditLog } from '../../lib/audit-log';

const REGISTRATION = { registrationId: 'reg_1', teamName: 'U11 Lions', fanId: 'fan_001' };
/** Team name uppercased with spaces stripped — mirrors lib/gocardless-link.ts. */
const MANUAL_REFERENCE = 'MANUAL-U11LIONS-fan_001-SUBS';

/** Every prepare() call paired with the bindings it was given. */
function prepared(db: any): { sql: string; bindings: unknown[] }[] {
  const prepare = db.prepare as Mock;
  return prepare.mock.calls.map((call: unknown[], i: number) => ({
    sql: call[0] as string,
    bindings: prepare.mock.results[i].value.bind.mock.calls[0] ?? [],
  }));
}

function findSql(db: any, fragment: string) {
  return prepared(db).find(p => p.sql.includes(fragment));
}

function markPaidCtx(db: any, body: unknown = { registrationId: 'reg_1' }, headers = { 'X-Club-Slug': 'test-club' }) {
  return makeContext(postReq('/api/admin/manual-payment', body, headers), { env: { DB: db as any } });
}

beforeEach(() => vi.clearAllMocks());

// ─── Authorisation ────────────────────────────────────────────────────────────

describe('onRequestPost — authorisation', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await onRequestPost(markPaidCtx(makeDb()) as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a member', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const res = await onRequestPost(markPaidCtx(makeDb()) as any);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a team manager — overrides are admin-only', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const res = await onRequestPost(markPaidCtx(makeDb()) as any);
    expect(res.status).toBe(403);
  });

  it('returns 403 for an admin acting on another club in multi-club mode', async () => {
    mockGetSession.mockResolvedValue(adminSession); // clubSlug: 'test-club'
    const db = makeDb({ first: [REGISTRATION, null, null] });
    const ctx = makeContext(
      postReq('/api/admin/manual-payment', { registrationId: 'reg_1' }, { 'X-Club-Slug': 'other-club' }),
      { env: { DB: db as any, MULTI_CLUB: '1' } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(403);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('onRequestPost — validation', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 400 without a registrationId', async () => {
    const res = await onRequestPost(markPaidCtx(makeDb(), {}) as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 without an X-Club-Slug header', async () => {
    const ctx = makeContext(
      postReq('/api/admin/manual-payment', { registrationId: 'reg_1' }),
      { env: { DB: makeDb() as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 for a registration that is not in this club', async () => {
    const db = makeDb({ first: [null] });
    const res = await onRequestPost(markPaidCtx(db) as any);
    expect(res.status).toBe(404);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ─── The live-GoCardless rule ─────────────────────────────────────────────────

describe('onRequestPost — refuses to override a live GoCardless payment', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 409 when an active subscription exists', async () => {
    const db = makeDb({ first: [REGISTRATION, { id: 'pay_1', status: 'active' }] });
    const res = await onRequestPost(markPaidCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/live GoCardless payment/);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when only a mandate exists', async () => {
    const db = makeDb({ first: [REGISTRATION, { id: 'pay_1', status: 'mandate_only' }] });
    const res = await onRequestPost(markPaidCtx(db) as any);
    expect(res.status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when the plan already collected in full', async () => {
    const db = makeDb({ first: [REGISTRATION, { id: 'pay_1', status: 'completed' }] });
    const res = await onRequestPost(markPaidCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already been paid in full/);
    expect(body.status).toBe('completed');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('scopes the guard to rows with a real mandate, so cancelled ones do not block', async () => {
    const db = makeDb({ first: [REGISTRATION, null, null] });
    await onRequestPost(markPaidCtx(db) as any);

    const guard = findSql(db, `mandateId != ''`);
    expect(guard).toBeDefined();
    expect(guard!.sql).toContain('status IN');
    expect(guard!.bindings).toEqual([
      'reg_1', 'test-club', 'active', 'mandate_only', 'completed',
    ]);
  });
});

// ─── Marking as paid ──────────────────────────────────────────────────────────

describe('onRequestPost — marking as paid', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('inserts a manual row with no mandate and a MANUAL- reference', async () => {
    const db = makeDb({ first: [REGISTRATION, null, null] });
    const res = await onRequestPost(markPaidCtx(db, { registrationId: 'reg_1', note: ' cash at training ' }) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const insert = findSql(db, 'INSERT INTO "player_payment"');
    expect(insert).toBeDefined();
    // An empty mandateId keeps the GoCardless webhook, which matches on
    // mandateId, from ever touching this row.
    expect(insert!.sql).toContain(`'', NULL, 'manual'`);
    expect(insert!.bindings[1]).toBe('test-club');
    expect(insert!.bindings[2]).toBe('reg_1');
    expect(insert!.bindings[3]).toBe(MANUAL_REFERENCE);
  });

  it('records the acting admin in the audit log, with the note trimmed', async () => {
    const db = makeDb({ first: [REGISTRATION, null, null] });
    const res = await onRequestPost(markPaidCtx(db, { registrationId: 'reg_1', note: ' cash at training ' }) as any);
    const body = await res.json() as any;

    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), {
      clubSlug: 'test-club',
      adminId: 'user_1',
      action: 'manual_paid',
      targetTable: 'player_payment',
      targetId: body.paymentId,
      oldStatus: null,
      newStatus: 'manual',
      note: 'cash at training',
    });
  });

  it('stores a null note when none is given', async () => {
    const db = makeDb({ first: [REGISTRATION, null, null] });
    await onRequestPost(markPaidCtx(db, { registrationId: 'reg_1', note: '   ' }) as any);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ note: null }),
    );
  });

  it('reuses the existing MANUAL row when re-marking after an undo', async () => {
    const db = makeDb({
      first: [REGISTRATION, null, { id: 'pay_old', status: 'inactive' }],
    });
    const res = await onRequestPost(markPaidCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.paymentId).toBe('pay_old');
    const lookup = findSql(db, 'AND registrationId = ?');
    expect(lookup).toBeDefined();
    expect(lookup!.bindings).toEqual(['test-club', 'reg_1']);
    expect(findSql(db, 'INSERT INTO "player_payment"')).toBeUndefined();
    const update = findSql(db, `SET reference = ?, status = 'manual'`);
    expect(update).toBeDefined();
    expect(update!.bindings[0]).toBe(MANUAL_REFERENCE);
    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ targetId: 'pay_old', oldStatus: 'inactive', newStatus: 'manual' }),
    );
  });

  it('never reuses a spent GoCardless row — it would keep a mandateId the webhook matches on', async () => {
    // A cancelled mandate passes the live guard above and stays on the
    // registration. Reusing that row would leave its mandateId in place, and
    // the mandate webhook's `WHERE mandateId = ?` would flip the override off.
    const db = makeDb({ first: [REGISTRATION, null, null] });
    await onRequestPost(markPaidCtx(db) as any);

    const lookup = findSql(db, 'AND registrationId = ?');
    expect(lookup!.sql).toContain(`mandateId = ''`);
    expect(findSql(db, 'INSERT INTO "player_payment"')).toBeDefined();
  });

  it('returns 409, not 500, when a concurrent request inserts the manual row first', async () => {
    // The insert is ON CONFLICT DO NOTHING, so losing the race changes no rows
    // rather than breaking UNIQUE(clubSlug, reference).
    const db = makeDb({ first: [REGISTRATION, null, null], run: { meta: { changes: 0 } } });
    const res = await onRequestPost(markPaidCtx(db) as any);

    expect(res.status).toBe(409);
    expect(findSql(db, 'INSERT INTO "player_payment"')!.sql).toContain('ON CONFLICT');
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when a concurrent request re-marks the reusable row first', async () => {
    const db = makeDb({
      first: [REGISTRATION, null, { id: 'pay_old', status: 'inactive' }],
      run: { meta: { changes: 0 } },
    });
    const res = await onRequestPost(markPaidCtx(db) as any);

    expect(res.status).toBe(409);
    // Conditional on the row still not being manual, so the loser writes nothing.
    expect(findSql(db, `SET reference = ?`)!.sql).toContain(`status != 'manual'`);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('returns 409 when the registration is already marked as paid', async () => {
    const db = makeDb({
      first: [REGISTRATION, null, { id: 'pay_1', status: 'manual' }],
    });
    const res = await onRequestPost(markPaidCtx(db) as any);
    expect(res.status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

// ─── Undoing ──────────────────────────────────────────────────────────────────

describe('onRequestDelete', () => {
  const undoCtx = (db: any, path = '/api/admin/manual-payment?registrationId=reg_1') =>
    makeContext(deleteReq(path, { 'X-Club-Slug': 'test-club' }), { env: { DB: db as any } });

  it('returns 403 for a member', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const res = await onRequestDelete(undoCtx(makeDb()) as any);
    expect(res.status).toBe(403);
  });

  it('returns 400 without a registrationId', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const res = await onRequestDelete(undoCtx(makeDb(), '/api/admin/manual-payment') as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 without an X-Club-Slug header', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const ctx = makeContext(
      deleteReq('/api/admin/manual-payment?registrationId=reg_1'),
      { env: { DB: makeDb() as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when there is no manual override to remove', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const res = await onRequestDelete(undoCtx(makeDb({ first: [null] })) as any);
    expect(res.status).toBe(404);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('deactivates the manual row and audits who removed it', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [{ id: 'pay_1' }] });
    const res = await onRequestDelete(undoCtx(db) as any);

    expect(res.status).toBe(200);
    expect(findSql(db, `SET status = 'inactive'`)).toBeDefined();
    expect(writeAuditLog).toHaveBeenCalledWith(expect.anything(), {
      clubSlug: 'test-club',
      adminId: 'user_1',
      action: 'manual_paid_removed',
      targetTable: 'player_payment',
      targetId: 'pay_1',
      oldStatus: 'manual',
      newStatus: 'inactive',
    });
  });

  it('only ever selects manual rows, so a GoCardless payment cannot be deactivated here', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: [{ id: 'pay_1' }] });
    await onRequestDelete(undoCtx(db) as any);

    const lookup = findSql(db, 'SELECT id FROM "player_payment"');
    expect(lookup!.sql).toContain(`status = 'manual'`);
    expect(lookup!.bindings).toEqual(['reg_1', 'test-club']);
  });
});

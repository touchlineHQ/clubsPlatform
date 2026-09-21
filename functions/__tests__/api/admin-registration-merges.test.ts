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

vi.mock('../../lib/audit-log', () => ({
  prepareAuditLog: vi.fn(() => ({ __audit: true })),
}));

import { onRequestPost, onRequestDelete } from '../../api/admin/registration-merges';
import { prepareAuditLog } from '../../lib/audit-log';

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

/** A registration as the endpoint's loader returns it. */
function reg(over: Record<string, unknown> = {}) {
  return {
    registrationId: 'reg_primary',
    clubSlug: 'test-club',
    playerId: 'player_1',
    teamName: 'U15 Tuesday',
    createdAt: 1,
    levelId: 'level_1',
    primaryRegistrationId: null,
    ...over,
  };
}

const PRIMARY = reg();
const SECONDARY = reg({ registrationId: 'reg_secondary', teamName: 'U15 Thursday' });

const DEFAULT_BODY = {
  primaryRegistrationId: 'reg_primary',
  registrationIds: ['reg_secondary'],
};

function mergeCtx(db: any, body: unknown = DEFAULT_BODY, headers = { 'X-Club-Slug': 'test-club' }) {
  return makeContext(
    postReq('/api/admin/registration-merges', body, headers),
    { env: { DB: db as any } },
  );
}

function unmergeCtx(db: any, query = '?primaryRegistrationId=reg_primary') {
  return makeContext(
    deleteReq(`/api/admin/registration-merges${query}`, { 'X-Club-Slug': 'test-club' }),
    { env: { DB: db as any } },
  );
}

/** POST's read sequence: named registrations, their payments, then the nesting check. */
function postDb(over: { registrations?: unknown[]; payments?: unknown[]; nested?: unknown[] } = {}) {
  return makeDb({
    all: [
      over.registrations ?? [PRIMARY, SECONDARY],
      over.payments ?? [],
      over.nested ?? [],
    ],
  });
}

beforeEach(() => vi.clearAllMocks());

// ─── Authorisation ────────────────────────────────────────────────────────────

describe('onRequestPost — authorisation', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await onRequestPost(mergeCtx(postDb()) as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a member', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const res = await onRequestPost(mergeCtx(postDb()) as any);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a team manager — merging is admin-only', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const res = await onRequestPost(mergeCtx(postDb()) as any);
    expect(res.status).toBe(403);
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

describe('onRequestPost — validation', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 400 without a primaryRegistrationId', async () => {
    const res = await onRequestPost(
      mergeCtx(postDb(), { registrationIds: ['reg_secondary'] }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when no other registration is named', async () => {
    const res = await onRequestPost(
      mergeCtx(postDb(), { primaryRegistrationId: 'reg_primary', registrationIds: [] }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when the only member named is the primary itself', async () => {
    // A group of one is just an unmerged registration — there is nothing to write.
    const res = await onRequestPost(
      mergeCtx(postDb(), {
        primaryRegistrationId: 'reg_primary',
        registrationIds: ['reg_primary'],
      }) as any,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 without an X-Club-Slug header', async () => {
    const res = await onRequestPost(mergeCtx(postDb(), DEFAULT_BODY, {}) as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when a named registration is not in this club', async () => {
    // The loader is scoped to clubSlug, so a foreign id simply does not come back.
    const res = await onRequestPost(
      mergeCtx(postDb({ registrations: [PRIMARY] })) as any,
    );
    expect(res.status).toBe(404);
  });

  it('scopes the registration lookup to the club, so grouping cannot span clubs', async () => {
    const db = postDb();
    await onRequestPost(mergeCtx(db) as any);

    const load = findSql(db, 'AS registrationId');
    expect(load!.bindings).toContain('test-club');
  });
});

// ─── Invariant: one player ────────────────────────────────────────────────────

describe('onRequestPost — one player per group', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 409 when a member belongs to a different player', async () => {
    const otherPlayer = reg({
      registrationId: 'reg_secondary',
      teamName: 'U15 Thursday',
      playerId: 'player_2',
    });
    const res = await onRequestPost(
      mergeCtx(postDb({ registrations: [PRIMARY, otherPlayer] })) as any,
    );
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/different player/i);
    expect(prepareAuditLog).not.toHaveBeenCalled();
  });
});

// ─── Invariant: the primary must be billable ──────────────────────────────────

describe('onRequestPost — the primary carries the price', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 409 when the primary has no subscription level', async () => {
    // A primary with no level renders a dead card for a payable player.
    const res = await onRequestPost(
      mergeCtx(postDb({ registrations: [reg({ levelId: null }), SECONDARY] })) as any,
    );
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/no subscription level/i);
  });

  it('allows a secondary with no level — the group pays the primary‘s price', async () => {
    const res = await onRequestPost(
      mergeCtx(postDb({
        registrations: [PRIMARY, reg({ registrationId: 'reg_secondary', levelId: null })],
      })) as any,
    );
    expect(res.status).toBe(200);
  });
});

// ─── Invariant: payments stay with the primary ────────────────────────────────

describe('onRequestPost — a secondary may not hold a live payment', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it.each([
    ['active', /GoCardless/i],
    ['mandate_only', /GoCardless/i],
    ['completed', /GoCardless/i],
    ['manual', /manually paid/i],
  ])('returns 409 when a secondary holds a %s payment', async (status, message) => {
    const res = await onRequestPost(
      mergeCtx(postDb({
        payments: [{ registrationId: 'reg_secondary', status, mandateId: 'MND-1' }],
      })) as any,
    );
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(message);
    expect(body.conflictingRegistrationId).toBe('reg_secondary');
    expect(prepareAuditLog).not.toHaveBeenCalled();
  });

  it('allows the merge when the secondary‘s only row is inactive', async () => {
    // Abandoned setups are common and a dead row collects nothing.
    const res = await onRequestPost(
      mergeCtx(postDb({
        payments: [{ registrationId: 'reg_secondary', status: 'inactive', mandateId: 'MND-1' }],
      })) as any,
    );
    expect(res.status).toBe(200);
  });

  it('allows the merge when the PRIMARY holds the payment', async () => {
    // The point of the feature: paying through one team covers the group.
    const res = await onRequestPost(
      mergeCtx(postDb({
        payments: [{ registrationId: 'reg_primary', status: 'active', mandateId: 'MND-1' }],
      })) as any,
    );
    expect(res.status).toBe(200);
  });
});

// ─── Invariant: no chains ─────────────────────────────────────────────────────

describe('onRequestPost — no chains', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 409 when the proposed primary is itself a secondary', async () => {
    // COALESCE resolves one hop, so a chain splits a group's money from it.
    const res = await onRequestPost(
      mergeCtx(postDb({
        registrations: [reg({ primaryRegistrationId: 'reg_elsewhere' }), SECONDARY],
      })) as any,
    );
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already billed through/i);
  });

  it('returns 409 when a named member is already another group‘s primary', async () => {
    const res = await onRequestPost(
      mergeCtx(postDb({ nested: [{ primaryRegistrationId: 'reg_secondary' }] })) as any,
    );
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already the registration another group/i);
  });
});

// ─── Writing the group ────────────────────────────────────────────────────────

describe('onRequestPost — writing the group', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('writes a merge row pointing the secondary at the primary', async () => {
    const db = postDb();
    const res = await onRequestPost(mergeCtx(db) as any);

    expect(res.status).toBe(200);
    const insert = findSql(db, 'INSERT INTO "registration_merge"');
    expect(insert).toBeDefined();
    expect(insert!.bindings.slice(0, 3)).toEqual(['test-club', 'reg_secondary', 'reg_primary']);
  });

  it('re-asserts every guard in the write itself, not just in the reads', async () => {
    // Pre-reads cannot close the two-admin or mid-merge-payment windows.
    const db = postDb();
    await onRequestPost(mergeCtx(db) as any);

    const insert = findSql(db, 'INSERT INTO "registration_merge"');
    expect(insert!.sql).toContain('NOT EXISTS');
    expect(insert!.sql).toContain('player_payment');
    expect(insert!.sql).toContain(`"status" <> 'inactive'`);
  });

  it('writes the audit row in the same batch as the merge', async () => {
    // An audited merge that does not exist must not be reachable.
    const db = postDb();
    await onRequestPost(mergeCtx(db) as any);

    expect(prepareAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clubSlug: 'test-club',
        adminId: 'user_1',
        action: 'registrations_merged',
        targetTable: 'player_registration',
        targetId: 'reg_primary',
      }),
    );
    const batched = (db.batch as Mock).mock.calls[0][0];
    expect(batched).toContainEqual({ __audit: true });
  });

  it('names the merged teams in the audit note', async () => {
    await onRequestPost(mergeCtx(postDb()) as any);
    expect(prepareAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ note: 'Billed with: U15 Thursday' }),
    );
  });

  it('returns 409 and rolls back when a guard fails under a concurrent change', async () => {
    const db = makeDb({
      all: [[PRIMARY, SECONDARY], [], []],
      // meta.changes 0 on the merge write: a guard did not hold.
      run: { meta: { changes: 0 } },
    });
    const res = await onRequestPost(mergeCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.conflictingRegistrationIds).toEqual(['reg_secondary']);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('onRequestDelete', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await onRequestDelete(unmergeCtx(makeDb()) as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 without a primaryRegistrationId', async () => {
    const res = await onRequestDelete(unmergeCtx(makeDb(), '') as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the primary has no merged registrations', async () => {
    const db = makeDb({ first: null, all: [[]] });
    const res = await onRequestDelete(unmergeCtx(db) as any);
    expect(res.status).toBe(404);
  });

  it('refuses while the group holds a live GoCardless payment', async () => {
    // Dissolving would re-offer the mandate flow while it is still collecting.
    const db = makeDb({ first: { status: 'active' } });
    const res = await onRequestDelete(unmergeCtx(db) as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/pay again/i);
    expect(prepareAuditLog).not.toHaveBeenCalled();
  });

  it('scopes the live-payment guard to rows with a real mandate', async () => {
    const db = makeDb({ first: null, all: [[{ registrationId: 'reg_secondary', teamName: 'U15 Thursday' }]] });
    await onRequestDelete(unmergeCtx(db) as any);

    const guard = findSql(db, `mandateId != ''`);
    expect(guard).toBeDefined();
  });

  it('dissolves the group and audits it', async () => {
    const db = makeDb({
      first: null,
      all: [[{ registrationId: 'reg_secondary', teamName: 'U15 Thursday' }]],
    });
    const res = await onRequestDelete(unmergeCtx(db) as any);

    expect(res.status).toBe(200);
    const del = findSql(db, 'DELETE FROM "registration_merge"');
    expect(del!.bindings).toEqual(['reg_primary', 'test-club']);
    expect(prepareAuditLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'registrations_unmerged',
        targetId: 'reg_primary',
        note: 'Unmerged: U15 Thursday',
      }),
    );
  });

  it('unmerges freely when the only payment is a manual override', async () => {
    // A manual row collects nothing, so there is no second charge to cause.
    const db = makeDb({
      first: null,
      all: [[{ registrationId: 'reg_secondary', teamName: 'U15 Thursday' }]],
    });
    const res = await onRequestDelete(unmergeCtx(db) as any);
    expect(res.status).toBe(200);
  });
});

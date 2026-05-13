import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

// ─── admin/users ──────────────────────────────────────────────────────────────

import { onRequestGet, onRequestPatch } from '../../api/admin/users';

describe('GET /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns list of users', async () => {
    const userRows = [{ id: 'u1', name: 'Alice', email: 'a@b.com', role: 'member', createdAt: 1000 }];
    const ctx = makeContext(getReq('/api/admin/users'), {
      env: { DB: makeDb({ all: [userRows] }) as any },
    });

    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.users)).toBe(true);
    expect(body.users[0].name).toBe('Alice');
    expect(body.users[0].email).toBe('a@b.com');
    expect(body.users[0].role).toBe('member');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(getReq('/api/admin/users'), {
      env: { DB: makeDb() as any },
    });

    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('updates user role and returns ok', async () => {
    const ctx = makeContext(
      patchReq('/api/admin/users', { userId: 'u1', role: 'manager' }),
      { env: { DB: makeDb({ run: { meta: { changes: 1 } } }) as any } },
    );

    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when userId is missing', async () => {
    const ctx = makeContext(
      patchReq('/api/admin/users', { role: 'manager' }),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/userId/);
  });

  it('returns 400 when role is invalid', async () => {
    const ctx = makeContext(
      patchReq('/api/admin/users', { userId: 'u1', role: 'superuser' }),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/role/i);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      patchReq('/api/admin/users', { userId: 'u1', role: 'manager' }),
      { env: { DB: makeDb() as any } },
    );

    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── admin/user-team-roles ────────────────────────────────────────────────────

import {
  onRequestGet as utrGet,
  onRequestPost as utrPost,
  onRequestDelete as utrDelete,
} from '../../api/admin/user-team-roles';

describe('GET /api/admin/user-team-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns assignments array', async () => {
    const teamRoleRows = [
      {
        id: 'utr_1',
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
        createdAt: 1000,
        userName: 'Alice',
        userEmail: 'a@b.com',
      },
    ];
    const ctx = makeContext(getReq('/api/admin/user-team-roles'), {
      env: { DB: makeDb({ all: [teamRoleRows] }) as any },
    });

    const res = await utrGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.assignments)).toBe(true);
    expect(body.assignments[0].id).toBe('utr_1');
    expect(body.assignments[0].userName).toBe('Alice');
  });

  it('returns empty assignments array when none exist', async () => {
    const ctx = makeContext(getReq('/api/admin/user-team-roles'), {
      env: { DB: makeDb({ all: [[]] }) as any },
    });

    const res = await utrGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(Array.isArray(body.assignments)).toBe(true);
    expect(body.assignments).toHaveLength(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(getReq('/api/admin/user-team-roles'), {
      env: { DB: makeDb() as any },
    });

    const res = await utrGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/user-team-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('creates a new team role assignment and returns 201', async () => {
    // first() returns existing user (not null), second first() returns null (no existing assignment check is done via INSERT)
    // The handler: first() → user lookup, then INSERT .run(), then optional UPDATE .run()
    // User exists with role 'member' → triggers auto-upgrade
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      {
        env: {
          DB: makeDb({
            first: { id: 'u1', role: 'member' },
            run: { meta: { changes: 1 } },
          }) as any,
        },
      },
    );

    const res = await utrPost(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
  });

  it('returns 400 when userId is missing', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      { env: { DB: makeDb() as any } },
    );

    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/userId/);
  });

  it('returns 400 when role is invalid', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'admin',
      }),
      { env: { DB: makeDb() as any } },
    );

    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/role/i);
  });

  it('returns 404 when user does not exist', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u_nonexistent',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      { env: { DB: makeDb({ first: null }) as any } },
    );

    const res = await utrPost(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      { env: { DB: makeDb() as any } },
    );

    const res = await utrPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 400 when teamSlug is missing', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      { env: { DB: makeDb() as any } },
    );
    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/teamSlug/);
  });

  it('returns 400 when teamLeague is missing', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamName: 'Senior Men',
        role: 'manager',
      }),
      { env: { DB: makeDb() as any } },
    );
    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/teamLeague/);
  });

  it('returns 400 when teamName is missing', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        role: 'manager',
      }),
      { env: { DB: makeDb() as any } },
    );
    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/teamName/);
  });

  it('returns 400 when role field is missing entirely', async () => {
    const ctx = makeContext(
      postReq('/api/admin/user-team-roles', {
        userId: 'u1',
        teamSlug: 'senior-men',
        teamLeague: 'Sunday League',
        teamName: 'Senior Men',
      }),
      { env: { DB: makeDb() as any } },
    );
    const res = await utrPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/role/i);
  });
});

describe('DELETE /api/admin/user-team-roles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deletes an existing assignment and returns ok', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/user-team-roles?id=utr_1'),
      {
        env: {
          DB: makeDb({
            first: { id: 'utr_1' },
            run: { meta: { changes: 1 } },
          }) as any,
        },
      },
    );

    const res = await utrDelete(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 when assignment does not exist', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/user-team-roles?id=utr_999'),
      { env: { DB: makeDb({ first: null }) as any } },
    );

    const res = await utrDelete(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 400 when id query param is missing', async () => {
    const ctx = makeContext(
      deleteReq('/api/admin/user-team-roles'),
      { env: { DB: makeDb() as any } },
    );

    const res = await utrDelete(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      deleteReq('/api/admin/user-team-roles?id=utr_1'),
      { env: { DB: makeDb() as any } },
    );

    const res = await utrDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});

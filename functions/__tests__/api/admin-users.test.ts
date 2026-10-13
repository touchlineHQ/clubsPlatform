import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import { makeContext, makeDb, makeEnv, adminSession, treasurerSession, secretarySession, getReq, postReq, patchReq, deleteReq } from '../test-utils';

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
      { env: { DB: makeDb({ first: [{ role: 'member' }] }) as any } },
    );

    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('grants a committee role and audits who, what and why (#79)', async () => {
    const db = makeDb({ first: [{ role: 'member' }] });
    const ctx = makeContext(
      patchReq('/api/admin/users', { userId: 'u1', role: 'treasurer', reason: 'Elected at AGM' }),
      { env: { DB: db as any } },
    );

    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(200);

    const prepare = vi.mocked(db.prepare);
    const sqls = prepare.mock.calls.map((c) => String(c[0]));
    const auditIdx = sqls.findIndex((q) => q.includes('admin_audit_log'));
    expect(auditIdx).toBeGreaterThan(-1);
    const auditBind = vi.mocked(prepare.mock.results[auditIdx].value.bind).mock.calls[0];
    // id, clubSlug, adminId, action, targetTable, targetId, old, new, note, createdAt
    expect(auditBind.slice(1, 8)).toEqual(['test-club', 'user_1', 'user_role_changed', 'user', 'u1', 'member', 'treasurer']);
    expect(JSON.parse(auditBind[8] as string)).toEqual({ reason: 'Elected at AGM', permissions: ['payments'] });
    expect(db.batch).toHaveBeenCalledOnce();
  });

  it('accepts secretary as a role', async () => {
    const ctx = makeContext(
      patchReq('/api/admin/users', { userId: 'u1', role: 'secretary' }),
      { env: { DB: makeDb({ first: [{ role: 'member' }] }) as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(200);
  });

  describe('against real SQL', () => {
    let sqlite: SqliteDb;
    beforeEach(() => {
      sqlite = createSchemaDb();
      sqlite.exec(`INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, role, clubSlug) VALUES
        ('u1', 'Ann', 'ann@example.com', 0, 1, 1, 'member', 'test-club'),
        ('u-other', 'Olly', 'olly@example.com', 0, 1, 1, 'member', 'other-club')`);
    });
    afterEach(() => sqlite.close());

    const patch = (body: unknown) => onRequestPatch(makeContext(
      patchReq('/api/admin/users', body),
      { env: { DB: d1Over(sqlite) as any } },
    ) as any);
    const roleOf = (id: string) => (sqlite.prepare(`SELECT role FROM "user" WHERE id = ?`).get(id) as { role: string }).role;
    const auditRows = () => sqlite.prepare(`SELECT oldStatus, newStatus FROM admin_audit_log`).all();

    it('changes the role and writes one audit row', async () => {
      const res = await patch({ userId: 'u1', role: 'secretary', reason: 'Took minutes' });
      expect(res.status).toBe(200);
      expect(roleOf('u1')).toBe('secretary');
      expect(auditRows()).toEqual([{ oldStatus: 'member', newStatus: 'secretary' }]);
    });

    it("returns 404 for a user in another club and changes nothing", async () => {
      const res = await patch({ userId: 'u-other', role: 'admin' });
      expect(res.status).toBe(404);
      expect(roleOf('u-other')).toBe('member');
      expect(auditRows()).toEqual([]);
    });

    it('returns 409 and audits nothing when the role changed after it was read', async () => {
      const db = d1Over(sqlite);
      const realBatch = db.batch.bind(db);
      // Another admin's change lands between this request's read and its write.
      db.batch = async (stmts) => {
        sqlite.exec(`UPDATE "user" SET role = 'admin' WHERE id = 'u1'`);
        return realBatch(stmts);
      };
      const res = await onRequestPatch(makeContext(
        patchReq('/api/admin/users', { userId: 'u1', role: 'treasurer' }),
        { env: { DB: db as any } },
      ) as any);
      expect(res.status).toBe(409);
      expect(roleOf('u1')).toBe('admin');
      expect(auditRows()).toEqual([]);
    });
  });

  it('returns 400 for a JSON null body', async () => {
    const res = await onRequestPatch(makeContext(
      patchReq('/api/admin/users', null),
      { env: { DB: makeDb() as any } },
    ) as any);
    expect(res.status).toBe(400);
  });

  it('refuses a treasurer or secretary trying to assign roles', async () => {
    for (const session of [treasurerSession, secretarySession]) {
      mockGetSession.mockResolvedValue(session);
      const ctx = makeContext(
        patchReq('/api/admin/users', { userId: 'u1', role: 'admin' }),
        { env: { DB: makeDb() as any } },
      );
      const res = await onRequestPatch(ctx as any);
      expect(res.status).toBe(403);
    }
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

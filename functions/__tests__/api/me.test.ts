import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, memberSession, getReq, postReq, deleteReq } from '../test-utils';

// Mock auth BEFORE importing handlers
const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: mockGetSession },
  })),
}));

// ─── me ──────────────────────────────────────────────────────────────────────

import { onRequestGet as meGet } from '../../api/me';

describe('GET /api/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns user info for authenticated session', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const ctx = makeContext(getReq('/api/me'), {
      env: { DB: makeDb() as any },
    });

    const res = await meGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.user.id).toBe('user_1');
    expect(body.user.name).toBe('Test User');
    expect(body.user.email).toBe('test@example.com');
    expect(body.user.role).toBe('member');
    expect(body.user.clubSlug).toBe('test-club');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(getReq('/api/me'), {
      env: { DB: makeDb() as any },
    });

    const res = await meGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── my-teams ────────────────────────────────────────────────────────────────

import { onRequestGet as myTeamsGet } from '../../api/my-teams';

describe('GET /api/my-teams', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns team roles for authenticated user', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const row = {
      id: 'utr_1',
      teamSlug: 'first-xi',
      teamLeague: 'sunday-league',
      teamName: 'First XI',
      role: 'subscriber',
    };
    const ctx = makeContext(getReq('/api/my-teams'), {
      env: { DB: makeDb({ all: [[row]] }) as any },
    });

    const res = await myTeamsGet(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.teams).toHaveLength(1);
    expect(body.teams[0].id).toBe('utr_1');
    expect(body.teams[0].teamSlug).toBe('first-xi');
    expect(body.teams[0].teamLeague).toBe('sunday-league');
    expect(body.teams[0].teamName).toBe('First XI');
    expect(body.teams[0].role).toBe('subscriber');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(getReq('/api/my-teams'), {
      env: { DB: makeDb() as any },
    });

    const res = await myTeamsGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── team-subscriptions ──────────────────────────────────────────────────────

import { onRequestPost as teamSubPost, onRequestDelete as teamSubDelete } from '../../api/team-subscriptions';

describe('POST /api/team-subscriptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a new subscription and returns 201 with id', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    // first() returns null → no existing subscription
    const ctx = makeContext(
      postReq('/api/team-subscriptions', {
        teamSlug: 'first-xi',
        teamLeague: 'sunday-league',
        teamName: 'First XI',
      }),
      { env: { DB: makeDb({ first: null }) as any } },
    );

    const res = await teamSubPost(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
    expect(body.id).toMatch(/^utr_/);
  });

  it('returns 200 with existing id when already subscribed (idempotent)', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    // first() returns existing subscriber row
    const existingRow = { id: 'utr_existing', role: 'subscriber' };
    const ctx = makeContext(
      postReq('/api/team-subscriptions', {
        teamSlug: 'first-xi',
        teamLeague: 'sunday-league',
        teamName: 'First XI',
      }),
      { env: { DB: makeDb({ first: existingRow }) as any } },
    );

    const res = await teamSubPost(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBe('utr_existing');
  });

  it('returns 409 when user has a non-subscriber role on the team', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const existingRow = { id: 'utr_manager', role: 'manager' };
    const ctx = makeContext(
      postReq('/api/team-subscriptions', {
        teamSlug: 'first-xi',
        teamLeague: 'sunday-league',
        teamName: 'First XI',
      }),
      { env: { DB: makeDb({ first: existingRow }) as any } },
    );

    const res = await teamSubPost(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/role/i);
  });

  it('returns 400 when teamSlug is missing', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const ctx = makeContext(
      postReq('/api/team-subscriptions', { teamLeague: 'sunday-league', teamName: 'First XI' }),
      { env: { DB: makeDb() as any } },
    );

    const res = await teamSubPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      postReq('/api/team-subscriptions', {
        teamSlug: 'first-xi',
        teamLeague: 'sunday-league',
        teamName: 'First XI',
      }),
      { env: { DB: makeDb() as any } },
    );

    const res = await teamSubPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/team-subscriptions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes existing subscriber row and returns { ok: true }', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const existingRow = { id: 'utr_existing', role: 'subscriber' };
    const ctx = makeContext(
      deleteReq('/api/team-subscriptions?slug=first-xi&league=sunday-league'),
      { env: { DB: makeDb({ first: existingRow }) as any } },
    );

    const res = await teamSubDelete(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 when subscription does not exist', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const ctx = makeContext(
      deleteReq('/api/team-subscriptions?slug=first-xi&league=sunday-league'),
      { env: { DB: makeDb({ first: null }) as any } },
    );

    const res = await teamSubDelete(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(404);
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 403 when trying to remove a non-subscriber role', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const existingRow = { id: 'utr_coach', role: 'coach' };
    const ctx = makeContext(
      deleteReq('/api/team-subscriptions?slug=first-xi&league=sunday-league'),
      { env: { DB: makeDb({ first: existingRow }) as any } },
    );

    const res = await teamSubDelete(ctx as any);
    const body = await res.json() as any;

    expect(res.status).toBe(403);
    expect(body.error).toMatch(/coach|manager|admin/i);
  });

  it('returns 400 when slug or league query params are missing', async () => {
    mockGetSession.mockResolvedValue(memberSession);

    const ctx = makeContext(
      deleteReq('/api/team-subscriptions?slug=first-xi'),
      { env: { DB: makeDb() as any } },
    );

    const res = await teamSubDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);

    const ctx = makeContext(
      deleteReq('/api/team-subscriptions?slug=first-xi&league=sunday-league'),
      { env: { DB: makeDb() as any } },
    );

    const res = await teamSubDelete(ctx as any);
    expect(res.status).toBe(401);
  });
});

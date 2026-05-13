import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, adminSession, getReq, postReq, putReq, deleteReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

// ─── subscription-levels.ts ───────────────────────────────────────────────────

import {
  onRequestGet as levelsGet,
  onRequestPost as levelsPost,
} from '../../api/admin/subscription-levels';

describe('subscription-levels GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of subscription levels', async () => {
    const levelRows = [
      {
        id: 'level_1',
        clubSlug: 'test-club',
        name: 'Junior Annual',
        yearlyPriceInPence: 5000,
        intervalCount: 1,
        intervalUnit: 'yearly',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: 'level_2',
        clubSlug: 'test-club',
        name: 'Senior Annual',
        yearlyPriceInPence: 8000,
        intervalCount: 1,
        intervalUnit: 'yearly',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const db = makeDb({ all: [levelRows] });
    const req = getReq('/api/admin/subscription-levels', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.levels)).toBe(true);
    expect(body.levels.length).toBe(2);
    expect(body.levels[0].id).toBe('level_1');
  });
});

describe('subscription-levels POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('creates a subscription level and returns 201', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = postReq(
      '/api/admin/subscription-levels',
      { name: 'Junior Annual', yearlyPriceInPence: 5000 },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.ok).toBeUndefined(); // handler returns { level: {...} }
    expect(body.level).toBeDefined();
    expect(body.level.name).toBe('Junior Annual');
    expect(body.level.yearlyPriceInPence).toBe(5000);
  });

  it('returns 400 when name is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/subscription-levels',
      { yearlyPriceInPence: 5000 },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/name/);
  });

  it('returns 400 when yearlyPriceInPence is invalid', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/subscription-levels',
      { name: 'Junior Annual', yearlyPriceInPence: -50 },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/yearlyPriceInPence/);
  });
});

// ─── subscription-levels/[id].ts ─────────────────────────────────────────────

import {
  onRequestPut as levelPut,
  onRequestDelete as levelDelete,
} from '../../api/admin/subscription-levels/[id]';

describe('subscription-levels/[id] PUT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('updates a subscription level and returns ok', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = putReq(
      '/api/admin/subscription-levels/level_1',
      { name: 'Updated', yearlyPriceInPence: 6000 },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when subscription level does not exist', async () => {
    const db = makeDb({ run: { meta: { changes: 0 } } });
    const req = putReq(
      '/api/admin/subscription-levels/level_missing',
      { name: 'Updated', yearlyPriceInPence: 6000 },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_missing' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when no updatable fields are supplied', async () => {
    const db = makeDb();
    const req = putReq(
      '/api/admin/subscription-levels/level_1',
      {},
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/no updatable fields/);
  });
});

describe('subscription-levels/[id] DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deletes a subscription level and returns ok', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = deleteReq('/api/admin/subscription-levels/level_1', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelDelete(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 404 when subscription level does not exist', async () => {
    const db = makeDb({ run: { meta: { changes: 0 } } });
    const req = deleteReq('/api/admin/subscription-levels/level_missing', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_missing' },
    });

    const res = await levelDelete(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/);
  });
});

// ─── team-subscription-levels.ts ─────────────────────────────────────────────

import {
  onRequestGet as teamLevelsGet,
  onRequestPost as teamLevelsPost,
} from '../../api/admin/team-subscription-levels';

describe('team-subscription-levels GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of teams with their subscription level assignments', async () => {
    const teamRows = [
      {
        teamName: 'U11 Boys',
        playerCount: 12,
        subscriptionLevelId: 'level_1',
        subscriptionLevelName: 'Junior Annual',
        yearlyPriceInPence: 5000,
        intervalCount: 1,
        intervalUnit: 'yearly',
      },
      {
        teamName: 'U13 Girls',
        playerCount: 10,
        subscriptionLevelId: null,
        subscriptionLevelName: null,
        yearlyPriceInPence: null,
        intervalCount: null,
        intervalUnit: null,
      },
    ];

    const db = makeDb({ all: [teamRows] });
    const req = getReq('/api/admin/team-subscription-levels', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await teamLevelsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.teams)).toBe(true);
    expect(body.teams.length).toBe(2);
    expect(body.teams[0].teamName).toBe('U11 Boys');
  });
});

describe('team-subscription-levels POST (assign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('assigns a subscription level to a team and returns ok', async () => {
    // .first() returns the subscription level (found), .run() succeeds
    const db = makeDb({
      first: { id: 'level_1' },
      run: { meta: { changes: 1 } },
    });
    const req = postReq(
      '/api/admin/team-subscription-levels',
      { teamName: 'U11 Boys', subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await teamLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('clears a team subscription level when subscriptionLevelId is null', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = postReq(
      '/api/admin/team-subscription-levels',
      { teamName: 'U11 Boys', subscriptionLevelId: null },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await teamLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);
  });

  it('returns 404 when the subscription level does not exist for this club', async () => {
    const db = makeDb({ first: null });
    const req = postReq(
      '/api/admin/team-subscription-levels',
      { teamName: 'U11 Boys', subscriptionLevelId: 'level_missing' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await teamLevelsPost(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when teamName is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/team-subscription-levels',
      { subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await teamLevelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/teamName/);
  });
});

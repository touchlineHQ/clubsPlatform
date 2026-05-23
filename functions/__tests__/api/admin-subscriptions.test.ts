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
  validateStartDate,
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

  it('returns 400 when startDate is malformed', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/subscription-levels',
      { name: 'Junior Annual', yearlyPriceInPence: 5000, startDate: 'not-a-date' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/startDate/);
  });

  it('persists a valid startDate', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = postReq(
      '/api/admin/subscription-levels',
      { name: 'Junior Annual', yearlyPriceInPence: 5000, startDate: '2030-09-01' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await levelsPost(ctx as any);
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.level.startDate).toBe('2030-09-01');
  });

  it('stores null startDate when omitted', async () => {
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
    expect(body.level.startDate).toBeNull();
  });
});

describe('validateStartDate', () => {
  it('accepts null/undefined/empty', () => {
    expect(validateStartDate(null)).toEqual({ ok: true, value: null });
    expect(validateStartDate(undefined)).toEqual({ ok: true, value: null });
    expect(validateStartDate('')).toEqual({ ok: true, value: null });
  });

  it('accepts a YYYY-MM-DD date string', () => {
    expect(validateStartDate('2024-09-01')).toEqual({ ok: true, value: '2024-09-01' });
  });

  it('rejects malformed strings', () => {
    expect(validateStartDate('2024/09/01').ok).toBe(false);
    expect(validateStartDate('24-09-01').ok).toBe(false);
    expect(validateStartDate('nope').ok).toBe(false);
  });

  it('rejects non-string input', () => {
    expect(validateStartDate(12345).ok).toBe(false);
    expect(validateStartDate(true).ok).toBe(false);
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

  it('updates startDate when provided', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = putReq(
      '/api/admin/subscription-levels/level_1',
      { startDate: '2030-09-01' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(200);
  });

  it('clears startDate when explicitly set to null', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = putReq(
      '/api/admin/subscription-levels/level_1',
      { startDate: null },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(200);
  });

  it('returns 400 when startDate is malformed on PUT', async () => {
    const db = makeDb();
    const req = putReq(
      '/api/admin/subscription-levels/level_1',
      { startDate: 'nope' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, {
      env: { DB: db as any },
      params: { id: 'level_1' },
    });

    const res = await levelPut(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/startDate/);
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

// ─── status-subscription-levels.ts ───────────────────────────────────────────

import {
  onRequestGet as statusLevelsGet,
  onRequestPost as statusLevelsPost,
} from '../../api/admin/status-subscription-levels';

describe('status-subscription-levels GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns statuses, clubRates, and teamRates from batch', async () => {
    const db = makeDb({
      batch: [[
        [{ registrationStatus: 'Training Only' }],
        [{ registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_1', subscriptionLevelName: 'Monthly', yearlyPriceInPence: 1200, intervalCount: 12, intervalUnit: 'monthly' }],
        [{ teamName: 'U11s', registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_1', subscriptionLevelName: 'Monthly', yearlyPriceInPence: 1200, intervalCount: 12, intervalUnit: 'monthly' }],
      ]],
    });
    const req = getReq('/api/admin/status-subscription-levels', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.statuses).toEqual(['Training Only']);
    expect(body.clubRates).toHaveLength(1);
    expect(body.clubRates[0].subscriptionLevelId).toBe('lvl_1');
    expect(body.teamRates).toHaveLength(1);
    expect(body.teamRates[0].teamName).toBe('U11s');
  });

  it('returns empty arrays when batch returns empty results', async () => {
    const db = makeDb({
      batch: [[[], [], []]],
    });
    const req = getReq('/api/admin/status-subscription-levels', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.statuses).toEqual([]);
    expect(body.clubRates).toEqual([]);
    expect(body.teamRates).toEqual([]);
  });
});

describe('status-subscription-levels POST (club-wide)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('assigns a subscription level club-wide and returns ok', async () => {
    const db = makeDb({
      first: { id: 'lvl_1' },
      run: { meta: { changes: 1 } },
    });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBeUndefined();
  });

  it('clears a club-wide level when subscriptionLevelId is null and returns cleared', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { registrationStatus: 'Training Only', subscriptionLevelId: null },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);
  });

  it('returns 404 when the subscription level does not exist club-wide', async () => {
    const db = makeDb({ first: null });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_missing' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/);
  });

  it('returns 400 when registrationStatus is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { subscriptionLevelId: 'lvl_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/registrationStatus/);
  });
});

describe('status-subscription-levels POST (team-specific)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('assigns a subscription level to a team status override and returns ok', async () => {
    const db = makeDb({
      first: { id: 'lvl_1' },
      run: { meta: { changes: 1 } },
    });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { teamName: 'U11s', registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBeUndefined();
  });

  it('clears a team-specific override when subscriptionLevelId is null and returns cleared', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { teamName: 'U11s', registrationStatus: 'Training Only', subscriptionLevelId: null },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);
  });

  it('returns 404 when the subscription level does not exist for a team override', async () => {
    const db = makeDb({ first: null });
    const req = postReq(
      '/api/admin/status-subscription-levels',
      { teamName: 'U11s', registrationStatus: 'Training Only', subscriptionLevelId: 'lvl_missing' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await statusLevelsPost(ctx as any);
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

// ─── registration-subscription-levels.ts ─────────────────────────────────────

import {
  onRequestPost as regLevelsPost,
} from '../../api/admin/registration-subscription-levels';

describe('registration-subscription-levels POST (assign)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('assigns a subscription level to a registration and returns ok', async () => {
    // First .first() looks up the registration, second looks up the level.
    const db = makeDb({
      first: [{ id: 'reg_1' }, { id: 'level_1' }],
      run: { meta: { changes: 1 } },
    });
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { registrationId: 'reg_1', subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('clears the override when subscriptionLevelId is null', async () => {
    // Only the registration lookup runs before the DELETE branch.
    const db = makeDb({
      first: [{ id: 'reg_1' }],
      run: { meta: { changes: 1 } },
    });
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { registrationId: 'reg_1', subscriptionLevelId: null },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.cleared).toBe(true);
  });

  it('returns 404 when the registration does not belong to this club', async () => {
    const db = makeDb({ first: null });
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { registrationId: 'reg_missing', subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/registration not found/);
  });

  it('returns 404 when the subscription level does not exist for this club', async () => {
    // First .first() returns the registration, second returns null (level not found).
    const db = makeDb({ first: [{ id: 'reg_1' }, null] });
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { registrationId: 'reg_1', subscriptionLevelId: 'level_missing' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/subscription level not found/);
  });

  it('returns 400 when registrationId is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/registrationId/);
  });

  it('returns 401 when caller is not an admin', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb();
    const req = postReq(
      '/api/admin/registration-subscription-levels',
      { registrationId: 'reg_1', subscriptionLevelId: 'level_1' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await regLevelsPost(ctx as any);
    expect([401, 403]).toContain(res.status);
  });
});

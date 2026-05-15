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
});

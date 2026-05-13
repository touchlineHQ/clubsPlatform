import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, managerSession, memberSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import {
  onRequestGet,
  onRequestPost,
  onRequestPatch,
} from '../../api/booking-requests';

const sampleRequest = {
  id: 'req_1',
  userId: 'user_1',
  teamName: 'U11s',
  teamSlug: null,
  teamLeague: null,
  date: '2024-03-15',
  timeStart: '10:00',
  timeEnd: '11:00',
  format: '11v11',
  notes: null,
  status: 'pending',
  declineReason: null,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  userName: 'Test User',
  userEmail: 'test@example.com',
};

beforeEach(() => vi.clearAllMocks());

// ─── onRequestGet ─────────────────────────────────────────────────────────────

describe('onRequestGet', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(getReq('/api/booking-requests', { 'X-Club-Slug': 'test-club' }));
    const res = await onRequestGet(ctx as any);
    expect(res.status).toBe(401);
  });

  it('admin sees all requests for the club', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[sampleRequest]] });
    const ctx = makeContext(
      getReq('/api/booking-requests', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.requests.length).toBeGreaterThan(0);
    expect(body.requests[0].id).toBe('req_1');
    expect(body.requests[0].userName).toBe('Test User');
  });

  it('manager sees only their own requests', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const ownRequest = { ...sampleRequest, userName: undefined, userEmail: undefined };
    const db = makeDb({ all: [[ownRequest]] });
    const ctx = makeContext(
      getReq('/api/booking-requests', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.requests.length).toBeGreaterThan(0);
  });

  it('admin can filter by status query param', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ all: [[sampleRequest]] });
    const ctx = makeContext(
      getReq('/api/booking-requests?status=pending', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(body.requests)).toBe(true);
  });

  it('manager can filter requests by status query param', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb({ all: [[sampleRequest]] });
    const ctx = makeContext(
      getReq('/api/booking-requests?status=pending', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(body.requests)).toBe(true);
  });
});

// ─── onRequestPost ────────────────────────────────────────────────────────────

describe('onRequestPost', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      postReq('/api/booking-requests', { teamName: 'U11s' }, { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('manager creates a booking request and returns 201', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '10:00', timeEnd: '11:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(typeof body.id).toBe('string');
  });

  it('admin creates a booking request and returns 201', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '10:00', timeEnd: '11:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when teamName is missing', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { date: '2024-03-15', timeStart: '10:00', timeEnd: '11:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid format', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '10:00', timeEnd: '11:00', format: 'badformat' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when timeEnd is not after timeStart', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '11:00', timeEnd: '10:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('creates booking request with all optional fields (teamSlug, teamLeague, notes)', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        {
          teamName: 'U11s',
          teamSlug: 'u11s',
          teamLeague: 'sunday-league',
          date: '2024-03-15',
          timeStart: '10:00',
          timeEnd: '11:00',
          format: '11v11',
          notes: 'Home match',
        },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when date is missing', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', timeStart: '10:00', timeEnd: '11:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when timeStart is missing', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeEnd: '11:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when timeEnd is missing', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '10:00', format: '11v11' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when format is missing', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq(
        '/api/booking-requests',
        { teamName: 'U11s', date: '2024-03-15', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });
});

// ─── onRequestPatch – approve ─────────────────────────────────────────────────

describe('onRequestPatch – approve', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      patchReq('/api/booking-requests?id=req_1', { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00' }, { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(401);
  });

  it('admin approves a pending request and returns ok', async () => {
    mockGetSession.mockResolvedValue(adminSession);

    // Sequential .first() calls:
    // 1. booking_request pending check → returns the request row
    // 2. pitch lookup → returns pitch row
    // 3. conflict check → returns null (no conflict)
    // 4. fullRequest (teamName, teamSlug, teamLeague)
    // 5. reqClubSlug
    const db = makeDb({
      first: [
        { id: 'req_1', teamName: 'U11s', teamSlug: null, teamLeague: null, date: '2024-03-15', format: '11v11', status: 'pending' },
        { id: 'pitch_1', formats: '["11v11"]' },
        null,
        { teamName: 'U11s', teamSlug: null, teamLeague: null },
        { clubSlug: 'test-club' },
      ],
    });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.bookingId).toBe('string');
  });

  it('returns 404 when booking request not found or not pending', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_missing',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 404 when pitch not found', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({
      first: [
        { id: 'req_1', teamName: 'U11s', teamSlug: null, teamLeague: null, date: '2024-03-15', format: '11v11' },
        null, // pitch not found
      ],
    });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_missing', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when pitch does not support the requested format', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({
      first: [
        { id: 'req_1', teamName: 'U11s', teamSlug: null, teamLeague: null, date: '2024-03-15', format: '11v11' },
        { id: 'pitch_1', formats: '["5v5"]' }, // only supports 5v5
      ],
    });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 409 when there is a conflicting booking', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({
      first: [
        { id: 'req_1', teamName: 'U11s', teamSlug: null, teamLeague: null, date: '2024-03-15', format: '11v11' },
        { id: 'pitch_1', formats: '["11v11"]' },
        { teamName: 'Other Team', timeStart: '10:00', timeEnd: '11:00' }, // conflict
      ],
    });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(409);
  });

  it('returns 400 when pitchId is missing for approve', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', timeStart: '10:00', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });

  it('approves request and includes notes when notes field is provided', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({
      first: [
        { id: 'req_1', teamName: 'U11s', teamSlug: 'u11s', teamLeague: 'sunday-lg', date: '2024-03-15', format: '11v11' },
        { id: 'pitch_1', formats: '["11v11"]' },
        null,
        { teamName: 'U11s', teamSlug: 'u11s', teamLeague: 'sunday-lg' },
        { clubSlug: 'test-club' },
      ],
    });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00', timeEnd: '11:00', notes: 'Please arrive early' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when timeStart is missing for approve', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: { id: 'req_1', teamName: 'U11s', date: '2024-03-15', format: '11v11' } });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeEnd: '11:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 when timeEnd is missing for approve', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: { id: 'req_1', teamName: 'U11s', date: '2024-03-15', format: '11v11' } });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'approve', pitchId: 'pitch_1', timeStart: '10:00' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });
});

// ─── onRequestPatch – decline ─────────────────────────────────────────────────

describe('onRequestPatch – decline', () => {
  it('admin declines a pending request and returns ok', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: { id: 'req_1' } });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'decline', reason: 'Not available' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 404 when request not found or not pending', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_missing',
        { action: 'decline', reason: 'Not available' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when id query param is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests',
        { action: 'decline', reason: 'Not available' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 400 for an unknown action', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'unknown' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    expect(res.status).toBe(400);
  });

  it('declines with no reason provided (reason defaults to null)', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: { id: 'req_1' } });
    const ctx = makeContext(
      patchReq(
        '/api/booking-requests?id=req_1',
        { action: 'decline' },
        { 'X-Club-Slug': 'test-club' },
      ),
      { env: { DB: db as any } },
    );
    const res = await onRequestPatch(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

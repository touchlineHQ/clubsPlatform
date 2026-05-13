import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, managerSession, memberSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet, onRequestDelete } from '../../api/bookings';

const sampleBooking = {
  id: 'booking_1',
  date: '2024-03-15',
  timeStart: '10:00',
  timeEnd: '11:00',
  teamName: 'U11s',
  teamSlug: null,
  teamLeague: null,
  format: '11v11',
  notes: null,
  pitchName: 'Main Pitch',
  pitchId: 'pitch_1',
  createdAt: 1700000000000,
  requestId: 'req_1',
};

beforeEach(() => vi.clearAllMocks());

// ─── onRequestGet ─────────────────────────────────────────────────────────────

describe('onRequestGet', () => {
  it('returns bookings for a club', async () => {
    const db = makeDb({ all: [[sampleBooking]] });
    const ctx = makeContext(
      getReq('/api/bookings', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.bookings).toBeDefined();
    expect(Array.isArray(body.bookings)).toBe(true);
    expect(body.bookings.length).toBe(1);
    expect(body.bookings[0].id).toBe('booking_1');
    expect(body.bookings[0].pitchName).toBe('Main Pitch');
  });

  it('returns an empty bookings array when no bookings exist', async () => {
    const db = makeDb({ all: [[]] });
    const ctx = makeContext(
      getReq('/api/bookings', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.bookings).toEqual([]);
  });

  it('filters bookings by date query param', async () => {
    const db = makeDb({ all: [[sampleBooking]] });
    const ctx = makeContext(
      getReq('/api/bookings?date=2024-03-15', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(body.bookings)).toBe(true);
  });

  it('filters bookings by month query param', async () => {
    const db = makeDb({ all: [[sampleBooking]] });
    const ctx = makeContext(
      getReq('/api/bookings?month=2024-03', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(Array.isArray(body.bookings)).toBe(true);
  });

  it('omits null optional fields from booking objects', async () => {
    const db = makeDb({ all: [[sampleBooking]] });
    const ctx = makeContext(
      getReq('/api/bookings', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    // null fields become undefined (omitted in mapped output)
    expect(body.bookings[0].teamSlug).toBeUndefined();
    expect(body.bookings[0].notes).toBeUndefined();
  });
});

// ─── onRequestDelete ──────────────────────────────────────────────────────────

describe('onRequestDelete', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      deleteReq('/api/bookings?id=booking_1', { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not an admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/bookings?id=booking_1', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(403);
  });

  it('admin deletes a booking and returns ok', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({
      first: { id: 'booking_1' },
      batch: [[]],
    });
    const ctx = makeContext(
      deleteReq('/api/bookings?id=booking_1', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('returns 400 when id query param is missing', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb();
    const ctx = makeContext(
      deleteReq('/api/bookings', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(400);
  });

  it('returns 404 when booking does not belong to the club', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const db = makeDb({ first: null });
    const ctx = makeContext(
      deleteReq('/api/bookings?id=booking_other', { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestDelete(ctx as any);
    expect(res.status).toBe(404);
  });
});

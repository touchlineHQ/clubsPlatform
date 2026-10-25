import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { makeContext, adminSession, getReq, postReq, patchReq, deleteReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as pitchesGet } from '../../api/pitches';
import { onRequestGet as bookingsGet, onRequestDelete as bookingsDelete } from '../../api/bookings';
import {
  onRequestGet as requestsGet,
  onRequestPost as requestsPost,
  onRequestPatch as requestsPatch,
} from '../../api/booking-requests';

const NOW = 1_700_000_000_000;
const A = { 'X-Club-Slug': 'test-club' };
const B = { 'X-Club-Slug': 'other-club' };
const otherAdmin = { ...adminSession, user: { ...adminSession.user, id: 'user_2', clubSlug: 'other-club' } };

// #83: bookings, booking requests and pitches are scoped to the X-Club-Slug club.
describe('pitch bookings are club-scoped (#83)', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    for (const slug of ['test-club', 'other-club']) {
      sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, createdAt) VALUES ('c_${slug}','${slug}','${slug}',1,${NOW})`);
    }
    sqlite.exec(`INSERT INTO "user" VALUES ('user_1','A','a@example.com',1,NULL,'admin','test-club',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "user" VALUES ('user_2','B','b@example.com',1,NULL,'admin','other-club',${NOW},${NOW})`);
    // The shared default set (0004's seed) has no club.
    sqlite.exec(`INSERT INTO "pitch" (id, clubSlug, name, formats) VALUES ('pitch_1',NULL,'Pitch 1','["11v11"]'),('pitch_6',NULL,'Pitch 6','["7v7"]')`);
    sqlite.exec(`INSERT INTO "pitch" (id, clubSlug, name, formats) VALUES ('p_other','other-club','Other Pitch','["7v7"]')`);
    mockGetSession.mockResolvedValue(adminSession);
  });
  afterEach(() => sqlite.close());

  const env = () => ({ DB: d1Over(sqlite) as any, MULTI_CLUB: 'true', PITCH_BOOKINGS: 'true' });
  const call = (h: any, req: Request) => h(makeContext(req, { env: env() }) as any);
  const submit = async (headers: Record<string, string>) => {
    const res = await call(requestsPost, postReq('/api/booking-requests', {
      teamName: 'U9s', date: '2026-11-01', timeStart: '10:00', timeEnd: '11:00', format: '7v7',
    }, headers));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const approve = (id: string, headers: Record<string, string>, pitchId = 'pitch_6') =>
    call(requestsPatch, patchReq(`/api/booking-requests?id=${id}`, { action: 'approve', pitchId, timeStart: '10:00', timeEnd: '11:00' }, headers));

  it('stores a request and its booking against the club that made them', async () => {
    const id = await submit(A);
    expect(sqlite.prepare(`SELECT clubSlug FROM booking_request WHERE id = ?`).get(id)).toEqual({ clubSlug: 'test-club' });
    expect((await approve(id, A)).status).toBe(200);
    expect(sqlite.prepare(`SELECT clubSlug FROM booking WHERE requestId = ?`).get(id)).toEqual({ clubSlug: 'test-club' });
  });

  it('shows each club its own pitches plus the shared default set, never another club\'s', async () => {
    const names = async (h: Record<string, string>) =>
      ((await (await call(pitchesGet, getReq('/api/pitches', h))).json()) as { pitches: { id: string }[] }).pitches.map(p => p.id);
    const a = await names(A);
    expect(a).toContain('pitch_1');
    expect(a).not.toContain('p_other');
    expect(await names(B)).toContain('p_other');
  });

  it('denies one club reading or changing another club\'s requests and bookings', async () => {
    const id = await submit(A);
    expect((await approve(id, A)).status).toBe(200);
    const bookingId = (sqlite.prepare(`SELECT id FROM booking WHERE requestId = ?`).get(id) as { id: string }).id;

    mockGetSession.mockResolvedValue(otherAdmin);
    const reqs = (await (await call(requestsGet, getReq('/api/booking-requests', B))).json()) as { requests: unknown[] };
    expect(reqs.requests).toEqual([]);
    const bkgs = (await (await call(bookingsGet, getReq('/api/bookings', B))).json()) as { bookings: unknown[] };
    expect(bkgs.bookings).toEqual([]);
    expect((await call(bookingsDelete, deleteReq(`/api/bookings?id=${bookingId}`, B))).status).toBe(404);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM booking`).get()).toEqual({ n: 1 });
    expect(sqlite.prepare(`SELECT status FROM booking_request WHERE id = ?`).get(id)).toEqual({ status: 'approved' });
  });

  it('refuses approving onto another club\'s own pitch', async () => {
    const id = await submit(A);
    expect((await approve(id, A, 'p_other')).status).toBe(404);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM booking`).get()).toEqual({ n: 0 });
  });

  it('does not treat another club\'s booking of a shared pitch as a clash', async () => {
    expect((await approve(await submit(A), A)).status).toBe(200);
    mockGetSession.mockResolvedValue(otherAdmin);
    expect((await approve(await submit(B), B)).status).toBe(200);
    // Within one club the clash still applies.
    const res = await approve(await submit(B), B);
    expect(res.status).toBe(409);
  });

  it('lets an unbound admin approve header-less on a single-club deployment', async () => {
    sqlite.exec(`UPDATE club_config SET active = 0 WHERE slug = 'other-club'`);
    const id = await submit(A);
    mockGetSession.mockResolvedValue({ ...adminSession, user: { ...adminSession.user, clubSlug: null } });
    expect((await approve(id, {})).status).toBe(200);
    expect(sqlite.prepare(`SELECT status FROM booking_request WHERE id = ?`).get(id)).toEqual({ status: 'approved' });
  });

  describe('migration 0042 backfill', () => {
    const migration = readFileSync(resolve(__dirname, '../../../migrations/0042_scope_bookings_to_club.sql'), 'utf8');
    const seedLegacy = () => {
      sqlite.exec(`INSERT INTO "booking_request" (id, clubSlug, userId, teamName, date, timeStart, timeEnd, format, status, createdAt, updatedAt)
        VALUES ('r_null',NULL,'user_1','U9s','2026-11-01','10:00','11:00','7v7','approved',${NOW},${NOW}),
               ('r_club','test-club','user_1','U9s','2026-11-02','10:00','11:00','7v7','approved',${NOW},${NOW})`);
      sqlite.exec(`INSERT INTO "booking" (id, clubSlug, requestId, pitchId, date, timeStart, timeEnd, teamName, format, createdAt)
        VALUES ('b_null',NULL,'r_null','pitch_6','2026-11-01','10:00','11:00','U9s','7v7',${NOW}),
               ('b_inherit',NULL,'r_club','pitch_6','2026-11-02','10:00','11:00','U9s','7v7',${NOW})`);
    };
    const clubs = (table: string) =>
      Object.fromEntries((sqlite.prepare(`SELECT id, clubSlug FROM ${table}`).all() as { id: string; clubSlug: string | null }[]).map(r => [r.id, r.clubSlug]));

    it('backfills club-less rows to the only active club', () => {
      sqlite.exec(`UPDATE club_config SET active = 0 WHERE slug = 'other-club'`);
      seedLegacy();
      sqlite.exec(migration);
      expect(clubs('booking_request')).toEqual({ r_null: 'test-club', r_club: 'test-club' });
      expect(clubs('booking')).toEqual({ b_null: 'test-club', b_inherit: 'test-club' });
      expect(clubs('pitch').pitch_1).toBeNull(); // the shared default set stays shared
    });

    it('with several active clubs, only inherits from the request and leaves the rest NULL', () => {
      seedLegacy();
      sqlite.exec(migration);
      expect(clubs('booking_request')).toEqual({ r_null: null, r_club: 'test-club' });
      expect(clubs('booking')).toEqual({ b_null: null, b_inherit: 'test-club' });
    });
  });
});

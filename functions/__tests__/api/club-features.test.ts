import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, secretarySession, platformAdminSession, getReq, putReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as featuresGet, onRequestPut as featuresPut } from '../../api/club-features';
import { onRequestGet as clubsGet } from '../../api/clubs';
import { onRequestGet as pitchesGet } from '../../api/pitches';
import { onRequestGet as bookingsGet } from '../../api/bookings';
import { onRequestPost as bookingRequestPost } from '../../api/booking-requests';
import { postReq } from '../test-utils';
import { deploymentDefault, resolveFeature } from '../../lib/club-features';
import { isPitchBookingsEnabled } from '../../lib/api-helpers';

const NOW = 1_700_000_000_000;

describe('per-club feature switches (#83)', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    sqlite = createSchemaDb();
    for (const slug of ['test-club', 'other-club']) {
      sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, createdAt) VALUES ('c_${slug}','${slug}','${slug}',1,${NOW})`);
    }
    mockGetSession.mockResolvedValue(adminSession);
  });
  afterEach(() => sqlite.close());

  const env = (extra: Record<string, string> = {}) => ({ DB: d1Over(sqlite) as any, MULTI_CLUB: 'true', ...extra });
  const registry = async (extra: Record<string, string> = {}) => {
    const res = await clubsGet(makeContext(getReq('/api/clubs'), { env: env(extra) }) as any);
    const body = await res.json() as { pitchBookings: boolean; clubs: Array<{ slug: string; features: { pitchBookings: boolean } }> };
    return Object.fromEntries(body.clubs.map((c) => [c.slug, c.features.pitchBookings]));
  };
  const put = (enabled: unknown, slug = 'test-club', extra: Record<string, string> = {}) =>
    featuresPut(makeContext(
      putReq('/api/club-features', { feature: 'pitchBookings', enabled }, { 'X-Club-Slug': slug }),
      { env: env(extra) },
    ) as any);

  it('keeps every club off on migration when PITCH_BOOKINGS is unset (production today)', async () => {
    expect(await registry()).toEqual({ 'test-club': false, 'other-club': false });
  });

  it('enabling for one club does not affect any other club', async () => {
    const res = await put(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ features: { pitchBookings: true } });
    expect(await registry()).toEqual({ 'test-club': true, 'other-club': false });

    expect((await put(false)).status).toBe(200);
    expect(await registry()).toEqual({ 'test-club': false, 'other-club': false });
  });

  it('a truthy env var stays the default for clubs that have not chosen, and a club can opt out', async () => {
    mockGetSession.mockResolvedValue(platformAdminSession);
    expect((await put(false, 'other-club')).status).toBe(200);
    expect(await registry({ PITCH_BOOKINGS: 'true' })).toEqual({ 'test-club': true, 'other-club': false });
  });

  it('PITCH_BOOKINGS=off is a platform-wide kill switch', async () => {
    await put(true);
    expect(await registry({ PITCH_BOOKINGS: 'off' })).toEqual({ 'test-club': false, 'other-club': false });
    const res = await featuresGet(makeContext(getReq('/api/club-features', { 'X-Club-Slug': 'test-club' }), { env: env({ PITCH_BOOKINGS: 'off' }) }) as any);
    expect(await res.json()).toEqual({ features: { pitchBookings: false }, killed: { pitchBookings: true } });
  });

  it('is club-admin only, and audit-logged', async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    expect((await put(true)).status).toBe(403);
    mockGetSession.mockResolvedValue(adminSession);
    expect((await put(true, 'other-club')).status).toBe(403); // admin of test-club only
    expect((await put(true)).status).toBe(200);
    expect(sqlite.prepare(`SELECT action, targetId, oldStatus, newStatus FROM admin_audit_log`).all()).toEqual([
      { action: 'club.feature', targetId: 'test-club:pitchBookings', oldStatus: 'off', newStatus: 'on' },
    ]);
  });

  it('refuses the pitch and booking APIs for a club with the feature off, and serves them once on', async () => {
    const H = { 'X-Club-Slug': 'test-club' };
    const call = (h: any, req: Request) => h(makeContext(req, { env: env() }) as any);
    expect((await call(pitchesGet, getReq('/api/pitches', H))).status).toBe(404);
    expect((await call(bookingsGet, getReq('/api/bookings', H))).status).toBe(404);
    expect((await call(bookingRequestPost, postReq('/api/booking-requests', {}, H))).status).toBe(404);

    await put(true);
    expect((await call(pitchesGet, getReq('/api/pitches', H))).status).toBe(200);
    // Another club on the same deployment is still refused.
    expect((await call(pitchesGet, getReq('/api/pitches', { 'X-Club-Slug': 'other-club' }))).status).toBe(404);
  });

  it('audits the stored setting, not the killed resolved value', async () => {
    await put(true);
    await put(false, 'test-club', { PITCH_BOOKINGS: 'off' });
    const rows = sqlite.prepare(`SELECT oldStatus, newStatus FROM admin_audit_log ORDER BY rowid`).all();
    expect(rows[1]).toEqual({ oldStatus: 'on', newStatus: 'off' });
  });

  it('GET is a 404 for an unknown club', async () => {
    const res = await featuresGet(makeContext(getReq('/api/club-features', { 'X-Club-Slug': 'nope' }), { env: env() }) as any);
    expect(res.status).toBe(404);
  });

  it('validates the body', async () => {
    expect((await put('yes')).status).toBe(400);
    const res = await featuresPut(makeContext(
      putReq('/api/club-features', { feature: 'shop', enabled: true }, { 'X-Club-Slug': 'test-club' }),
      { env: env() },
    ) as any);
    expect(res.status).toBe(400);
  });

  it('resolves env values consistently', () => {
    const e = (v?: string) => ({ PITCH_BOOKINGS: v }) as any;
    expect(deploymentDefault(e(undefined), 'pitchBookings')).toBe('off');
    expect(deploymentDefault(e('false'), 'pitchBookings')).toBe('off');
    expect(deploymentDefault(e('true'), 'pitchBookings')).toBe('on');
    expect(deploymentDefault(e('OFF'), 'pitchBookings')).toBe('killed');
    expect(resolveFeature('off', true)).toBe(true);
    expect(resolveFeature('on', undefined)).toBe(true);
    expect(resolveFeature('killed', true)).toBe(false);
    expect(isPitchBookingsEnabled(e('off'))).toBe(false);
  });
});

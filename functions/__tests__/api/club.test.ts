import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, getReq, patchReq, adminSession } from '../test-utils';

vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    api: { getSession: vi.fn().mockResolvedValue(adminSession) },
  })),
}));

vi.mock('../../lib/seed', () => ({
  seedClubData: vi.fn(async () => {}),
}));

import { onRequestGet, onRequestPatch } from '../../api/club';

const clubRow = {
  slug: 'test-club',
  name: 'Test FC',
  primaryColor: null,
  data: JSON.stringify({ slug: 'test-club', name: 'Test FC', tagline: 'Play hard', email: 'info@test.com', address: {} }),
  seeded: 1,
};

describe('GET /api/club', () => {
  it('returns 400 when X-Club-Slug header is missing', async () => {
    const db = makeDb();
    const ctx = makeContext(getReq('/api/club'), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when club is not found in DB', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'unknown' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(404);
  });

  it('returns club data from DB when seeded=1', async () => {
    const db = makeDb({ first: clubRow });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { name: string; slug: string };
    expect(body.name).toBe('Test FC');
    expect(body.slug).toBe('test-club');
  });

  it('triggers seeding and re-fetches data when seeded=0', async () => {
    const unseededRow = { ...clubRow, seeded: 0, data: null };
    const reseededRow = { ...clubRow, data: JSON.stringify({ slug: 'test-club', name: 'Test FC' }) };
    const db = makeDb({ first: [unseededRow, reseededRow] as unknown });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), {
      env: { DB: db as never, ASSETS: { fetch: async () => new Response('{}', { status: 200 }) } as never },
    });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
  });

  it('uses defaultClub when row.data is null', async () => {
    const db = makeDb({ first: { ...clubRow, data: null } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as { name: string; slug: string };
    expect(body.name).toBe('Test FC');
    expect(body.slug).toBe('test-club');
  });

  it('includes primaryColor in response when set', async () => {
    const db = makeDb({ first: { ...clubRow, primaryColor: '#ff0000' } });
    const ctx = makeContext(getReq('/api/club', { 'X-Club-Slug': 'test-club' }), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as { primaryColor: string };
    expect(body.primaryColor).toBe('#ff0000');
  });
});

describe('PATCH /api/club', () => {
  it('returns 400 when X-Club-Slug header is missing', async () => {
    const db = makeDb();
    const ctx = makeContext(patchReq('/api/club', { name: 'New Name' }), { env: { DB: db as never } });
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when club is not found', async () => {
    const db = makeDb({ first: null });
    const ctx = makeContext(
      patchReq('/api/club', { name: 'New Name' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(404);
  });

  it('updates club data and returns ok', async () => {
    const db = makeDb({ first: { data: JSON.stringify({ slug: 'test-club', name: 'Test FC' }) }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/club', { name: 'Updated FC' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('syncs primaryColor to club_config when primaryColor is in body', async () => {
    const db = makeDb({ first: { data: null }, run: { meta: { changes: 1 } } });
    const ctx = makeContext(
      patchReq('/api/club', { primaryColor: '#00ff00' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as never } },
    );
    const res = await onRequestPatch(ctx as never);
    expect(res.status).toBe(200);
  });
});

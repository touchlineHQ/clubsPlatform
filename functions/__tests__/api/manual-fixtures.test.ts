import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet, onRequestPost, validateManualFixture, MAX_MANUAL_FIXTURES } from '../../api/fixtures';

const CLUB = { 'X-Club-Slug': 'test-club' };

const game = (over: Record<string, unknown> = {}) => ({
  team: 'U12 Reds', date: '2026-11-07', time: '10:00', homeAway: 'home',
  opponent: 'Rivals FC', venue: 'Main Pitch', competition: 'Friendly',
  homeScore: null, awayScore: null, ...over,
});

describe('/api/fixtures (manual fixtures, #78)', () => {
  let sqlite: SqliteDb;
  let db: ReturnType<typeof d1Over>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    sqlite = createSchemaDb();
    db = d1Over(sqlite);
  });
  afterEach(() => sqlite.close());

  const post = (body: unknown) =>
    onRequestPost(makeContext(postReq('/api/fixtures', body, CLUB), { env: { DB: db as any } }) as any);
  const get = async (headers = CLUB) => {
    const res = await onRequestGet(makeContext(getReq('/api/fixtures', headers), { env: { DB: db as any } }) as any);
    return (await res.json() as { items: any[] }).items;
  };

  it('stores entries and returns them to the public GET, ordered by date', async () => {
    const res = await post({ items: [game({ date: '2026-11-14' }), game({ homeScore: 3, awayScore: 1, date: '2026-10-03' })] });
    expect(res.status).toBe(200);
    const items = await get();
    expect(items.map(i => i.date)).toEqual(['2026-10-03', '2026-11-14']);
    expect(items[0]).toMatchObject({ team: 'U12 Reds', homeAway: 'home', homeScore: 3, awayScore: 1 });
    expect(items[1].homeScore).toBeNull();
  });

  it('replaces the whole list and scopes it to the club', async () => {
    await post({ items: [game(), game({ date: '2026-11-14' })] });
    await post({ items: [game({ opponent: 'New Opp' })] });
    expect((await get()).map(i => i.opponent)).toEqual(['New Opp']);
    expect(await get({ 'X-Club-Slug': 'other-club' })).toEqual([]);
  });

  it('inserts in chunks that stay under the 100 bound-parameter cap', async () => {
    const items = Array.from({ length: 50 }, (_, i) => game({ date: `2026-12-${String((i % 28) + 1).padStart(2, '0')}`, opponent: `Opp ${i}` }));
    const spy = vi.spyOn(db, 'prepare');
    await post({ items });
    expect((await get()).length).toBe(50);
    const inserts = spy.mock.calls.filter(c => String(c[0]).includes('INSERT INTO manual_fixture'));
    for (const [sql] of inserts) {
      expect((String(sql).match(/\?/g) ?? []).length).toBeLessThanOrEqual(100);
    }
  });

  it('rejects non-admins', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await post({ items: [game()] });
    expect(res.status).toBe(401);
  });

  it('rejects bad payloads without touching existing rows', async () => {
    await post({ items: [game()] });
    expect((await post({ items: 'nope' })).status).toBe(400);
    expect((await post({ items: [game({ date: '7/11/2026' })] })).status).toBe(400);
    expect((await post({ items: Array.from({ length: MAX_MANUAL_FIXTURES + 1 }, () => game()) })).status).toBe(400);
    expect(await get()).toHaveLength(1);
  });
});

describe('validateManualFixture', () => {
  it('normalises optional fields', () => {
    const v = validateManualFixture({ team: ' Reds ', date: '2026-01-02', homeAway: 'away', opponent: 'Blues' }, 0);
    expect(v).toEqual({ value: { team: 'Reds', date: '2026-01-02', time: '', homeAway: 'away', opponent: 'Blues', venue: '', competition: '', homeScore: null, awayScore: null } });
  });

  it.each([
    [{ ...game(), team: '' }, /team/],
    [{ ...game(), opponent: '' }, /opponent/],
    [{ ...game(), time: '25:00' }, /time/],
    [{ ...game(), homeAway: 'neutral' }, /homeAway/],
    [{ ...game(), homeScore: 2 }, /both scores/],
    [{ ...game(), homeScore: -1, awayScore: 0 }, /whole numbers/],
    [{ ...game(), homeScore: 1.5, awayScore: 0 }, /whole numbers/],
    [{ ...game(), venue: 'x'.repeat(201) }, /venue/],
    [{ ...game(), competition: 'x'.repeat(101) }, /competition/],
    [null, /object/],
  ])('rejects %#', (input, msg) => {
    const v = validateManualFixture(input, 3);
    expect('error' in v && v.error).toMatch(msg);
  });
});

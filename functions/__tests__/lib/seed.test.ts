import { describe, it, expect, vi } from 'vitest';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { seedClubData } from '../../lib/seed';

function makeAssets(data: Record<string, unknown | null>) {
  return {
    fetch: async (url: string | Request) => {
      const u = String(typeof url === 'string' ? url : url.url);
      const key = Object.keys(data).find(k => u.includes(k));
      if (!key || data[key] === null) {
        return new Response('Not found', { status: 404 });
      }
      return new Response(JSON.stringify(data[key]), { status: 200 });
    },
  };
}

function makeDb(changes = 1) {
  const batchMock = vi.fn(async () => []);
  const runMock = vi.fn(async () => ({ results: [], success: true, meta: { changes } }));
  const prepareMock = vi.fn(() => ({
    bind: vi.fn(function () { return this; }),
    run: runMock,
  })) as unknown as D1Database['prepare'];

  return {
    prepare: prepareMock,
    batch: batchMock,
    exec: vi.fn(async () => ({ results: [], count: 0, duration: 0 })),
    batchMock,
    runMock,
  };
}

describe('seedClubData', () => {
  it('returns early without seeding when another request already claimed the slot', async () => {
    const db = makeDb(0); // changes=0 means already seeded
    const assets = makeAssets({});
    await seedClubData(db as unknown as D1Database, 'test-club', 'https://example.com', assets);
    // batch should not be called since changes=0 → early return
    expect(db.batchMock).not.toHaveBeenCalled();
  });

  it('seeds club data from JSON files when seeding slot is claimed', async () => {
    const db = makeDb(1); // changes=1 → first seeder
    const assets = makeAssets({
      'club.json': { slug: 'test-club', name: 'Test FC' },
      'registration.json': { items: [{ icon: 'fa-star', title: 'Season Registration', description: '', link: '#', buttonText: 'Join' }] },
      'gallery.json': { items: [] },
      'matchday.json': { items: [] },
      'news.json': { items: [] },
      'teams.json': { sections: [] },
      'committee.json': { committee: [] },
    });

    await seedClubData(db as unknown as D1Database, 'test-club', 'https://example.com', assets);

    // Should have called prepare for UPDATE club_config.seeded, then UPDATE club_config.data
    expect(db.prepare).toHaveBeenCalled();
    // batch should NOT be called with registration items since registration.json has 1 item
    // (well it should be called with those statements)
    expect(db.batchMock).toHaveBeenCalledOnce();
  });

  it('seeds teams and sections from teams.json', async () => {
    const db = makeDb(1);
    const assets = makeAssets({
      'club.json': null,
      'registration.json': null,
      'gallery.json': null,
      'matchday.json': null,
      'news.json': null,
      'teams.json': {
        sections: [{
          id: 'seniors', name: 'Seniors', subtitle: 'Our senior teams', icon: 'fa-shield-alt',
          teams: [{ name: 'First XI', description: '', manager: 'Bob', coach: 'Alice', contact: 'bob@test.com', slug: 'first-xi', sidebar: false }],
        }],
      },
      'committee.json': { committee: [] },
    });

    await seedClubData(db as unknown as D1Database, 'test-club', 'https://example.com', assets);

    expect(db.batchMock).toHaveBeenCalledOnce();
    const batchArgs = db.batchMock.mock.calls[0][0] as D1PreparedStatement[];
    // Should have section + team = at least 2 prepared statements
    expect(batchArgs.length).toBeGreaterThanOrEqual(2);
  });

  it('handles missing/failing asset files gracefully', async () => {
    const db = makeDb(1);
    const assets = { fetch: async () => new Response('', { status: 500 }) };

    // Should not throw
    await expect(seedClubData(db as unknown as D1Database, 'test-club', 'https://example.com', assets))
      .resolves.toBeUndefined();
  });

  it('skips batch when all asset files are empty/null', async () => {
    const db = makeDb(1);
    const assets = makeAssets({
      'club.json': null,
      'registration.json': null,
      'gallery.json': null,
      'matchday.json': null,
      'news.json': null,
      'teams.json': null,
      'committee.json': null,
    });

    await seedClubData(db as unknown as D1Database, 'test-club', 'https://example.com', assets);
    // No statements to batch since all files returned null
    expect(db.batchMock).not.toHaveBeenCalled();
  });
});

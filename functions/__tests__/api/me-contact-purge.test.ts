import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, memberSession, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestPost as selfPurgePost } from '../../api/me/contact-purge';

const NOW = 1_700_000_000_000;
const CLUB = 'test-club';
const EMAIL = memberSession.user.email;

describe('POST /api/me/contact-purge (#134)', () => {
  let sqlite: SqliteDb;
  const total = 25;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(memberSession);
    sqlite = createSchemaDb();
    for (let i = 0; i < total; i += 1) {
      const n = String(i).padStart(2, '0');
      sqlite.prepare(`INSERT INTO "player" VALUES (?, ?, ?, ?)`).run!(`p_${n}`, `FAN${n}`, NOW, NOW);
      sqlite.prepare(`INSERT INTO "player_contact"
        (id, clubSlug, playerId, email, relationship, state,
         operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
        VALUES (?, ?, ?, ?, 'guardian', 'confirmed', 1, 0, NULL, ?)`).run!(
        `pc_${n}`, CLUB, `p_${n}`, EMAIL, NOW,
      );
    }
    sqlite.prepare(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state,
       operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('pc_other', ?, 'p_00', 'other@example.com', 'guardian', 'pending', 0, 0, NULL, ?)`).run!(CLUB, NOW);
  });

  afterEach(() => sqlite.close());

  const count = () =>
    (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact" WHERE lower(email) = ?`).get(EMAIL) as { n: number }).n;

  it('returns one committed chunk with remaining + cursor and continues to zero', async () => {
    const db = d1Over(sqlite) as any;

    // Empty body starts from the beginning.
    const firstReq = new Request('https://example.com/api/me/contact-purge', { method: 'POST' });
    const firstRes = await selfPurgePost(makeContext(firstReq, { env: { DB: db } }) as any);
    expect(firstRes.status).toBe(200);
    const first = await firstRes.json() as any;
    expect(first.ok).toBe(true);
    expect(first.purgedCount).toBeGreaterThan(0);
    expect(first.purgedCount).toBeLessThan(total);
    expect(first.remaining).toBe(total - first.purgedCount);
    expect(first.cursor).toBe(first.purged[first.purged.length - 1].contactId);
    expect(count()).toBe(first.remaining);

    const seen = new Set<string>(first.purged.map((p: any) => p.contactId));
    let cursor = first.cursor as string | null;
    let remaining = first.remaining as number;
    let calls = 1;
    while (remaining > 0) {
      const res = await selfPurgePost(
        makeContext(postReq('/api/me/contact-purge', { cursor }), { env: { DB: db } }) as any,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.purgedCount).toBeGreaterThan(0);
      for (const p of body.purged) seen.add(p.contactId);
      remaining = body.remaining;
      cursor = body.cursor;
      calls += 1;
      expect(calls).toBeLessThan(10);
    }
    expect(cursor).toBeNull();
    expect(seen.size).toBe(total);
    expect(count()).toBe(0);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact" WHERE id = 'pc_other'`).get() as { n: number }).n,
    ).toBe(1);
  });

  it('rejects a malformed JSON body', async () => {
    const req = new Request('https://example.com/api/me/contact-purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    const res = await selfPurgePost(makeContext(req, { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(res.status).toBe(400);
    expect(count()).toBe(total);
  });
});

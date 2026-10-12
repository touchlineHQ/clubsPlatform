import { describe, it, expect } from 'vitest';
import { attachContactState } from '../../api/admin/registrations';

type Row = { fanId: string; state: string };

/** Fake D1 that records each prepared statement's binds and answers from `rows`. */
function fakeDb(contacts: Row[]) {
  const statements: { sql: string; binds: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          const stmt = { sql, binds };
          statements.push(stmt);
          return stmt;
        },
      };
    },
    async batch(stmts: { binds: unknown[] }[]) {
      return stmts.map(({ binds }) => {
        const ids = new Set(binds.slice(1));
        return { results: contacts.filter((c) => ids.has(c.fanId)) };
      });
    },
  };
  return { db: db as unknown as D1Database, statements };
}

describe('attachContactState', () => {
  it('chunks >100 unique fanIds under the D1 bind cap and keeps best-state ranking', async () => {
    const fanIds = Array.from({ length: 150 }, (_, i) => `fan-${i}`);
    // Duplicate rows per fan to exercise dedupe.
    const rows = [...fanIds, ...fanIds].map((fanId) => ({ fanId }) as never);
    // fan-0 rows are split across the first and last chunk (returned from two results).
    const contacts: Row[] = [
      { fanId: 'fan-0', state: 'withdrawn' },
      { fanId: 'fan-0', state: 'confirmed' },
      { fanId: 'fan-120', state: 'bounced' },
      { fanId: 'fan-120', state: 'pending' },
    ];
    const { db, statements } = fakeDb(contacts);

    const out = await attachContactState(db, 'club-a', rows);

    expect(statements.length).toBeGreaterThan(1);
    for (const s of statements) {
      expect(s.binds.length).toBeLessThanOrEqual(100);
      expect(s.binds[0]).toBe('club-a');
    }
    const named = statements.flatMap((s) => s.binds.slice(1));
    expect(new Set(named).size).toBe(150);
    expect(named.length).toBe(150);

    const byFan = new Map(out.map((r) => [r.fanId, r.contactState]));
    expect(byFan.get('fan-0')).toBe('confirmed');
    expect(byFan.get('fan-120')).toBe('pending');
    expect(byFan.get('fan-5')).toBeNull();
    expect(out).toHaveLength(300);
  });

  it('picks the best state when a fan’s rows come back in different batch results', async () => {
    const fanIds = Array.from({ length: 90 }, (_, i) => `f${i}`);
    const rows = fanIds.map((fanId) => ({ fanId }) as never);
    const { db, statements } = fakeDb([]);
    // Override batch: f1 appears in both results with differing states.
    (db as unknown as { batch: unknown }).batch = async () => [
      { results: [{ fanId: 'f1', state: 'bounced' }] },
      { results: [{ fanId: 'f1', state: 'pending' }] },
    ];
    const out = await attachContactState(db, 'c', rows);
    expect(statements).toHaveLength(2);
    expect(out.find((r) => r.fanId === 'f1')?.contactState).toBe('pending');
  });
});

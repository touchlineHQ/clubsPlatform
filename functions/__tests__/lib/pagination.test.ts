import { describe, it, expect } from 'vitest';
import {
  LIMIT_DEFAULT,
  LIMIT_MAX,
  LIMIT_MIN,
  buildCursorColumn,
  buildKeysetPredicate,
  buildOrderBy,
  decodeCursor,
  encodeCursor,
  fetchLimit,
  parsePageRequest,
  takePage,
  totalTextKey,
  type SortWhitelist,
} from '../../lib/pagination';

const SORTS: SortWhitelist = {
  teamName: { expr: 'pr."teamName"', collate: 'NOCASE', bare: true },
  expiry: { expr: totalTextKey('pr."registrationExpiry"'), collate: 'NOCASE' },
};

const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.value;
};

describe('cursors', () => {
  it('round-trips', () => {
    const cursor = { s: 'teamName', d: 'asc' as const, v: 'U15 Tuesday', id: 'reg_1' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('survives a team name that is not ASCII', () => {
    // btoa throws above code point 255, so the encoder goes through TextEncoder.
    const cursor = { s: 'teamName', d: 'asc' as const, v: 'Beşiktaş U15 — Thursday', id: 'reg_1' };
    expect(decodeCursor(encodeCursor(cursor))?.v).toBe('Beşiktaş U15 — Thursday');
  });

  it('is URL-safe', () => {
    // '+', '/' and '=' do not survive a query string; a '+' decodes to a space
    // and the cursor corrupts silently.
    const encoded = encodeCursor({ s: 'teamName', d: 'asc', v: '??>>??>>', id: 'reg_1' });
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('returns null for anything malformed', () => {
    for (const bad of ['', 'not-base64!!', encodeCursor({} as never), btoa('{"s":1}')]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });

  it('rejects a payload whose fields are the wrong type', () => {
    const encoded = encodeCursor({ s: 'teamName', d: 'sideways', v: 'x', id: 'y' } as never);
    expect(decodeCursor(encoded)).toBeNull();
  });
});

describe('parsePageRequest', () => {
  it('rejects an unknown sort key rather than interpolating it', () => {
    const res = parsePageRequest({ sort: "teamName'; DROP TABLE" }, SORTS, { sort: 'teamName' });
    expect(res).toEqual({ ok: false, error: 'unknown sort key' });
  });

  it('rejects an invalid direction', () => {
    const res = parsePageRequest({ dir: 'sideways' }, SORTS, { sort: 'teamName' });
    expect(res).toEqual({ ok: false, error: 'invalid sort direction' });
  });

  it('clamps limit at both ends and defaults a missing one', () => {
    const limitOf = (limit: unknown) =>
      ok(parsePageRequest({ limit: limit as never }, SORTS, { sort: 'teamName' })).limit;

    expect(limitOf(0)).toBe(LIMIT_MIN);
    expect(limitOf(-5)).toBe(LIMIT_MIN);
    expect(limitOf(5000)).toBe(LIMIT_MAX);
    expect(limitOf('75')).toBe(75);
    expect(limitOf('not a number')).toBe(LIMIT_DEFAULT);
    expect(limitOf(null)).toBe(LIMIT_DEFAULT);
    // `?limit=` is absent, not zero: Number('') is 0 and 0 is finite, so
    // without the guard this pages one row at a time.
    expect(limitOf('')).toBe(LIMIT_DEFAULT);
    expect(limitOf('   ')).toBe(LIMIT_DEFAULT);
  });

  it('rejects a cursor minted under a different sort', () => {
    // Honouring it would skip an arbitrary slice of the set, with nothing on
    // screen to say so.
    const cursor = encodeCursor({ s: 'expiry', d: 'asc', v: 'x', id: 'reg_1' });
    const res = parsePageRequest({ sort: 'teamName', cursor }, SORTS, { sort: 'teamName' });
    expect(res).toEqual({ ok: false, error: 'cursor does not match the requested sort' });
  });

  it('rejects a cursor minted under a different direction', () => {
    const cursor = encodeCursor({ s: 'teamName', d: 'desc', v: 'x', id: 'reg_1' });
    const res = parsePageRequest({ sort: 'teamName', dir: 'asc', cursor }, SORTS, { sort: 'teamName' });
    expect(res).toEqual({ ok: false, error: 'cursor does not match the requested direction' });
  });

  it('rejects a malformed cursor', () => {
    const res = parsePageRequest({ cursor: 'garbage!!' }, SORTS, { sort: 'teamName' });
    expect(res).toEqual({ ok: false, error: 'malformed cursor' });
  });

  it('accepts a matching cursor', () => {
    const cursor = encodeCursor({ s: 'teamName', d: 'asc', v: 'U15', id: 'reg_1' });
    expect(ok(parsePageRequest({ cursor }, SORTS, { sort: 'teamName' })).cursor)
      .toEqual({ s: 'teamName', d: 'asc', v: 'U15', id: 'reg_1' });
  });
});

describe('keyset predicate', () => {
  it('emits nothing on page 1', () => {
    const req = ok(parsePageRequest({}, SORTS, { sort: 'teamName' }));
    expect(buildKeysetPredicate(req, SORTS, 'pr."id"')).toEqual({ sql: '', bindings: [] });
  });

  it('binds the value twice and the id once, never interpolating', () => {
    const cursor = encodeCursor({ s: 'teamName', d: 'asc', v: "O'Brien FC", id: 'reg_9' });
    const req = ok(parsePageRequest({ cursor }, SORTS, { sort: 'teamName' }));
    const frag = buildKeysetPredicate(req, SORTS, 'pr."id"');

    expect(frag.bindings).toEqual(["O'Brien FC", "O'Brien FC", 'reg_9']);
    expect(frag.sql).not.toContain("O'Brien");
    expect(frag.sql.match(/\?/g)).toHaveLength(3);
  });

  it('uses the expanded form, not a row-value comparison', () => {
    // Row values need SQLite >= 3.15 and D1's version is pinned nowhere here.
    const cursor = encodeCursor({ s: 'teamName', d: 'asc', v: 'x', id: 'reg_1' });
    const req = ok(parsePageRequest({ cursor }, SORTS, { sort: 'teamName' }));
    const { sql } = buildKeysetPredicate(req, SORTS, 'pr."id"');

    expect(sql).toContain('OR (');
    expect(sql).not.toMatch(/\(\s*pr\."teamName"\s*,/);
  });

  it('flips both comparisons when descending', () => {
    const cursor = encodeCursor({ s: 'teamName', d: 'desc', v: 'x', id: 'reg_1' });
    const req = ok(parsePageRequest({ dir: 'desc', cursor }, SORTS, { sort: 'teamName' }));
    const { sql } = buildKeysetPredicate(req, SORTS, 'pr."id"');

    expect(sql.match(/</g)).toHaveLength(2);
    expect(sql).not.toContain('>');
  });
});

describe('order by', () => {
  it('repeats a bare column so an index can still satisfy it', () => {
    const req = ok(parsePageRequest({ sort: 'teamName' }, SORTS, { sort: 'teamName' }));
    expect(buildOrderBy(req, SORTS, { idAlias: 'pr."id"' }))
      .toBe('ORDER BY pr."teamName" COLLATE NOCASE ASC, pr."id" ASC');
  });

  it('references the alias for a computed key', () => {
    const req = ok(parsePageRequest({ sort: 'expiry' }, SORTS, { sort: 'teamName' }));
    expect(buildOrderBy(req, SORTS, { idAlias: 'pr."id"' }))
      .toBe('ORDER BY "__cursor" COLLATE NOCASE ASC, pr."id" ASC');
  });

  it('points the tiebreak the same way as the sort', () => {
    // A fixed ASC tiebreak under a DESC sort makes ORDER BY and the keyset
    // predicate disagree, and rows fall through the gap between pages.
    const req = ok(parsePageRequest({ dir: 'desc' }, SORTS, { sort: 'teamName' }));
    expect(buildOrderBy(req, SORTS, { idAlias: 'pr."id"' })).toMatch(/pr\."id" DESC$/);
  });
});

describe('totalTextKey', () => {
  it('never yields NULL, which would empty the page rather than mis-order it', () => {
    expect(totalTextKey('x')).toContain("COALESCE(x, '')");
    expect(totalTextKey('x')).toContain("THEN '1' ELSE '0'");
  });
});

describe('takePage', () => {
  const rows = Array.from({ length: 4 }, (_, i) => ({ id: `reg_${i}`, v: `team ${i}` }));
  const req = ok(parsePageRequest({ limit: 3 }, SORTS, { sort: 'teamName' }));

  it('asks for one more than it returns', () => {
    expect(fetchLimit(req)).toBe(4);
  });

  it('drops the probe row and mints a cursor from the last row it kept', () => {
    const { items, nextCursor } = takePage(rows, req, (r) => r);

    expect(items).toHaveLength(3);
    expect(items.at(-1)!.id).toBe('reg_2');
    // reg_2, the last row RETURNED — not reg_3, the probe the caller never sees.
    expect(decodeCursor(nextCursor!)).toEqual({ s: 'teamName', d: 'asc', v: 'team 2', id: 'reg_2' });
  });

  it('reports no next page when the probe row does not come back', () => {
    const { items, nextCursor } = takePage(rows.slice(0, 3), req, (r) => r);
    expect(items).toHaveLength(3);
    expect(nextCursor).toBeNull();
  });

  it('handles an empty result', () => {
    expect(takePage([], req, (r: { id: string; v: string }) => r))
      .toEqual({ items: [], nextCursor: null });
  });
});

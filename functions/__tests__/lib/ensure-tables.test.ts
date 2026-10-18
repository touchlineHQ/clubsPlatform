import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { TABLE_STATEMENTS } from '../../lib/ensure-tables';

// Note: test-utils mocks ensure-tables globally, but this dedicated test
// file does NOT import test-utils, so the real module is used.

describe('ensureTables', () => {
  let ensureTables: (db: D1Database) => Promise<void>;

  beforeEach(async () => {
    // Reset module registry to clear the singleton promise cache
    vi.resetModules();
    const mod = await import('../../lib/ensure-tables');
    ensureTables = mod.ensureTables;
  });

  it('includes the player_contact table in TABLE_STATEMENTS', () => {
    expect(TABLE_STATEMENTS.some((s) => /CREATE TABLE IF NOT EXISTS "player_contact"/.test(s))).toBe(true);
    expect(TABLE_STATEMENTS.some((s) => /operationalOptIn/.test(s) && /marketingOptIn/.test(s))).toBe(true);
  });

  it('calls db.exec once with all SQL statements on first invocation', async () => {
    const execMock = vi.fn(async () => ({ results: [], count: 0, duration: 0 }));
    const runMock = vi.fn(async () => ({ results: [], success: true, meta: { changes: 0 } }));
    const db = {
      exec: execMock,
      prepare: vi.fn(() => ({ run: runMock, bind: vi.fn(() => ({ run: runMock })) })),
    } as unknown as D1Database;

    await ensureTables(db);
    expect(execMock).toHaveBeenCalledOnce();
    // Column migrations run individually via prepare().run()
    expect(runMock.mock.calls.length).toBeGreaterThan(0);
  });

  it('returns the cached promise on subsequent calls (does not call exec again)', async () => {
    const execMock = vi.fn(async () => ({ results: [], count: 0, duration: 0 }));
    const runMock = vi.fn(async () => ({ results: [], success: true, meta: { changes: 0 } }));
    const db = {
      exec: execMock,
      prepare: vi.fn(() => ({ run: runMock, bind: vi.fn(() => ({ run: runMock })) })),
    } as unknown as D1Database;

    await ensureTables(db);
    await ensureTables(db); // second call
    expect(execMock).toHaveBeenCalledOnce(); // still only once
  });

  it('resets cache when db.exec throws, allowing retry on next call', async () => {
    let callCount = 0;
    const execMock = vi.fn(async () => {
      callCount++;
      if (callCount === 1) throw new Error('D1 exec failed');
      return { results: [], count: 0, duration: 0 };
    });
    const runMock = vi.fn(async () => ({ results: [], success: true, meta: { changes: 0 } }));
    const db = {
      exec: execMock,
      prepare: vi.fn(() => ({ run: runMock, bind: vi.fn(() => ({ run: runMock })) })),
    } as unknown as D1Database;

    await expect(ensureTables(db)).rejects.toThrow('D1 exec failed');
    // After error, cache is reset, so a second call retries
    await ensureTables(db);
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('retries db.exec on a transient D1 error instead of failing the request (#251)', async () => {
    const execMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('D1_ERROR: Network connection lost.'))
      .mockResolvedValue({ results: [], count: 0, duration: 0 });
    const runMock = vi.fn(async () => ({ results: [], success: true, meta: { changes: 0 } }));
    const db = {
      exec: execMock,
      prepare: vi.fn(() => ({ run: runMock, bind: vi.fn(() => ({ run: runMock })) })),
    } as unknown as D1Database;

    await expect(ensureTables(db)).resolves.toBeUndefined();
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry db.exec on a non-transient error', async () => {
    const execMock = vi.fn(async () => { throw new Error('D1_ERROR: near "x": syntax error'); });
    const db = { exec: execMock, prepare: vi.fn() } as unknown as D1Database;

    await expect(ensureTables(db)).rejects.toThrow('syntax error');
    expect(execMock).toHaveBeenCalledOnce();
  });
});

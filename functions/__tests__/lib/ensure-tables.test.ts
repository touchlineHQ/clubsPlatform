import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';

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
});

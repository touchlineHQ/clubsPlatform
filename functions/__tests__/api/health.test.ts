import { describe, it, expect } from 'vitest';
import { makeDb, makeContext, makeEnv, getReq } from '../test-utils';
import { onRequestGet } from '../../api/health';

describe('GET /api/health', () => {
  it('returns 200 with d1_bound=true when DB is present', async () => {
    const db = makeDb({
      all: [
        [{ name: '_migrations' }],
        [{ name: '_migrations_test', applied_at: 1234567890 }],
        [{ name: '_migrations' }, { name: '_health_test' }],
        [{ name: '_migrations' }],
      ] as unknown[],
    });
    const ctx = makeContext(getReq('/api/health'), { env: { DB: db as never } });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body.d1_bound).toBe(true);
  });

  it('returns 200 with has_auth_secret=true when BETTER_AUTH_SECRET is set', async () => {
    const db = makeDb({
      all: [[], [], [], []] as unknown[],
    });
    const ctx = makeContext(getReq('/api/health'), {
      env: { DB: db as never, BETTER_AUTH_SECRET: 'my-secret' } as never,
    });
    const res = await onRequestGet(ctx as never);
    const body = await res.json() as Record<string, unknown>;
    expect(body.has_auth_secret).toBe(true);
  });

  it('returns 200 even when DB prepare throws', async () => {
    const badDb = {
      exec: async () => ({ results: [], count: 0, duration: 0 }),
      prepare: () => ({
        all: async () => { throw new Error('DB error'); },
        first: async () => null,
        run: async () => ({ results: [], success: true }),
        bind: () => ({
          all: async () => { throw new Error('DB error'); },
          first: async () => null,
          run: async () => ({ results: [], success: true }),
        }),
      }),
      batch: async () => [],
    };
    const ctx = makeContext(getReq('/api/health'), { env: { DB: badDb as never } });
    const res = await onRequestGet(ctx as never);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.tables_error).toBeTruthy();
  });
});

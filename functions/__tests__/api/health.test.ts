import { describe, it, expect, vi, afterEach } from 'vitest';
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

  describe('when D1 calls throw', () => {
    afterEach(() => vi.restoreAllMocks());

    const secret = 'D1_ERROR: secret internal detail';
    const throwingDb = () => {
      const boom = async () => { throw new Error(secret); };
      return {
        exec: boom,
        prepare: () => ({ all: boom, first: boom, run: boom, bind: () => ({ all: boom, first: boom, run: boom }) }),
        batch: boom,
      };
    };

    it('returns generic failure flags with no error text or stack, and logs the error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const ctx = makeContext(getReq('/api/health'), { env: { DB: throwingDb() as never } });
      const res = await onRequestGet(ctx as never);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(secret);
      expect(text).not.toContain('D1_ERROR');
      expect(text).not.toMatch(/\bat .*:\d+:\d+/);
      const body = JSON.parse(text) as Record<string, any>;
      const failureFields = [
        'tables_error',
        'migrations_error',
        'exec_test',
        'tables_after_test_error',
        'user_table_exec',
        'tables_final_error',
      ];
      for (const field of failureFields) {
        expect(body).toHaveProperty(field);
        const value = JSON.stringify(body[field]);
        expect(value).not.toContain(secret);
        expect(value).not.toContain('D1_ERROR');
        expect(value).not.toMatch(/\bat .*:\d+:\d+/);
      }
      expect(body.exec_test).toMatchObject({ success: false });
      expect(body.user_table_exec).toMatchObject({ success: false });
      const checks = ['tables', 'migrations', 'exec_test', 'tables_after_test', 'user_table_exec', 'tables_final'];
      for (const check of checks) {
        const logged = errSpy.mock.calls.some(
          ([message, error]) =>
            message === `[health] ${check} check failed` && error instanceof Error && error.message === secret,
        );
        expect(logged, `missing log for ${check}`).toBe(true);
      }
    });
  });
});

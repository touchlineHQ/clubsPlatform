import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeContext, getReq } from '../test-utils';
import { onRequestGet } from '../../api/health';

type Probe = () => Promise<unknown>;

/** A D1 stub that records every SQL statement and exec call. */
function spyDb(first: Probe = async () => ({ 1: 1 })) {
  const prepared: string[] = [];
  const exec = vi.fn(async () => ({ count: 0, duration: 0 }));
  const batch = vi.fn(async () => []);
  const db = {
    exec,
    batch,
    prepare: (sql: string) => {
      prepared.push(sql);
      const stmt = {
        first,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
        bind: () => stmt,
      };
      return stmt;
    },
  };
  return { db, prepared, exec, batch };
}

/** Overrides are merged over makeEnv's defaults; pass `undefined` to unset one. */
async function call(env: Record<string, unknown>) {
  const ctx = makeContext(getReq('/api/health'), { env: env as never });
  const res = await onRequestGet(ctx as never);
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, any> };
}

describe('GET /api/health', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns 200 ok when D1 answers and auth is configured', async () => {
    const { db } = spyDb();
    const { res, body } = await call({ DB: db, BETTER_AUTH_SECRET: 'super-secret-value' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(body).toEqual({ status: 'ok', checks: { d1: 'ok', auth_configured: true } });
  });

  it('reports auth_configured=false when the secret is unset', async () => {
    const { db } = spyDb();
    const { res, body } = await call({ DB: db, BETTER_AUTH_SECRET: undefined });
    expect(res.status).toBe(200);
    expect(body.checks.auth_configured).toBe(false);
  });

  it('exposes no secret length, token presence, table names or migrations', async () => {
    const { db } = spyDb();
    const { text, body } = await call({
      DB: db,
      BETTER_AUTH_SECRET: 'super-secret-value',
      GITHUB_TOKEN: 'ghp_example',
    });
    expect(Object.keys(body).sort()).toEqual(['checks', 'status']);
    expect(Object.keys(body.checks).sort()).toEqual(['auth_configured', 'd1']);
    for (const leaked of [
      'auth_secret_length',
      'has_github_token',
      'tables',
      'migrations',
      '_migrations',
      'super-secret-value',
      'ghp_example',
      String('super-secret-value'.length),
    ]) {
      expect(text).not.toContain(leaked);
    }
  });

  it('only runs a read-only probe: no exec, batch or DDL', async () => {
    const { db, prepared, exec, batch } = spyDb();
    await call({ DB: db, BETTER_AUTH_SECRET: 'x' });
    expect(exec).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
    expect(prepared).toEqual(['SELECT 1']);
  });

  it('returns 503 degraded with d1=unbound when DB is missing', async () => {
    const { res, body } = await call({ DB: undefined, BETTER_AUTH_SECRET: 'x' });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'degraded', checks: { d1: 'unbound', auth_configured: true } });
  });

  it('returns 503 with no error text when the D1 probe throws, and logs the error', async () => {
    const secret = 'D1_ERROR: secret internal detail';
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db } = spyDb(async () => {
      throw new Error(secret);
    });
    const { res, text, body } = await call({ DB: db, BETTER_AUTH_SECRET: undefined });
    expect(res.status).toBe(503);
    expect(body).toEqual({ status: 'degraded', checks: { d1: 'error', auth_configured: false } });
    expect(text).not.toContain('D1_ERROR');
    expect(text).not.toMatch(/\bat .*:\d+:\d+/);
    expect(
      errSpy.mock.calls.some(
        ([message, error]) =>
          message === '[health] d1 check failed' && error instanceof Error && error.message === secret,
      ),
    ).toBe(true);
  });
});

import { vi } from 'vitest';
import type { Env } from '../lib/api-helpers';
import type { D1Database } from '@cloudflare/workers-types';

// ─── Mock ensure-tables globally ─────────────────────────────────────────────
vi.mock('../lib/ensure-tables', () => ({ ensureTables: vi.fn(async () => {}) }));

// ─── Env builder ─────────────────────────────────────────────────────────────
export const TEST_ENCRYPTION_KEY =
  'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: makeDb() as unknown as D1Database,
    ASSETS: { fetch: async () => new Response() },
    BETTER_AUTH_SECRET: 'test-secret',
    SECRETS_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    SECRETS_TRANSPORT_PRIVATE_KEY: '',
    SECRETS_TRANSPORT_PUBLIC_KEY: '',
    ...overrides,
  };
}

// ─── D1 mock builder ──────────────────────────────────────────────────────────
export interface DbConfig {
  /** Rows returned by .all() — can be an array or a queue (array of arrays). */
  all?: unknown[] | unknown[][];
  /** Row returned by .first() — can be a value or a queue. */
  first?: unknown | unknown[];
  /** Meta returned by .run() */
  run?: { meta?: { changes?: number } };
  /** Results returned by .batch() */
  batch?: unknown[][];
}

function dequeue<T>(store: T | T[]): () => T {
  if (!Array.isArray(store)) return () => store;
  const q = [...store] as T[];
  return () => (q.length > 1 ? (q.shift() as T) : (q[0] as T));
}

export function makeDb(config: DbConfig = {}): Partial<D1Database> {
  const nextAll = dequeue(config.all ?? []);
  const nextFirst = dequeue(config.first ?? null);
  const runMeta = config.run ?? { meta: { changes: 1 } };
  const batchResults = config.batch ?? [];
  let batchIdx = 0;

  return {
    exec: vi.fn(async () => ({ results: [], count: 0, duration: 0 })) as unknown as D1Database['exec'],
    prepare: vi.fn(() => {
      const boundObj = {
        all: vi.fn(async () => ({ results: nextAll(), success: true, meta: {} })),
        first: vi.fn(async () => nextFirst()),
        run: vi.fn(async () => ({ results: [], success: true, ...runMeta })),
      };
      return {
        // Direct (no-bind) calls — forwards to the same queue
        all: vi.fn(async () => ({ results: nextAll(), success: true, meta: {} })),
        first: vi.fn(async () => nextFirst()),
        run: vi.fn(async () => ({ results: [], success: true, ...runMeta })),
        bind: vi.fn(() => boundObj),
      };
    }) as unknown as D1Database['prepare'],
    batch: vi.fn(async () => {
      const r = batchResults[batchIdx] ?? [];
      batchIdx++;
      return r.map((results) => ({ results, success: true, meta: {} }));
    }) as unknown as D1Database['batch'],
  };
}

// ─── Session builders ─────────────────────────────────────────────────────────
type UserRole = 'admin' | 'manager' | 'member';

function makeSession(role: UserRole, clubSlug: string | null = 'test-club') {
  return {
    user: {
      id: 'user_1',
      name: 'Test User',
      email: 'test@example.com',
      role,
      clubSlug,
    },
    session: { id: 'sess_1', userId: 'user_1', expiresAt: new Date(Date.now() + 86400_000) },
  };
}

export const adminSession = makeSession('admin', 'test-club');
export const managerSession = makeSession('manager', 'test-club');
export const memberSession = makeSession('member', 'test-club');
export const platformAdminSession = makeSession('admin', null);

// ─── Context builder ──────────────────────────────────────────────────────────
export function makeContext(
  request: Request,
  overrides: Partial<{ env: Partial<Env>; params: Record<string, string> }> = {},
) {
  return {
    request,
    env: makeEnv(overrides.env ?? {}),
    params: overrides.params ?? {},
    data: {},
    next: async () => new Response(),
  };
}

// ─── Request builders ─────────────────────────────────────────────────────────
export function getReq(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, { headers });
}

export function postReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function patchReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

export function deleteReq(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, { method: 'DELETE', headers });
}

export function putReq(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://example.com${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

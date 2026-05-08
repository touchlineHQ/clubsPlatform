import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  json,
  nowMs,
  randomId,
  isMultiClubMode,
  isPitchBookingsEnabled,
  getClubSlug,
  requireAdmin,
  requireManagerOrAdmin,
  requireAuth,
  type Env,
} from '../../lib/api-helpers';

// Mock createAuth so we can control getSession in auth-gating tests
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(),
}));

import { createAuth } from '../../lib/auth';
const mockCreateAuth = vi.mocked(createAuth);

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as Env['DB'],
    ASSETS: { fetch: async () => new Response() },
    BETTER_AUTH_SECRET: 'secret',
    SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
    SECRETS_TRANSPORT_PRIVATE_KEY: '',
    SECRETS_TRANSPORT_PUBLIC_KEY: '',
    ...overrides,
  };
}

function makeContext(
  session: unknown,
  userOverrides: Record<string, unknown> = {},
  envOverrides: Partial<Env> = {},
  headerOverrides: Record<string, string> = {},
) {
  const user = { role: 'member', clubSlug: null, ...userOverrides };
  const getSession = session ? vi.fn().mockResolvedValue({ user }) : vi.fn().mockResolvedValue(null);
  mockCreateAuth.mockReturnValue({ api: { getSession } } as ReturnType<typeof createAuth>);

  const headers = new Headers(headerOverrides);
  return {
    request: new Request('https://example.com/api/test', { headers }),
    env: makeEnv(envOverrides),
    params: {},
    waitUntil: vi.fn(),
    next: vi.fn(),
    data: {},
    passThroughOnException: vi.fn(),
    functionPath: '',
  } as unknown as EventContext<Env, string, unknown>;
}

// ─── json ────────────────────────────────────────────────────────────────────

describe('json', () => {
  it('returns a Response with JSON content-type', () => {
    const res = json({ ok: true });
    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('serialises the payload', async () => {
    const res = json({ value: 42 });
    expect(await res.json()).toEqual({ value: 42 });
  });

  it('forwards status code', () => {
    expect(json({}, { status: 404 }).status).toBe(404);
  });

  it('merges extra headers', () => {
    const res = json({}, { headers: { 'X-Custom': 'yes' } });
    expect(res.headers.get('X-Custom')).toBe('yes');
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});

// ─── nowMs ───────────────────────────────────────────────────────────────────

describe('nowMs', () => {
  it('returns a number close to Date.now()', () => {
    const before = Date.now();
    const result = nowMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });
});

// ─── randomId ────────────────────────────────────────────────────────────────

describe('randomId', () => {
  it('returns a string starting with the given prefix', () => {
    expect(randomId('team')).toMatch(/^team_/);
  });

  it('appends a UUID-shaped suffix', () => {
    const id = randomId('x');
    // UUID: 8-4-4-4-12 hex chars
    expect(id).toMatch(/^x_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('produces unique values each call', () => {
    const ids = new Set(Array.from({ length: 10 }, () => randomId('p')));
    expect(ids.size).toBe(10);
  });
});

// ─── isMultiClubMode ─────────────────────────────────────────────────────────

describe('isMultiClubMode', () => {
  it.each([['1'], ['true'], ['yes'], ['on']])('returns true for MULTI_CLUB=%s', (v) => {
    expect(isMultiClubMode(makeEnv({ MULTI_CLUB: v }))).toBe(true);
  });

  it.each([['0'], ['false'], [undefined]])('returns false for MULTI_CLUB=%s', (v) => {
    expect(isMultiClubMode(makeEnv({ MULTI_CLUB: v }))).toBe(false);
  });
});

// ─── isPitchBookingsEnabled ───────────────────────────────────────────────────

describe('isPitchBookingsEnabled', () => {
  it.each([['1'], ['true'], ['enabled']])('returns true for PITCH_BOOKINGS=%s', (v) => {
    expect(isPitchBookingsEnabled(makeEnv({ PITCH_BOOKINGS: v }))).toBe(true);
  });

  it.each([['0'], ['false'], [undefined]])('returns false for PITCH_BOOKINGS=%s', (v) => {
    expect(isPitchBookingsEnabled(makeEnv({ PITCH_BOOKINGS: v }))).toBe(false);
  });
});

// ─── getClubSlug ─────────────────────────────────────────────────────────────

describe('getClubSlug', () => {
  it('extracts the X-Club-Slug header', () => {
    const req = new Request('https://example.com', {
      headers: { 'X-Club-Slug': 'my-club' },
    });
    expect(getClubSlug(req)).toBe('my-club');
  });

  it('returns null when header is absent', () => {
    expect(getClubSlug(new Request('https://example.com'))).toBeNull();
  });
});

// ─── requireAdmin ────────────────────────────────────────────────────────────

describe('requireAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const ctx = makeContext(null);
    const result = await requireAdmin(ctx);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(401);
  });

  it('returns 403 when role is not admin', async () => {
    const ctx = makeContext(true, { role: 'member' });
    const result = await requireAdmin(ctx);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(403);
  });

  it('returns session when role is admin', async () => {
    const ctx = makeContext(true, { role: 'admin', clubSlug: null });
    const result = await requireAdmin(ctx);
    expect('session' in result).toBe(true);
  });

  it('returns 403 when admin club does not match request club (multi-club)', async () => {
    const ctx = makeContext(
      true,
      { role: 'admin', clubSlug: 'club-a' },
      { MULTI_CLUB: 'true' },
      { 'X-Club-Slug': 'club-b' },
    );
    const result = await requireAdmin(ctx);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(403);
  });

  it('allows platform superadmin (null clubSlug) to access any club (multi-club)', async () => {
    const ctx = makeContext(
      true,
      { role: 'admin', clubSlug: null },
      { MULTI_CLUB: 'true' },
      { 'X-Club-Slug': 'any-club' },
    );
    const result = await requireAdmin(ctx);
    expect('session' in result).toBe(true);
  });
});

// ─── requireManagerOrAdmin ───────────────────────────────────────────────────

describe('requireManagerOrAdmin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const result = await requireManagerOrAdmin(makeContext(null));
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(401);
  });

  it('returns 403 when role is member', async () => {
    const result = await requireManagerOrAdmin(makeContext(true, { role: 'member' }));
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(403);
  });

  it.each(['manager', 'admin'])('returns session when role is %s', async (role) => {
    const result = await requireManagerOrAdmin(makeContext(true, { role, clubSlug: null }));
    expect('session' in result).toBe(true);
    if ('session' in result) expect(result.role).toBe(role);
  });

  it('returns 403 on club mismatch (multi-club)', async () => {
    const ctx = makeContext(
      true,
      { role: 'manager', clubSlug: 'club-a' },
      { MULTI_CLUB: 'true' },
      { 'X-Club-Slug': 'club-b' },
    );
    const result = await requireManagerOrAdmin(ctx);
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(403);
  });
});

// ─── requireAuth ─────────────────────────────────────────────────────────────

describe('requireAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const result = await requireAuth(makeContext(null));
    expect('error' in result).toBe(true);
    if ('error' in result) expect(result.error.status).toBe(401);
  });

  it.each(['member', 'manager', 'admin'])('returns session for role %s', async (role) => {
    const result = await requireAuth(makeContext(true, { role }));
    expect('session' in result).toBe(true);
    if ('session' in result) expect(result.role).toBe(role);
  });
});

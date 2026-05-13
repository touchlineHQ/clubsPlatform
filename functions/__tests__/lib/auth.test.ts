import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPwd, verifyPwd, createAuth } from '../../lib/auth';

// Mock better-auth so createAuth returns the raw config object.
// This lets us inspect and call databaseHooks without a real DB or session layer.
vi.mock('better-auth', () => ({
  betterAuth: vi.fn((config: unknown) => config),
}));

import { betterAuth } from 'better-auth';
const mockBetterAuth = vi.mocked(betterAuth);

// ─── hashPwd ─────────────────────────────────────────────────────────────────

describe('hashPwd', () => {
  it('returns a string starting with "pbkdf2$"', async () => {
    expect(await hashPwd('mypassword')).toMatch(/^pbkdf2\$/);
  });

  it('produces a 48-byte payload (16 salt + 32 derived)', async () => {
    const hash = await hashPwd('test');
    const payload = atob(hash.slice(7));
    expect(payload.length).toBe(48);
  });

  it('produces different hashes for the same password (random salt)', async () => {
    expect(await hashPwd('same')).not.toBe(await hashPwd('same'));
  });

  it('produces different hashes for different passwords', async () => {
    expect(await hashPwd('password1')).not.toBe(await hashPwd('password2'));
  });
});

// ─── verifyPwd ───────────────────────────────────────────────────────────────

describe('verifyPwd', () => {
  it('returns true when the password matches the hash', async () => {
    const hash = await hashPwd('correct-horse-battery-staple');
    expect(await verifyPwd({ hash, password: 'correct-horse-battery-staple' })).toBe(true);
  });

  it('returns false when the password does not match', async () => {
    const hash = await hashPwd('correct-password');
    expect(await verifyPwd({ hash, password: 'wrong-password' })).toBe(false);
  });

  it('returns false for a hash without the pbkdf2$ prefix', async () => {
    expect(await verifyPwd({ hash: 'bcrypt$garbage', password: 'any' })).toBe(false);
  });

  it('returns false for a completely invalid hash string', async () => {
    expect(await verifyPwd({ hash: 'not-a-hash', password: 'any' })).toBe(false);
  });
});

// ─── createAuth ──────────────────────────────────────────────────────────────

describe('createAuth', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeDb(userCount: number) {
    const run = vi.fn().mockResolvedValue(undefined);
    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('COUNT')) {
          return { first: vi.fn().mockResolvedValue({ c: userCount }) };
        }
        return { bind: vi.fn(() => ({ run })) };
      }),
      run,
    };
    return { db, run };
  }

  it('calls betterAuth with emailAndPassword enabled', () => {
    const { db } = makeDb(0);
    createAuth({ DB: db as unknown as D1Database, BETTER_AUTH_SECRET: 'test-secret' });
    expect(mockBetterAuth).toHaveBeenCalledOnce();
    const config = mockBetterAuth.mock.calls[0][0] as Record<string, unknown>;
    expect((config.emailAndPassword as Record<string, unknown>).enabled).toBe(true);
  });

  it('first user creation triggers admin role upgrade', async () => {
    const { db, run } = makeDb(1);
    const config = createAuth({
      DB: db as unknown as D1Database,
      BETTER_AUTH_SECRET: 'test-secret',
    }) as unknown as {
      databaseHooks: { user: { create: { after: (u: { id: string }) => Promise<void> } } };
    };
    await config.databaseHooks.user.create.after({ id: 'user-1' });
    expect(run).toHaveBeenCalled();
  });

  it('subsequent user creation does NOT trigger admin role upgrade', async () => {
    const { db, run } = makeDb(2);
    const config = createAuth({
      DB: db as unknown as D1Database,
      BETTER_AUTH_SECRET: 'test-secret',
    }) as unknown as {
      databaseHooks: { user: { create: { after: (u: { id: string }) => Promise<void> } } };
    };
    await config.databaseHooks.user.create.after({ id: 'user-2' });
    expect(run).not.toHaveBeenCalled();
  });
});

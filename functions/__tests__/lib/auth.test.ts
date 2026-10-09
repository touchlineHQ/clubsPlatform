import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashPwd, hashSeededPwd, isSeededHash, verifyPwd, createAuth } from '../../lib/auth';

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

// ─── seeded hashes ───────────────────────────────────────────────────────────

describe('hashSeededPwd', () => {
  it('is tagged apart from a full-strength hash', async () => {
    const seeded = await hashSeededPwd('FAN001');
    expect(seeded).toMatch(/^pbkdf2-seed\$/);
    expect(isSeededHash(seeded)).toBe(true);
    expect(isSeededHash(await hashPwd('FAN001'))).toBe(false);
  });

  it('is still salted, so two accounts on one FAN do not share a hash', async () => {
    expect(await hashSeededPwd('FAN001')).not.toBe(await hashSeededPwd('FAN001'));
  });

  it('verifies, and rejects the wrong password', async () => {
    const hash = await hashSeededPwd('FAN001');
    expect(await verifyPwd({ hash, password: 'FAN001' })).toBe(true);
    expect(await verifyPwd({ hash, password: 'FAN002' })).toBe(false);
  });

  it('is not interchangeable with a full-strength hash of the same password', async () => {
    // The rounds differ, so a hash read at the wrong strength must not verify.
    const seeded = await hashSeededPwd('FAN001');
    const full = await hashPwd('FAN001');
    expect(await verifyPwd({ hash: seeded.replace('pbkdf2-seed$', 'pbkdf2$'), password: 'FAN001' }))
      .toBe(false);
    expect(await verifyPwd({ hash: full.replace('pbkdf2$', 'pbkdf2-seed$'), password: 'FAN001' }))
      .toBe(false);
  });

  it('costs a fraction of a full-strength hash', async () => {
    // The whole point: 100k rounds per account is what exhausted the Worker.
    await hashPwd('warm'); await hashSeededPwd('warm');
    const time = async (fn: () => Promise<unknown>) => {
      const t = performance.now();
      for (let i = 0; i < 20; i++) await fn();
      return (performance.now() - t) / 20;
    };
    const full = await time(() => hashPwd('FAN001'));
    const seeded = await time(() => hashSeededPwd('FAN001'));
    expect(seeded).toBeLessThan(full / 10);
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

// ─── lazy hashing: the upgrade at first sign-in ──────────────────────────────

describe('createAuth — a seeded password is re-hashed on the first sign-in', () => {
  beforeEach(() => vi.clearAllMocks());

  /** The verify hook better-auth is configured with, plus the DB it writes to. */
  function signIn() {
    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    createAuth({ DB: { prepare } as any, BETTER_AUTH_SECRET: 's' });
    const config = mockBetterAuth.mock.calls[0][0] as any;
    return { verify: config.emailAndPassword.password.verify, prepare, bind, run };
  }

  it('replaces the seeded hash with a full-strength one', async () => {
    const { verify, prepare, bind } = signIn();
    const seeded = await hashSeededPwd('FAN001');

    expect(await verify({ hash: seeded, password: 'FAN001' })).toBe(true);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE "account" SET password'));
    const [stored, , matched] = bind.mock.calls[0] as unknown as string[];
    expect(matched).toBe(seeded);            // the row is found by its own unique hash
    expect(isSeededHash(stored)).toBe(false);
    expect(await verifyPwd({ hash: stored, password: 'FAN001' })).toBe(true);
  });

  it('writes nothing when the password is wrong', async () => {
    const { verify, prepare } = signIn();
    const seeded = await hashSeededPwd('FAN001');

    expect(await verify({ hash: seeded, password: 'FAN002' })).toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('leaves an already full-strength hash alone', async () => {
    const { verify, prepare } = signIn();
    const full = await hashPwd('chosen-by-the-member');

    expect(await verify({ hash: full, password: 'chosen-by-the-member' })).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('still signs the member in when the upgrade write fails', async () => {
    // Losing the re-hash is recoverable — the next sign-in retries. Losing the
    // sign-in is not.
    const { verify, prepare } = signIn();
    prepare.mockImplementation(() => { throw new Error('D1 unavailable'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await verify({ hash: await hashSeededPwd('FAN001'), password: 'FAN001' })).toBe(true);
  });
});

// ─── end to end: what the importer writes is what sign-in accepts ─────────────

describe('an imported member can sign in with their FAN', () => {
  it('accepts the FAN against the real hash the importer seeds, then upgrades it', async () => {
    // The importer and the sign-in path are wired through different functions;
    // this is the one test that runs both for real, with no mock between them.
    const seeded = await hashSeededPwd('FAN001');

    expect(await verifyPwd({ hash: seeded, password: 'FAN001' })).toBe(true);
    expect(await verifyPwd({ hash: seeded, password: 'fan001' })).toBe(false);
    expect(await verifyPwd({ hash: seeded, password: '' })).toBe(false);

    const run = vi.fn(async () => ({ meta: { changes: 1 } }));
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    createAuth({ DB: { prepare } as any, BETTER_AUTH_SECRET: 's' });
    const config = mockBetterAuth.mock.calls.at(-1)![0] as any;

    await config.emailAndPassword.password.verify({ hash: seeded, password: 'FAN001' });
    const upgraded = (bind.mock.calls[0] as unknown as string[])[0];

    // The upgraded hash still accepts the FAN — the member is not locked out by
    // the re-hash — and it is now full strength.
    expect(await verifyPwd({ hash: upgraded, password: 'FAN001' })).toBe(true);
    expect(upgraded.startsWith('pbkdf2$')).toBe(true);
  });
});

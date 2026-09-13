import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { SET_PASSWORD_TOKEN_TTL_MS, createSetPasswordToken } from '../../lib/set-password-token';

/**
 * These assertions exist because the invitation writes a `verification` row by
 * hand rather than going through better-auth, and the row has to be
 * indistinguishable from one better-auth wrote itself. If better-auth changes
 * either the identifier or its date encoding, this is what should fail —
 * rather than a token that is accepted nowhere and reports nothing.
 */
function recordingDb() {
  const sql: string[] = [];
  const bound: unknown[][] = [];
  const db = {
    prepare: vi.fn((statement: string) => {
      sql.push(statement);
      return {
        bind: vi.fn((...args: unknown[]) => {
          bound.push(args);
          return { run: vi.fn(async () => ({ success: true })) };
        }),
      };
    }),
  };
  return { db: db as unknown as D1Database, sql, bound };
}

describe('createSetPasswordToken', () => {
  it('writes the row better-auth will look for', async () => {
    const { db, sql, bound } = recordingDb();
    const token = await createSetPasswordToken(db, 'user_42');

    expect(sql[0]).toMatch(/INSERT INTO "verification"/);
    const [, identifier, value] = bound[0] as string[];
    expect(identifier).toBe(`reset-password:${token}`);
    expect(value).toBe('user_42');
  });

  it('stores the dates as ISO strings, not epoch milliseconds', async () => {
    // better-auth's kysely adapter runs supportsDates: false against SQLite and
    // only converts a value back to a Date when it reads a string. A number
    // here produces a token that never validates, and says nothing about why.
    const { db, bound } = recordingDb();
    await createSetPasswordToken(db, 'user_42');

    const [, , , expiresAt, createdAt, updatedAt] = bound[0] as string[];
    for (const value of [expiresAt, createdAt, updatedAt]) {
      expect(typeof value).toBe('string');
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  it('expires a week out by default, so a weekly email checker can still use it', async () => {
    const { db, bound } = recordingDb();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    await createSetPasswordToken(db, 'user_42', { now });

    const [, , , expiresAt] = bound[0] as string[];
    expect(Date.parse(expiresAt) - now).toBe(SET_PASSWORD_TOKEN_TTL_MS);
    expect(SET_PASSWORD_TOKEN_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('honours an explicit TTL', async () => {
    const { db, bound } = recordingDb();
    const now = Date.parse('2026-01-01T00:00:00.000Z');
    await createSetPasswordToken(db, 'user_42', { now, ttlMs: 3600_000 });

    const [, , , expiresAt] = bound[0] as string[];
    expect(Date.parse(expiresAt) - now).toBe(3600_000);
  });

  it('mints a fresh URL-safe token each time', async () => {
    const { db } = recordingDb();
    const a = await createSetPasswordToken(db, 'user_1');
    const b = await createSetPasswordToken(db, 'user_1');

    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(encodeURIComponent(a)).toBe(a);
  });
});

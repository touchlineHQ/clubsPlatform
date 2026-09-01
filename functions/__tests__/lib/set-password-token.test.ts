import { describe, it, expect, vi } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createSetPasswordToken, INVITE_TTL_SECONDS } from '../../lib/set-password-token';

function captureDb() {
  const binds: unknown[][] = [];
  const sql: string[] = [];
  const db = {
    prepare: vi.fn((statement: string) => {
      sql.push(statement);
      return {
        bind: vi.fn((...args: unknown[]) => {
          binds.push(args);
          return { run: vi.fn(async () => ({ success: true })) };
        }),
      };
    }),
  } as unknown as D1Database;
  return { db, binds, sql };
}

/** [id, identifier, value, expiresAt, createdAt, updatedAt] */
function row(binds: unknown[][]) {
  const [id, identifier, value, expiresAt, createdAt, updatedAt] = binds[0] as string[];
  return { id, identifier, value, expiresAt, createdAt, updatedAt };
}

describe('createSetPasswordToken', () => {
  it('writes to the verification table', async () => {
    const { db, sql } = captureDb();
    await createSetPasswordToken(db, 'user_1');
    expect(sql[0]).toContain('"verification"');
  });

  // Load-bearing: POST /api/auth/reset-password looks the token up under exactly
  // this identifier. Change the prefix and every invitation silently stops working.
  it('stores the token under better-auth\'s reset-password identifier', async () => {
    const { db, binds } = captureDb();
    const token = await createSetPasswordToken(db, 'user_1');
    expect(row(binds).identifier).toBe(`reset-password:${token}`);
  });

  it('stores the user id as the value, which is what the reset applies to', async () => {
    const { db, binds } = captureDb();
    await createSetPasswordToken(db, 'user_42');
    expect(row(binds).value).toBe('user_42');
  });

  // better-auth's kysely adapter runs with supportsDates: false on SQLite, so
  // it writes and reads ISO strings. Epoch milliseconds here would produce a
  // token that never validates.
  it('stores dates as ISO strings, not epoch milliseconds', async () => {
    const { db, binds } = captureDb();
    await createSetPasswordToken(db, 'user_1');
    const { expiresAt, createdAt, updatedAt } = row(binds);
    for (const value of [expiresAt, createdAt, updatedAt]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    }
  });

  it('expires an invitation a week out by default', async () => {
    const { db, binds } = captureDb();
    await createSetPasswordToken(db, 'user_1');
    const { expiresAt, createdAt } = row(binds);
    const ttlSeconds = (Date.parse(expiresAt) - Date.parse(createdAt)) / 1000;
    expect(ttlSeconds).toBe(INVITE_TTL_SECONDS);
  });

  it('honours a shorter explicit TTL', async () => {
    const { db, binds } = captureDb();
    await createSetPasswordToken(db, 'user_1', 3600);
    const { expiresAt, createdAt } = row(binds);
    expect((Date.parse(expiresAt) - Date.parse(createdAt)) / 1000).toBe(3600);
  });

  it('mints a fresh, URL-safe token each time', async () => {
    const { db } = captureDb();
    const a = await createSetPasswordToken(db, 'user_1');
    const b = await createSetPasswordToken(db, 'user_1');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });
});

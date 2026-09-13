import type { D1Database } from "@cloudflare/workers-types";

/**
 * Mint the token an invited parent uses to set their first password.
 *
 * An imported parent never asked for a password reset, so there is no request
 * to hang an email off and better-auth exposes no public API for creating one
 * on their behalf. This writes the same `verification` row its reset flow
 * would, with a longer expiry, so the resulting link is redeemed by the stock
 * `/api/auth/reset-password` endpoint with no special casing at the other end
 * — including its single-use guarantee, which is better-auth deleting the row
 * once the password is set.
 *
 * That couples us to two details of better-auth's storage, both asserted in
 * set-password-token.test.ts:
 *
 *  - the identifier is `reset-password:<token>` and the value is the user id;
 *  - dates are **ISO strings**, not epoch milliseconds. better-auth's kysely
 *    adapter runs `supportsDates: false` against SQLite, and its read path
 *    only converts a value back to a Date when it finds a string. Writing a
 *    number here produces a token that never validates, silently.
 */

/** Invitations are read by people who check email weekly, not in the next hour. */
export const SET_PASSWORD_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 24 random bytes, URL-safe — matching the entropy of better-auth's own reset token. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export async function createSetPasswordToken(
  db: D1Database,
  userId: string,
  opts?: { ttlMs?: number; now?: number },
): Promise<string> {
  const token = generateToken();
  const now = opts?.now ?? Date.now();
  const expiresAt = new Date(now + (opts?.ttlMs ?? SET_PASSWORD_TOKEN_TTL_MS));

  await db
    .prepare(
      `INSERT INTO "verification" (id, identifier, value, expiresAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `ver_${crypto.randomUUID()}`,
      `reset-password:${token}`,
      userId,
      expiresAt.toISOString(),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    )
    .run();

  return token;
}

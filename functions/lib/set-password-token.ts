import type { D1Database } from "@cloudflare/workers-types";

/**
 * Mint a password-reset token for a user who never asked for one.
 *
 * The player import creates accounts for parents who have never visited the
 * site, so there is no "forgot password" request to hang an email off. Rather
 * than send them through a reset they did not initiate, we create the same
 * token better-auth's reset flow would, and put it in a welcome email.
 *
 * That means writing a `verification` row by hand, so two details of
 * better-auth's storage are load-bearing here and are asserted by
 * `functions/__tests__/lib/set-password-token.test.ts`:
 *
 *  1. The identifier is `reset-password:<token>` — this is what
 *     `POST /api/auth/reset-password` looks the token up by, and the value is
 *     the user id it will set the password for.
 *  2. Dates are stored as ISO strings, not epoch milliseconds. better-auth's
 *     kysely adapter runs with `supportsDates: false` on SQLite, so it writes
 *     `toISOString()` and reads back with `new Date(string)`. Writing a number
 *     here would produce a token that silently never validates.
 *
 * Single-use and expiry come for free: `reset-password` deletes the row once
 * it is redeemed and refuses one whose `expiresAt` has passed.
 */

const RESET_IDENTIFIER_PREFIX = "reset-password:";

/**
 * Invite links are long-lived on purpose. A password reset is a reply to
 * something the user just did, so an hour is plenty; an import invitation lands
 * in the inbox of someone who was not expecting it and may not open their mail
 * for a week.
 */
export const INVITE_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 32 bytes of randomness, base64url — the token is a bearer credential. */
function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** Create a single-use set-password token and return it. */
export async function createSetPasswordToken(
  db: D1Database,
  userId: string,
  ttlSeconds: number = INVITE_TTL_SECONDS,
): Promise<string> {
  const token = generateToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  // The row id is minted inline rather than with `api-helpers`' `randomId`:
  // that module imports `lib/auth`, which imports the mailer, which imports
  // this file — the import alone would close a cycle.
  await db
    .prepare(
      `INSERT INTO "verification" (id, identifier, value, expiresAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      `ver_${crypto.randomUUID()}`,
      `${RESET_IDENTIFIER_PREFIX}${token}`,
      userId,
      expiresAt.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();

  return token;
}

import { betterAuth } from "better-auth";

const enc = new TextEncoder();

/** Rounds for a password its owner chose. */
const FULL_ROUNDS = 100_000;

/**
 * Rounds for an import-seeded initial password.
 *
 * That password is the player's FAN, which this same database already holds in
 * plaintext in player.fanId — so rounds buy nothing against anyone who can read
 * the hash, while 100k of them per account is what exhausted the Worker's CPU
 * importing a club. The first successful sign-in re-hashes at full strength
 * (see createAuth), and a password its owner picked is full strength from the
 * start.
 */
const SEEDED_ROUNDS = 1_000;

const FULL_PREFIX = 'pbkdf2$';
const SEEDED_PREFIX = 'pbkdf2-seed$';

async function derive(password: string, salt: Uint8Array, rounds: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: rounds, hash: "SHA-256" },
    key, 256
  );
  return new Uint8Array(bits);
}

async function encodeHash(password: string, rounds: number, prefix: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await derive(password, salt, rounds);
  const out = new Uint8Array(16 + 32);
  out.set(salt);
  out.set(derived, 16);
  return prefix + btoa(String.fromCharCode(...out));
}

/** Hash a password using PBKDF2 with a random salt. */
export async function hashPwd(password: string): Promise<string> {
  return encodeHash(password, FULL_ROUNDS, FULL_PREFIX);
}

/** Hash an import-seeded initial password. Deliberately cheap — see SEEDED_ROUNDS. */
export async function hashSeededPwd(password: string): Promise<string> {
  return encodeHash(password, SEEDED_ROUNDS, SEEDED_PREFIX);
}

/** True while this hash is still the one the importer seeded. */
export function isSeededHash(hash: string): boolean {
  return hash.startsWith(SEEDED_PREFIX);
}

/** Verify a password against a PBKDF2 hash in constant time. */
export async function verifyPwd({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  const rounds = hash.startsWith(FULL_PREFIX) ? FULL_ROUNDS
    : hash.startsWith(SEEDED_PREFIX) ? SEEDED_ROUNDS
    : null;
  if (rounds === null) return false;
  try {
    const bytes = Uint8Array.from(atob(hash.slice(hash.indexOf('$') + 1)), c => c.charCodeAt(0));
    const salt = bytes.slice(0, 16);
    const stored = bytes.slice(16);
    const derived = await derive(password, salt, rounds);
    if (stored.length !== derived.length) return false;
    let diff = 0;
    for (let i = 0; i < stored.length; i++) diff |= stored[i] ^ derived[i];
    return diff === 0;
  } catch {
    return false;
  }
}

/**
 * Verify, and replace a seeded hash with a full-strength one on the way through.
 *
 * This is the other half of the import's lazy hashing: the seeded hash is unique
 * because its salt is, so it identifies its own row without an account id.
 */
async function verifyAndUpgrade(
  db: D1Database,
  { hash, password }: { hash: string; password: string },
): Promise<boolean> {
  const ok = await verifyPwd({ hash, password });
  if (!ok || !isSeededHash(hash)) return ok;

  try {
    await db
      .prepare('UPDATE "account" SET password = ?, updatedAt = ? WHERE password = ?')
      .bind(await hashPwd(password), Date.now(), hash)
      .run();
  } catch (err) {
    // A failed upgrade must not cost the member their sign-in; the next retries.
    console.error('Re-hashing a seeded password after sign-in failed', err);
  }
  return ok;
}

/**
 * Create and configure a Better Auth instance with the database and credentials.
 * Automatically promotes the first user to admin.
 */
export function createAuth(
  env: { DB: D1Database; BETTER_AUTH_SECRET: string },
  opts?: { baseURL?: string }
) {
  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: opts?.baseURL,
    trustedOrigins: [
      opts?.baseURL ?? "https://elbantams.pages.dev",
      "https://*.clubsplatform.pages.dev",
      "http://localhost:5173",
      "http://localhost:8788",
    ],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPwd,
        verify: (data) => verifyAndUpgrade(env.DB, data),
      },
    },
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "member",
          input: false,
        },
        clubSlug: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            const count = await env.DB
              .prepare('SELECT COUNT(*) as c FROM "user"')
              .first<{ c: number }>();
            if (count && count.c === 1) {
              await env.DB
                .prepare('UPDATE "user" SET role = ? WHERE id = ?')
                .bind("admin", user.id)
                .run();
            }
          },
        },
      },
    },
  });
}

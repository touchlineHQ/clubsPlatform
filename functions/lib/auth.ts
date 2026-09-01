import { betterAuth } from "better-auth";
import {
  RESET_TOKEN_TTL_SECONDS,
  reportEmailFailure,
  sendResetPassword,
  sendVerifyEmail,
  type AccountEmailEnv,
} from "./account-email";
import { SIGNUP_LIMITS } from "./signup-validation";

const enc = new TextEncoder();

/** Hash a password using PBKDF2 with a random salt. */
export async function hashPwd(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key, 256
  );
  const out = new Uint8Array(16 + 32);
  out.set(salt);
  out.set(new Uint8Array(bits), 16);
  return "pbkdf2$" + btoa(String.fromCharCode(...out));
}

/** Verify a password against a PBKDF2 hash in constant time. */
export async function verifyPwd({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (!hash.startsWith("pbkdf2$")) return false;
  try {
    const bytes = Uint8Array.from(atob(hash.slice(7)), c => c.charCodeAt(0));
    const salt = bytes.slice(0, 16);
    const stored = bytes.slice(16);
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
      key, 256
    );
    const derived = new Uint8Array(bits);
    if (stored.length !== derived.length) return false;
    let diff = 0;
    for (let i = 0; i < stored.length; i++) diff |= stored[i] ^ derived[i];
    return diff === 0;
  } catch {
    return false;
  }
}

export interface AuthEnv extends AccountEmailEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
}

const DEFAULT_BASE_URL = "https://elbantams.pages.dev";

/**
 * Create and configure a Better Auth instance with the database and credentials.
 * Automatically promotes the first user to admin.
 */
export function createAuth(
  env: AuthEnv,
  opts?: { baseURL?: string }
) {
  const origin = opts?.baseURL ?? DEFAULT_BASE_URL;

  return betterAuth({
    database: env.DB,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: opts?.baseURL,
    trustedOrigins: [
      origin,
      "https://*.clubsplatform.pages.dev",
      "http://localhost:5173",
      "http://localhost:8788",
    ],
    emailAndPassword: {
      enabled: true,
      password: {
        hash: hashPwd,
        verify: verifyPwd,
      },
      // Same floor the sign-up validator enforces, so a reset cannot be used
      // to set a password weaker than one the sign-up form would have refused.
      minPasswordLength: SIGNUP_LIMITS.passwordMin,
      maxPasswordLength: SIGNUP_LIMITS.passwordMax,
      resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
      // A reset is often a reaction to "someone else may be in my account", so
      // finishing one should end every session that was already open.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, token }) => {
        // Swallowed on purpose — see reportEmailFailure. A throw here would
        // answer "does this account exist?" for anyone who asked.
        try {
          await sendResetPassword(env, {
            origin,
            userId: user.id,
            email: user.email,
            token,
          });
        } catch (err) {
          await reportEmailFailure(env, err, { kind: "reset-password", userId: user.id });
        }
      },
    },
    // Deliberately not paired with `requireEmailVerification`. Every account
    // that exists today — including every parent the FA import created — has
    // emailVerified = 0, so gating sign-in on it would lock out the entire
    // user base on deploy. Verification is recorded from here on; enforcing it
    // is a follow-up that needs a backfill first.
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, token }) => {
        // A provider outage must not stop someone creating an account: this
        // runs inline inside sign-up, and workerd has no background queue to
        // defer it to.
        try {
          await sendVerifyEmail(env, {
            origin,
            userId: user.id,
            email: user.email,
            token,
          });
        } catch (err) {
          await reportEmailFailure(env, err, { kind: "verify-email", userId: user.id });
        }
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

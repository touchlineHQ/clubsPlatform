import { betterAuth } from "better-auth";
import { type BuiltMessage, resetPasswordMessage, verifyEmailMessage } from "./account-email";
import { clubLink, clubPath, getClubIdentity } from "./club-identity";
import { getMailer } from "./email";
import { getPostHog } from "./posthog";
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

/** Everything createAuth needs, including the optional mail and analytics vars. */
export interface AuthEnv {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  MULTI_CLUB?: string;
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

/** The parts of a better-auth user this module touches. */
interface MailUser {
  id: string;
  email: string;
  clubSlug?: string | null;
}

/**
 * Same rule as `isMultiClubMode()` in api-helpers, repeated rather than
 * imported: api-helpers imports this module, so reaching back would make the
 * two circular.
 */
function isMultiClub(env: AuthEnv): boolean {
  const v = env.MULTI_CLUB;
  return !!(v && v !== "0" && v !== "false");
}

/**
 * Send one account email, addressed as the user's club, and swallow anything
 * that goes wrong.
 *
 * Failures are recorded to PostHog rather than raised, for two distinct
 * reasons. `sendResetPassword` only runs once better-auth has *found* a user,
 * so a 500 for some addresses and a cheerful "check your email" for others
 * would tell an attacker which accounts exist. Sign-up verification runs
 * inline inside sign-up, where a provider outage would otherwise stop people
 * creating accounts at all.
 *
 * Nothing is sent when the provider is unconfigured — the same silent disable
 * as `getPostHog()`.
 */
async function sendAccountEmail(
  env: AuthEnv,
  baseURL: string | undefined,
  user: MailUser,
  source: string,
  build: (ctx: { clubName: string; slug: string | null; multiClub: boolean; origin: string }) => BuiltMessage,
): Promise<void> {
  const mailer = getMailer(env);
  if (!mailer) return;

  try {
    if (!baseURL) throw new Error("No baseURL configured — cannot build an absolute link");

    const slug = user.clubSlug ?? null;
    const identity = slug ? await getClubIdentity(env.DB, slug) : null;
    const multiClub = isMultiClub(env);
    const origin = new URL(baseURL).origin;
    // A platform admin has no club, and a club row can be missing on a
    // half-migrated database. Neither is a reason to withhold the email.
    const clubName = identity?.name ?? "Your club";

    const message = build({ clubName, slug, multiClub, origin });

    await mailer.send({
      to: user.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      fromName: clubName,
      ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}),
    });
  } catch (e) {
    const posthog = getPostHog(env);
    if (posthog) {
      await posthog.captureExceptionImmediate(e, user.id, { source });
    }
  }
}

/**
 * Create and configure a Better Auth instance with the database and credentials.
 * Automatically promotes the first user to admin.
 */
export function createAuth(
  env: AuthEnv,
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
        verify: verifyPwd,
      },

      // Deliberately NOT requireEmailVerification. Every account that exists
      // today has emailVerified = 0 — including every parent the FA import
      // created — so gating sign-in on it would lock out the entire user base
      // on deploy. Verification is recorded from here on; enforcing it needs a
      // backfill first.

      // Sign-up is validated against these bounds before it reaches the
      // handler; setting them here applies the same floor to a reset, which
      // would otherwise fall back to better-auth's default of 8.
      minPasswordLength: SIGNUP_LIMITS.passwordMin,
      maxPasswordLength: SIGNUP_LIMITS.passwordMax,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, token }) => {
        await sendAccountEmail(
          env,
          opts?.baseURL,
          user as MailUser,
          "send-reset-password",
          ({ clubName, slug, multiClub, origin }) =>
            resetPasswordMessage(
              clubName,
              clubLink(origin, slug, `/reset-password?token=${encodeURIComponent(token)}`, multiClub),
            ),
        );
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, token }) => {
        await sendAccountEmail(
          env,
          opts?.baseURL,
          user as MailUser,
          "send-verification-email",
          ({ clubName, slug, multiClub, origin }) => {
            // The link has to hit the API to mark the address verified, so it
            // goes there first and better-auth redirects on to the club. The
            // callback is built here rather than taken from the `url` argument
            // because only this side knows the club's path prefix.
            const callback = clubPath(slug, "/login?verified=1", multiClub);
            const link =
              `${origin}/api/auth/verify-email` +
              `?token=${encodeURIComponent(token)}` +
              `&callbackURL=${encodeURIComponent(callback)}`;
            return verifyEmailMessage(clubName, link);
          },
        );
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

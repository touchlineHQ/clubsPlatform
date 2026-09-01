import type { D1Database } from "@cloudflare/workers-types";
import { getMailer, type EmailEnv } from "./email";
import { clubAppUrl, loadClubIdentity, type ClubIdentity } from "./club-identity";
import { importWelcomeEmail, resetPasswordEmail, verifyAddressEmail } from "./email-templates";
import { isMultiClubMode } from "./env-flags";
import { getPostHog } from "./posthog";
import { INVITE_TTL_SECONDS } from "./set-password-token";

/**
 * The account lifecycle emails, assembled: work out which club the recipient
 * belongs to, point the link at that club's site, render the template and hand
 * it to the provider.
 *
 * Every function returns `false` when transactional email is not configured and
 * `true` when a message was handed to the provider. A provider failure throws —
 * callers decide whether that should surface to the user (a reset the user is
 * waiting on) or just be recorded (a bulk import).
 */

export interface AccountEmailEnv extends EmailEnv {
  DB: D1Database;
  MULTI_CLUB?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

/** Matches better-auth's default, restated here because the copy quotes it. */
export const RESET_TOKEN_TTL_SECONDS = 60 * 60;

/**
 * The club a user belongs to.
 *
 * better-auth hands `sendResetPassword` its own view of the user, and
 * `clubSlug` is an additional field it may or may not have selected. Reading it
 * back from the row is one query and cannot be wrong.
 */
async function clubSlugForUser(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare(`SELECT clubSlug FROM "user" WHERE id = ? LIMIT 1`)
    .bind(userId)
    .first<{ clubSlug: string | null }>();
  return row?.clubSlug ?? null;
}

async function deliver(
  env: AccountEmailEnv,
  identity: ClubIdentity | null,
  to: string,
  body: { subject: string; html: string; text: string },
): Promise<boolean> {
  const mailer = getMailer(env);
  if (!mailer) return false;
  await mailer.send({
    to,
    subject: body.subject,
    html: body.html,
    text: body.text,
    fromName: identity?.name,
    replyTo: identity?.replyTo ?? null,
  });
  return true;
}

/** Password reset, triggered by the user from the sign-in page. */
export async function sendResetPassword(
  env: AccountEmailEnv,
  opts: { origin: string; userId: string; email: string; token: string },
): Promise<boolean> {
  const clubSlug = await clubSlugForUser(env.DB, opts.userId);
  const identity = await loadClubIdentity(env.DB, clubSlug);
  const url = clubAppUrl({
    origin: opts.origin,
    clubSlug,
    multiClub: isMultiClubMode(env),
    route: "/reset-password",
    query: { token: opts.token },
  });
  return deliver(
    env,
    identity,
    opts.email,
    resetPasswordEmail({
      clubName: identity?.name,
      url,
      expiresInHours: Math.round(RESET_TOKEN_TTL_SECONDS / 3600),
    }),
  );
}

/**
 * Address confirmation on sign-up.
 *
 * The link goes to the auth API rather than into the app: better-auth's
 * `GET /api/auth/verify-email` marks the address verified and then redirects to
 * `callbackURL`, so the recipient lands back on their own club's site.
 */
export async function sendVerifyEmail(
  env: AccountEmailEnv,
  opts: { origin: string; userId: string; email: string; token: string },
): Promise<boolean> {
  const clubSlug = await clubSlugForUser(env.DB, opts.userId);
  const identity = await loadClubIdentity(env.DB, clubSlug);
  const callbackURL = clubAppUrl({
    origin: opts.origin,
    clubSlug,
    multiClub: isMultiClubMode(env),
    route: "/",
  });
  const url =
    `${opts.origin.replace(/\/+$/, "")}/api/auth/verify-email` +
    `?token=${encodeURIComponent(opts.token)}&callbackURL=${encodeURIComponent(callbackURL)}`;
  return deliver(env, identity, opts.email, verifyAddressEmail({ clubName: identity?.name, url }));
}

/**
 * Welcome for an account the FA player import created. The club is known from
 * the import itself, so there is no user lookup to do.
 */
export async function sendImportWelcome(
  env: AccountEmailEnv,
  opts: { origin: string; clubSlug: string; email: string; token: string },
): Promise<boolean> {
  const identity = await loadClubIdentity(env.DB, opts.clubSlug);
  const url = clubAppUrl({
    origin: opts.origin,
    clubSlug: opts.clubSlug,
    multiClub: isMultiClubMode(env),
    route: "/reset-password",
    query: { token: opts.token },
  });
  return deliver(
    env,
    identity,
    opts.email,
    importWelcomeEmail({
      clubName: identity?.name,
      url,
      expiresInDays: Math.round(INVITE_TTL_SECONDS / 86400),
    }),
  );
}

/**
 * Record a send that failed, without re-throwing.
 *
 * Auth flows swallow delivery errors deliberately. Letting one surface would
 * turn the provider into an account-enumeration oracle: `sendResetPassword` only
 * runs once a user has been found, so a 500 on some addresses and a cheerful
 * "check your email" on others tells an attacker which accounts exist. The
 * failure still has to be visible to us, so it goes to error tracking — the
 * same place server exceptions from `_middleware.ts` land.
 */
export async function reportEmailFailure(
  env: AccountEmailEnv,
  error: unknown,
  detail: { kind: string; userId?: string; clubSlug?: string | null },
): Promise<void> {
  const posthog = getPostHog(env);
  if (!posthog) return;
  try {
    await posthog.captureExceptionImmediate(error, detail.userId, {
      source: "transactional-email",
      email_kind: detail.kind,
      club_slug: detail.clubSlug ?? undefined,
    });
  } catch {
    // Analytics must never be the reason an auth request fails.
  }
}

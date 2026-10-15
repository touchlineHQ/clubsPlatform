import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, randomId, getClubSlug, isMultiClubMode } from "../lib/api-helpers";
import { getMailer } from "../lib/email";
import { getClubIdentity, clubLink } from "../lib/club-identity";
import { getPostHog, clubGroups } from "../lib/posthog";
import {
  DEFAULT_FA_REGISTRATION_URL,
  checkRateLimit,
  enquiryAckMessage,
  enquirySecretaryMessage,
  loadFormOptions,
  purgeStaleEnquiries,
  validateEnquiry,
  verifyTurnstile,
  type EnquiryInput,
} from "../lib/enquiries";

/**
 * Public player enquiry form (#73). No account needed.
 *
 * GET  → the club's age groups / teams and the Turnstile site key.
 * POST → store a lead, email the secretary, acknowledge the enquirer.
 *
 * Abuse protection, in order: honeypot (silently accepted, never stored),
 * per-IP hourly rate limit, Turnstile. The form is refused outright when
 * Turnstile is not configured, rather than running unprotected.
 */

/** The decoy field. Real visitors never see it; bots fill it in. */
export const HONEYPOT_FIELD = "website";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });
  const options = await loadFormOptions(context.env.DB, clubSlug);
  const siteKey = context.env.TURNSTILE_SECRET_KEY ? context.env.TURNSTILE_SITE_KEY ?? null : null;
  return json({ ...options, turnstileSiteKey: siteKey, enabled: !!siteKey });
};

async function faRegistrationUrl(db: D1Database, clubSlug: string): Promise<string> {
  const row = await db
    .prepare(`SELECT data FROM "club_config" WHERE slug = ? LIMIT 1`)
    .bind(clubSlug)
    .first<{ data: string | null }>();
  try {
    const url = row?.data ? (JSON.parse(row.data) as { faRegistrationUrl?: unknown }).faRegistrationUrl : null;
    if (typeof url === "string" && /^https:\/\/[^\s"<>]+$/.test(url.trim())) return url.trim();
  } catch {
    // Malformed club data falls back to the default link.
  }
  return DEFAULT_FA_REGISTRATION_URL;
}

/** Secretaries first; a club without one falls back to its admins. */
async function secretaryEmails(db: D1Database, clubSlug: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT email, role FROM "user" WHERE "clubSlug" = ? AND role IN ('secretary', 'admin')
       ORDER BY CASE role WHEN 'secretary' THEN 0 ELSE 1 END, "createdAt" LIMIT 10`,
    )
    .bind(clubSlug)
    .all<{ email: string; role: string }>();
  const rows = results ?? [];
  const secretaries = rows.filter((r) => r.role === "secretary");
  return (secretaries.length ? secretaries : rows).map((r) => r.email).slice(0, 3);
}

async function sendMail(
  context: EventContext<Env, string, unknown>,
  clubSlug: string,
  enquiry: EnquiryInput,
): Promise<void> {
  const env = context.env;
  const mailer = getMailer(env);
  if (!mailer) return;
  const identity = await getClubIdentity(env.DB, clubSlug);
  const clubName = identity?.name ?? "Your club";
  const base = env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const adminUrl = clubLink(base, clubSlug, "/registrations", isMultiClubMode(env));
  const footer = { kind: "transactional" as const, clubName };

  const ack = enquiryAckMessage(clubName, enquiry.ageGroup, await faRegistrationUrl(env.DB, clubSlug));
  const notify = enquirySecretaryMessage(clubName, enquiry, adminUrl);
  const recipients = await secretaryEmails(env.DB, clubSlug);

  const sends = [
    mailer.send({ to: enquiry.contactEmail, ...ack, footer, fromName: clubName, ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}) }),
    ...recipients.map((to) => mailer.send({ to, ...notify, footer, fromName: clubName, replyTo: enquiry.contactEmail })),
  ];
  const results = await Promise.allSettled(sends);
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length) {
    const posthog = getPostHog(env);
    try {
      await posthog?.captureExceptionImmediate((failed[0] as PromiseRejectedResult).reason, `club:${clubSlug}`, {
        source: "enquiry mail",
        failed: failed.length,
      });
    } catch {
      // ignore
    }
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const env = context.env;
  await ensureTables(env.DB);
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return json({ error: "Body must be an object" }, { status: 400 });

  // Honeypot: look like success so the bot moves on, store nothing.
  const trap = body[HONEYPOT_FIELD];
  if (typeof trap === "string" && trap.trim() !== "") return json({ ok: true });

  if (!env.TURNSTILE_SECRET_KEY) {
    return json({ error: "Enquiries are not available yet" }, { status: 503 });
  }

  const now = nowMs();
  const ip = context.request.headers.get("CF-Connecting-IP") ?? "unknown";
  if (!(await checkRateLimit(env.DB, ip, env.BETTER_AUTH_SECRET ?? "", now))) {
    return json({ error: "Too many enquiries. Please try again later." }, { status: 429 });
  }

  const options = await loadFormOptions(env.DB, clubSlug);
  const v = validateEnquiry(body, options);
  if ("error" in v) return json({ error: v.error }, { status: 400 });

  const token = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  if (!(await verifyTurnstile(env.TURNSTILE_SECRET_KEY, token, ip === "unknown" ? null : ip))) {
    return json({ error: "Could not verify you are not a robot. Please try again." }, { status: 403 });
  }

  const e = v.value;
  const id = randomId("enq");
  await env.DB
    .prepare(
      `INSERT INTO "player_enquiry" ("id", "clubSlug", "ageGroup", "team", "enquirerType", "contactName", "contactEmail",
        "contactPhone", "playerFirstName", "status", "consentAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
    )
    .bind(id, clubSlug, e.ageGroup, e.team, e.enquirerType, e.contactName, e.contactEmail, e.contactPhone,
      e.playerFirstName, now, now, now)
    .run();

  await purgeStaleEnquiries(env.DB, now);
  await sendMail(context, clubSlug, e);

  const posthog = getPostHog(env);
  if (posthog) {
    try {
      await posthog.captureImmediate({
        distinctId: `enquiry:${id}`,
        event: "player enquiry submitted",
        ...clubGroups(clubSlug),
        // No contact details, ever.
        properties: { club_slug: clubSlug, age_group: e.ageGroup, enquirer_type: e.enquirerType, has_team: !!e.team },
      });
    } catch {
      // ignore
    }
  }

  return json({ ok: true, id });
};

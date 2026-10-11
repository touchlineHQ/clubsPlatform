import type { D1Database } from "@cloudflare/workers-types";
import { nowMs, randomId } from "./api-helpers";
import { prepareAuditLog } from "./audit-log";
import { hashToken, randomTokenHex } from "./consent";
import { getMailer, type Mailer, type MailEnv } from "./email";
import { activationMessage } from "./account-email";
import { getClubIdentity, type ClubIdentity } from "./club-identity";
import { consentFormUrl, ACTIVATION_TOKEN_TTL_MS } from "./parent-consent";
import { purgeLapsedPendingContacts } from "./contact-purge";

/**
 * Activation mail for `pending` contacts (#132).
 *
 * A pending contact is not contactable: it receives exactly one activation
 * mail, plus at most one reminder, and nothing else. That is why this does not
 * go through sendClubEmail (which only addresses confirmed contacts for a named
 * purpose) — it is the single, deliberate exception, kept narrow here.
 *
 * Tokens are minted (hashed at rest) immediately before the send, so the
 * plaintext exists only in the mail. A provider failure is reported to the
 * caller and never thrown: it must not fail an import or return a 500 (same
 * rule as #72). Failed sends are un-stamped so the next batch retries them.
 *
 * D1 Free allows ~50 queries per invocation, so a batch is capped
 * (ACTIVATION_BATCH_LIMIT) at about one query per contact plus fixed overhead.
 * Callers loop while `remaining` > 0.
 */

/** Reminder goes out this long after the activation mail. */
export const ACTIVATION_REMINDER_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
/** Contacts per invocation: select, identity, count, audit + up to 2 writes each (mint, restore) stays well under 50. */
export const ACTIVATION_BATCH_LIMIT = 15;
/** A parent cannot trigger another mail to the same contact inside this window. */
export const RESEND_COOLDOWN_MS = 5 * 60 * 1000;

export type ActivationKind = "activation" | "reminder";

type Candidate = {
  id: string;
  email: string;
  fanId: string;
  teamName: string | null;
  /** Token state before this send, restored if delivery fails. */
  prevHash: string | null;
  prevExpiresAt: number | null;
  prevStampedAt: number | null;
};

export type ActivationBatchResult = {
  /** False when no mail provider is configured; nothing was sent or stamped. */
  configured: boolean;
  sent: number;
  failed: number;
  /** Contacts still waiting after this batch (excluding failures this call). */
  remaining: number;
};

export type MailContext = {
  env: MailEnv;
  origin: string;
  multiClub: boolean;
};

const TEAM_SQL = `(SELECT pr.teamName FROM "player_registration" pr
                    WHERE pr.playerId = pc.playerId AND pr.clubSlug = pc.clubSlug
                    ORDER BY pr.updatedAt DESC LIMIT 1)`;

function linksFor(ctx: MailContext, clubSlug: string, token: string) {
  const activate = consentFormUrl(ctx.origin, clubSlug, token, ctx.multiClub);
  return { activate, decline: `${activate}/decline` };
}

async function deliver(
  mailer: Mailer,
  identity: ClubIdentity | null,
  ctx: MailContext,
  clubSlug: string,
  candidate: Candidate,
  token: string,
  kind: ActivationKind,
): Promise<boolean> {
  const clubName = identity?.name ?? "Your club";
  const message = activationMessage(
    clubName,
    { fanId: candidate.fanId, teamName: candidate.teamName },
    linksFor(ctx, clubSlug, token),
    kind === "reminder",
  );
  try {
    await mailer.send({
      to: candidate.email,
      subject: message.subject,
      html: message.html,
      text: message.text,
      fromName: clubName,
      ...(identity?.replyTo ? { replyTo: identity.replyTo } : {}),
    });
    return true;
  } catch (err) {
    console.error("activation mail failed", err instanceof Error ? err.message : "error");
    return false;
  }
}

/**
 * Mint a fresh token for one pending contact and send. Returns true when sent.
 * The stamp is guarded so two concurrent callers cannot both mail the contact.
 */
async function mintAndSend(
  db: D1Database,
  mailer: Mailer,
  identity: ClubIdentity | null,
  ctx: MailContext,
  clubSlug: string,
  candidate: Candidate,
  kind: ActivationKind,
  now: number,
  /** Extra guard on the stamp (e.g. the cooldown for parent-triggered resend). */
  stampGuard = "",
  stampBinds: unknown[] = [],
): Promise<boolean> {
  const token = randomTokenHex();
  const tokenHash = await hashToken(token);
  const stampColumn = kind === "reminder" ? "reminderSentAt" : "activationSentAt";
  // A reminder keeps the original expiry; a first mail or resend starts the TTL.
  const expiry = kind === "reminder" ? "activationExpiresAt" : "?";
  const binds: unknown[] = [tokenHash];
  if (kind !== "reminder") binds.push(now + ACTIVATION_TOKEN_TTL_MS);
  binds.push(now, candidate.id, clubSlug, ...stampBinds);
  const minted = await db
    .prepare(
      `UPDATE "player_contact"
          SET activationTokenHash = ?, activationExpiresAt = ${expiry},
              ${stampColumn} = ?
        WHERE id = ? AND clubSlug = ? AND state = 'pending' ${stampGuard}`,
    )
    .bind(...binds)
    .run();
  if ((minted.meta?.changes ?? 0) !== 1) return false;

  const ok = await deliver(mailer, identity, ctx, clubSlug, candidate, token, kind);
  if (!ok) {
    // Put back the previous token, expiry and stamp, but only while the row
    // still holds the token we minted: the link the parent already has keeps
    // working, and the next batch retries (a null stamp is "not yet sent").
    await db
      .prepare(
        `UPDATE "player_contact"
            SET ${stampColumn} = ?, activationTokenHash = ?, activationExpiresAt = ?
          WHERE id = ? AND clubSlug = ? AND activationTokenHash = ?`,
      )
      .bind(
        candidate.prevStampedAt, candidate.prevHash, candidate.prevExpiresAt,
        candidate.id, clubSlug, tokenHash,
      )
      .run();
  }
  return ok;
}

function candidateWhere(kind: ActivationKind): string {
  const where = kind === "activation"
    ? `pc.activationSentAt IS NULL`
    : `pc.reminderSentAt IS NULL AND pc.activationSentAt IS NOT NULL AND pc.activationSentAt <= ?`;
  return `pc.clubSlug = ? AND pc.state = 'pending' AND ${where}`;
}

function candidateSql(kind: ActivationKind): string {
  const stamp = kind === "reminder" ? "pc.reminderSentAt" : "pc.activationSentAt";
  return `SELECT pc.id AS id, pc.email AS email, p.fanId AS fanId, ${TEAM_SQL} AS teamName,
                 pc.activationTokenHash AS prevHash, pc.activationExpiresAt AS prevExpiresAt,
                 ${stamp} AS prevStampedAt
            FROM "player_contact" pc
            JOIN "player" p ON p.id = pc.playerId
           WHERE ${candidateWhere(kind)}
           ORDER BY pc.id
           LIMIT ?`;
}

/** Send one capped batch of activation (or reminder) mail for a club. */
export async function sendActivationBatch(
  db: D1Database,
  ctx: MailContext,
  {
    clubSlug,
    actorId,
    kind,
    limit = ACTIVATION_BATCH_LIMIT,
    now = nowMs(),
  }: { clubSlug: string; actorId: string; kind: ActivationKind; limit?: number; now?: number },
): Promise<ActivationBatchResult> {
  const mailer = getMailer(ctx.env);
  if (!mailer) return { configured: false, sent: 0, failed: 0, remaining: 0 };

  const cap = Math.min(Math.max(1, limit), ACTIVATION_BATCH_LIMIT);
  const binds: unknown[] = [clubSlug];
  if (kind === "reminder") binds.push(now - ACTIVATION_REMINDER_AFTER_MS);
  binds.push(cap + 1);
  const { results } = await db
    .prepare(candidateSql(kind))
    .bind(...binds)
    .all<Candidate>();
  const all = results ?? [];
  const batch = all.slice(0, cap);
  if (batch.length === 0) return { configured: true, sent: 0, failed: 0, remaining: 0 };

  const identity = await getClubIdentity(db, clubSlug);
  let sent = 0;
  let failed = 0;
  for (const candidate of batch) {
    const ok = await mintAndSend(db, mailer, identity, ctx, clubSlug, candidate, kind, now);
    if (ok) sent++;
    else failed++;
  }

  // Count only (never addresses) in the audit trail.
  await prepareAuditLog(db, {
    clubSlug,
    adminId: actorId,
    action: kind === "reminder" ? "activation_reminder_sent" : "activation_mail_sent",
    targetTable: "player_contact",
    targetId: randomId("actbatch"),
    note: `sent=${sent};failed=${failed}`,
  }).run();

  // One extra read, only when more than a batch was waiting, so the client can
  // show real progress. Failed contacts are still waiting, so they count.
  let remaining = 0;
  if (all.length > cap) {
    const total = await db
      .prepare(`SELECT COUNT(*) AS n FROM "player_contact" pc WHERE ${candidateWhere(kind)}`)
      .bind(...binds.slice(0, -1))
      .first<{ n: number }>();
    remaining = Math.max(0, (total?.n ?? 0) - failed);
  }

  return { configured: true, sent, failed, remaining };
}

/**
 * Mail one contact whose token the caller just minted (admin "create link").
 * Stamps activationSentAt only on success. Never throws on provider failure.
 */
export async function emailActivationLink(
  db: D1Database,
  ctx: MailContext,
  {
    clubSlug,
    contactId,
    email,
    token,
  }: { clubSlug: string; contactId: string; email: string; token: string },
): Promise<"sent" | "failed" | "unconfigured"> {
  const mailer = getMailer(ctx.env);
  if (!mailer) return "unconfigured";
  const row = await db
    .prepare(
      `SELECT p.fanId AS fanId, ${TEAM_SQL} AS teamName
         FROM "player_contact" pc JOIN "player" p ON p.id = pc.playerId
        WHERE pc.id = ? AND pc.clubSlug = ? AND pc.state = 'pending'`,
    )
    .bind(contactId, clubSlug)
    .first<{ fanId: string; teamName: string | null }>();
  if (!row) return "failed";
  const identity = await getClubIdentity(db, clubSlug);
  const ok = await deliver(
    mailer, identity, ctx, clubSlug,
    {
      id: contactId, email, fanId: row.fanId, teamName: row.teamName,
      prevHash: null, prevExpiresAt: null, prevStampedAt: null,
    },
    token, "activation",
  );
  if (!ok) return "failed";
  await db
    .prepare(`UPDATE "player_contact" SET activationSentAt = ? WHERE id = ? AND clubSlug = ?`)
    .bind(nowMs(), contactId, clubSlug)
    .run();
  return "sent";
}

/**
 * Parent asks for a fresh link from an expired or lost one. Public and
 * unauthenticated, so it reveals nothing: the caller returns the same response
 * whether the token is unknown, spent or live. Rate-limited per contact by
 * RESEND_COOLDOWN_MS. Run it in waitUntil so response timing does not depend
 * on whether a mail was sent.
 */
export async function resendActivationForToken(
  db: D1Database,
  ctx: MailContext,
  token: string,
  now = nowMs(),
): Promise<boolean> {
  const tokenHash = await hashToken(token.trim());
  const row = await db
    .prepare(
      `SELECT pc.id AS id, pc.clubSlug AS clubSlug, pc.email AS email,
              p.fanId AS fanId, ${TEAM_SQL} AS teamName,
              pc.activationTokenHash AS prevHash, pc.activationExpiresAt AS prevExpiresAt,
              pc.activationSentAt AS prevStampedAt
         FROM "player_contact" pc JOIN "player" p ON p.id = pc.playerId
        WHERE pc.activationTokenHash = ? AND pc.state = 'pending'`,
    )
    .bind(tokenHash)
    .first<Candidate & { clubSlug: string }>();
  if (!row) return false;
  if (row.prevStampedAt != null && row.prevStampedAt > now - RESEND_COOLDOWN_MS) return false;
  const mailer = getMailer(ctx.env);
  if (!mailer) return false;
  const identity = await getClubIdentity(db, row.clubSlug);
  return mintAndSend(
    db, mailer, identity, ctx, row.clubSlug, row, "activation", now,
    `AND activationTokenHash = ?`, [tokenHash],
  );
}

export type SweepResult = {
  reminders: ActivationBatchResult;
  /** Pending contacts deleted after the retention period. */
  lapsed: number;
  lapsedRemaining: number;
};

/**
 * Housekeeping for unactivated contacts: send the one reminder, then delete
 * what has lapsed. Pages has no cron, so an admin session drives this.
 */
export async function sweepUnactivatedContacts(
  db: D1Database,
  ctx: MailContext,
  { clubSlug, actorId, now = nowMs() }: { clubSlug: string; actorId: string; now?: number },
): Promise<SweepResult> {
  const lapse = await purgeLapsedPendingContacts(db, { clubSlug, actorId, now });
  // Reminders are bounded so the whole sweep stays under the D1 query cap:
  // the lapse chunk uses at most ~45 statements only when there is plenty to
  // delete, in which case skip reminders this call.
  const reminders = lapse.purged.length > 5
    ? { configured: true, sent: 0, failed: 0, remaining: 0 }
    : await sendActivationBatch(db, ctx, {
        clubSlug, actorId, kind: "reminder", limit: 8, now,
      });
  return { reminders, lapsed: lapse.purged.length, lapsedRemaining: lapse.remaining };
}

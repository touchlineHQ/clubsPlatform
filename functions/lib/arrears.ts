import { billingIdFromJoinSql, billingMergeJoinSql, subscriptionLevelJoinSql } from "./registration-merge";
import { SUBSCRIPTION_LABEL_SQL } from "./registration-query";

/**
 * Arrears (#77): the club's live registrations that are not paying, plus any
 * whose Direct Debit has a failed collection that has not since succeeded.
 *
 * "Live" is FA registration status Active, the same allowlist the send guard
 * uses for operational mail, so the list only shows people a reminder can reach.
 */

/** Audit action for a reminder send; the audit log is the chase history. */
export const ARREARS_REMINDER_ACTION = "arrears_reminder_sent";

export const REMINDER_TEMPLATES = ["outstanding", "failed_payment"] as const;
export type ReminderTemplate = (typeof REMINDER_TEMPLATES)[number];

export function isReminderTemplate(v: unknown): v is ReminderTemplate {
  return typeof v === "string" && (REMINDER_TEMPLATES as readonly string[]).includes(v);
}

/** Why a row is in arrears. A failed collection wins over the badge label. */
export type ArrearsReason = "failed_payment" | "no_payment" | "mandate_only" | "cancelled";

export const MAX_ARREARS_ROWS = 500;

const BILLING_ID = billingIdFromJoinSql("pr");

/** Most recent unresolved failure on the registration that pays for `pr`. */
const OPEN_FAILURE_SQL = `(SELECT MAX(pf."failedAt") FROM "payment_failure" pf
    WHERE pf."registrationId" = ${BILLING_ID} AND pf."resolvedAt" IS NULL)`;

const OPEN_FAILURE_CAUSE_SQL = `(SELECT pf."cause" FROM "payment_failure" pf
    WHERE pf."registrationId" = ${BILLING_ID} AND pf."resolvedAt" IS NULL
    ORDER BY pf."failedAt" DESC LIMIT 1)`;

const contactCount = (predicate: string) => `(SELECT COUNT(*) FROM "player_contact" pc
    WHERE pc."clubSlug" = pr."clubSlug" AND pc."playerId" = pr."playerId" AND ${predicate})`;

export type ArrearsFilters = { teamName: string | null; minDays: number | null; now: number };

export function arrearsQuery(clubSlug: string, f: ArrearsFilters): { sql: string; bindings: unknown[] } {
  const where: string[] = [
    `pr."clubSlug" = ?`,
    `LOWER(COALESCE(pr."registrationStatus", '')) = 'active'`,
  ];
  const bindings: unknown[] = [clubSlug];
  if (f.teamName) {
    where.push(`pr."teamName" = ?`);
    bindings.push(f.teamName);
  }
  if (f.minDays !== null) {
    where.push(`pr."createdAt" <= ?`);
    bindings.push(f.now - f.minDays * 86_400_000);
  }
  const sql = `SELECT * FROM (
    SELECT
      pr."id"           AS registrationId,
      p."fanId"         AS fanId,
      pr."teamName"     AS teamName,
      pr."createdAt"    AS registeredAt,
      sl."name"         AS subscriptionLevelName,
      (${SUBSCRIPTION_LABEL_SQL}) AS subscriptionLabel,
      ${OPEN_FAILURE_SQL}        AS failedAt,
      ${OPEN_FAILURE_CAUSE_SQL}  AS failureCause,
      ${contactCount(`pc."state" = 'confirmed' AND pc."operationalOptIn" = 1`)} AS reachableContacts,
      ${contactCount(`pc."state" = 'confirmed' AND pc."operationalOptIn" = 0`)} AS objectedContacts,
      ${contactCount(`pc."state" = 'pending'`)} AS pendingContacts,
      ${contactCount(`pc."state" IN ('withdrawn', 'bounced')`)} AS unreachableContacts,
      (SELECT MAX(a."createdAt") FROM "admin_audit_log" a
        WHERE a."targetId" = pr."id" AND a."clubSlug" = pr."clubSlug" AND a."action" = '${ARREARS_REMINDER_ACTION}') AS lastChasedAt,
      (SELECT COUNT(*) FROM "admin_audit_log" a
        WHERE a."targetId" = pr."id" AND a."clubSlug" = pr."clubSlug" AND a."action" = '${ARREARS_REMINDER_ACTION}') AS chaseCount
    FROM "player_registration" pr
    JOIN "player" p ON p."id" = pr."playerId"
    ${billingMergeJoinSql("pr")}
    ${subscriptionLevelJoinSql("pr")}
    WHERE ${where.join(" AND ")}
  ) t
  WHERE t.failedAt IS NOT NULL OR t.subscriptionLabel NOT IN ('Paid in full', 'Paying')
  ORDER BY t.teamName ASC, t.registeredAt ASC, t.registrationId ASC
  LIMIT ${MAX_ARREARS_ROWS + 1}`;
  return { sql, bindings };
}

export function arrearsReason(row: { failedAt: number | null; subscriptionLabel: string }): ArrearsReason {
  if (row.failedAt !== null) return "failed_payment";
  if (row.subscriptionLabel === "Mandate set up") return "mandate_only";
  if (row.subscriptionLabel === "Cancelled") return "cancelled";
  return "no_payment";
}

/** Reminder copy. Names the club and the team, never the player (we hold no name). */
export function reminderMessage(
  template: ReminderTemplate,
  ctx: { clubName: string; teamName: string; fanId: string; payUrl: string },
): { subject: string; text: string } {
  const who = `the ${ctx.teamName} registration (FAN ${ctx.fanId})`;
  if (template === "failed_payment") {
    return {
      subject: `${ctx.clubName}: a subscription payment didn't go through`,
      text: [
        `A recent Direct Debit payment for ${who} at ${ctx.clubName} failed.`,
        `Please check your bank details or set up the payment again here: ${ctx.payUrl}`,
        `If you think this is a mistake, reply to this email and the club will look into it.`,
      ].join("\n\n"),
    };
  }
  return {
    subject: `${ctx.clubName}: subscription reminder`,
    text: [
      `Our records show the subscription for ${who} at ${ctx.clubName} is still outstanding.`,
      `You can set it up here: ${ctx.payUrl}`,
      `If you've already paid or arranged this with the club, reply to this email and we'll update our records.`,
    ].join("\n\n"),
  };
}

import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requirePermission,
  getClubSlug,
  isMultiClubMode,
} from "../../lib/api-helpers";
import { prepareAuditLog } from "../../lib/audit-log";
import { getClubIdentity } from "../../lib/club-identity";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { sendClubEmail } from "../../lib/send-guard";
import { clubSiteBase, textToHtml } from "../../lib/announcement";
import { ARREARS_REMINDER_ACTION, isReminderTemplate, reminderMessage } from "../../lib/arrears";

/**
 * Arrears reminders (#77).
 *
 * POST { registrationIds, template } sends one operational reminder per
 * registration to that player's contacts through the send guard, so a contact
 * who has objected to service mail (operationalOptIn = 0), has not activated,
 * or has bounced is dropped and reported, never mailed. Every registration
 * chased gets an admin_audit_log row, which is the chase history.
 *
 * GET ?registrationId= returns that history.
 */

// A batch is bounded by D1 work, not just bind parameters. Each registration
// costs one contact lookup, then per contact a registration probe, an
// unsubscribe-token insert and a send-event insert, then one audit insert. An
// imported player has at most 11 contacts (player + 10 parent emails, see
// IMPORT_LIMITS), so 35 queries. Against the 1,000 queries a Worker invocation
// may make, the fixed reserve covers auth and the lookups (50) plus a cold-start
// ensureTables (133 statements), which leaves room for 23. ArrearsTab's CHUNK
// mirrors this. Contacts can also be added by hand, so onRequestPost re-checks
// the batch against each player's actual contact count before sending anything.
export const REMINDER_QUERY_BUDGET = 1000;
export const REMINDER_COLD_START_QUERIES = 133;
export const REMINDER_FIXED_QUERIES = 50 + REMINDER_COLD_START_QUERIES;
export const REMINDER_MAX_CONTACTS = 11;
export const REMINDER_QUERIES_PER_REGISTRATION = 1 + 3 * REMINDER_MAX_CONTACTS + 1;
export const MAX_REMINDER_BATCH = Math.floor(
  (REMINDER_QUERY_BUDGET - REMINDER_FIXED_QUERIES) / REMINDER_QUERIES_PER_REGISTRATION,
);

type SendBody = { registrationIds?: unknown; template?: unknown };

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "payments");
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: SendBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return json({ error: "Malformed JSON body" }, { status: 400 });
  if (!isReminderTemplate(body.template)) {
    return json({ error: "template must be outstanding or failed_payment" }, { status: 400 });
  }
  const template = body.template;
  const ids = body.registrationIds;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string" && i)) {
    return json({ error: "registrationIds must be a non-empty array of ids" }, { status: 400 });
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length > MAX_REMINDER_BATCH) {
    return json({ error: `At most ${MAX_REMINDER_BATCH} registrations per send` }, { status: 400 });
  }

  // Club-scoped lookup: an id from another club simply is not found.
  const placeholders = unique.map(() => "?").join(", ");
  const found = await context.env.DB
    .prepare(
      `SELECT pr."id" AS registrationId, pr."playerId" AS playerId, pr."teamName" AS teamName, p."fanId" AS fanId
         FROM "player_registration" pr JOIN "player" p ON p."id" = pr."playerId"
        WHERE pr."clubSlug" = ? AND pr."id" IN (${placeholders})`,
    )
    .bind(clubSlug, ...unique)
    .all<{ registrationId: string; playerId: string; teamName: string; fanId: string }>();
  const foundRegs = found.results ?? [];
  const foundIds = new Set(foundRegs.map((r) => r.registrationId));
  const notFound = unique.filter((id) => !foundIds.has(id));

  // "A Direct Debit payment failed" is only true for a registration whose
  // billing row has an unresolved failure; anyone else is skipped and reported
  // rather than sent a message that isn't true.
  let skipped: Array<{ registrationId: string; reason: "no_failed_payment" }> = [];
  let regs = foundRegs;
  if (template === "failed_payment" && foundRegs.length > 0) {
    const ph = foundRegs.map(() => "?").join(", ");
    const failing = await context.env.DB
      .prepare(
        `SELECT pr."id" AS registrationId
           FROM "player_registration" pr
           LEFT JOIN "registration_merge" rm0
             ON rm0."registrationId" = pr."id" AND rm0."clubSlug" = pr."clubSlug"
          WHERE pr."clubSlug" = ? AND pr."id" IN (${ph})
            AND EXISTS (SELECT 1 FROM "payment_failure" pf
                         WHERE pf."registrationId" = COALESCE(rm0."primaryRegistrationId", pr."id")
                           AND pf."resolvedAt" IS NULL)`,
      )
      .bind(clubSlug, ...foundRegs.map((r) => r.registrationId))
      .all<{ registrationId: string }>();
    const ok = new Set((failing.results ?? []).map((r) => r.registrationId));
    regs = foundRegs.filter((r) => ok.has(r.registrationId));
    skipped = foundRegs
      .filter((r) => !ok.has(r.registrationId))
      .map((r) => ({ registrationId: r.registrationId, reason: "no_failed_payment" as const }));
  }

  // Project the real D1 cost from each player's contact count and refuse the
  // whole batch up front, so a request never runs out of queries part-way
  // through and leaves some reminders sent and others not.
  if (regs.length > 0) {
    const playerIds = [...new Set(regs.map((r) => r.playerId))];
    const counts = await context.env.DB
      .prepare(
        `SELECT "playerId" AS playerId, COUNT(*) AS contactCount
           FROM "player_contact"
          WHERE "clubSlug" = ? AND "playerId" IN (${playerIds.map(() => "?").join(", ")})
          GROUP BY "playerId"`,
      )
      .bind(clubSlug, ...playerIds)
      .all<{ playerId: string; contactCount: number }>();
    const contactCounts = new Map((counts.results ?? []).map((r) => [r.playerId, Number(r.contactCount)]));
    const projected = REMINDER_FIXED_QUERIES + regs.reduce(
      (total, r) => total + 2 + 3 * (contactCounts.get(r.playerId) ?? 0),
      0,
    );
    if (projected > REMINDER_QUERY_BUDGET) {
      return json(
        { error: "These players have too many contacts to remind in one send. Select fewer registrations." },
        { status: 400 },
      );
    }
  }

  const identity = await getClubIdentity(context.env.DB, clubSlug);
  const clubName = identity?.name ?? "Your club";
  const origin = new URL(context.request.url).origin;
  const payUrl = `${clubSiteBase(origin, clubSlug, isMultiClubMode(context.env))}#/registrations`;
  const adminId = (auth.session.user as Record<string, unknown>).id as string;

  const results: Array<{
    registrationId: string;
    sent: number;
    dropped: Array<{ contactId: string; dropReason: string }>;
    mailConfigured: boolean;
  }> = [];

  for (const reg of regs) {
    const msg = reminderMessage(template, { clubName, teamName: reg.teamName, fanId: reg.fanId, payUrl });
    const result = await sendClubEmail(context.env, context.env.DB, {
      clubSlug,
      purpose: "operational",
      audience: { type: "player", playerId: reg.playerId },
      subject: msg.subject,
      html: textToHtml(msg.text),
      text: msg.text,
      initiatedBy: adminId,
      clubName,
      origin,
    });
    const sent = result.sent.filter((s) => s.outcome === "sent").length;
    const dropped = result.dropped.map((d) => ({ contactId: d.contactId, dropReason: d.dropReason }));
    await prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: ARREARS_REMINDER_ACTION,
      targetTable: "player_registration",
      targetId: reg.registrationId,
      newStatus: template,
      note: JSON.stringify({
        sent,
        dropped: dropped.length,
        reasons: [...new Set(dropped.map((d) => d.dropReason))],
        mailConfigured: result.mailConfigured,
        batchId: result.batchId,
      }),
    }).run();
    results.push({ registrationId: reg.registrationId, sent, dropped, mailConfigured: result.mailConfigured });
  }

  const posthog = getPostHog(context.env);
  if (posthog && results.length > 0) {
    context.waitUntil(
      posthog
        .captureImmediate({
          distinctId: adminId,
          event: "arrears reminders sent",
          ...clubGroups(clubSlug),
          properties: {
            club_slug: clubSlug,
            template,
            registrations: results.length,
            sent: results.reduce((n, r) => n + r.sent, 0),
            dropped: results.reduce((n, r) => n + r.dropped.length, 0),
          },
        })
        .catch((err) => console.error("PostHog capture failed", err)),
    );
  }

  return json({ ok: true, template, results, notFound, skipped });
};

type HistoryRow = { createdAt: number; adminId: string; adminName: string | null; template: string | null; note: string | null };

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "payments");
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });
  const registrationId = new URL(context.request.url).searchParams.get("registrationId")?.trim();
  if (!registrationId) return json({ error: "registrationId is required" }, { status: 400 });

  const res = await context.env.DB
    .prepare(
      `SELECT a."createdAt" AS createdAt, a."adminId" AS adminId, u."name" AS adminName,
              a."newStatus" AS template, a."note" AS note
         FROM "admin_audit_log" a
         LEFT JOIN "user" u ON u."id" = a."adminId"
        WHERE a."targetId" = ? AND a."clubSlug" = ? AND a."action" = ?
        ORDER BY a."createdAt" DESC
        LIMIT 100`,
    )
    .bind(registrationId, clubSlug, ARREARS_REMINDER_ACTION)
    .all<HistoryRow>();

  const history = (res.results ?? []).map((r) => {
    let detail: { sent?: number; dropped?: number; reasons?: string[] } = {};
    try {
      detail = r.note ? JSON.parse(r.note) : {};
    } catch {
      /* older/hand-written note */
    }
    return {
      at: r.createdAt,
      by: r.adminName ?? r.adminId,
      template: r.template,
      sent: detail.sent ?? null,
      dropped: detail.dropped ?? null,
      reasons: detail.reasons ?? [],
    };
  });
  return json({ history });
};

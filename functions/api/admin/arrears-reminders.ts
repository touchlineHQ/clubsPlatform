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

const MAX_REMINDER_BATCH = 100;

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
  const regs = found.results ?? [];
  const foundIds = new Set(regs.map((r) => r.registrationId));
  const notFound = unique.filter((id) => !foundIds.has(id));

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

  return json({ ok: true, template, results, notFound });
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

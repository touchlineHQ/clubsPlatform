import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requirePermission,
  getClubSlug,
  isMultiClubMode,
} from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  sendActivationBatch,
  sweepUnactivatedContacts,
} from "../../lib/activation-mail";

/**
 * Admin: drive activation mail for pending contacts (#132).
 *
 *   { action: "send" }   — one capped batch of first activation mails; the
 *                          client repeats while `remaining` > 0.
 *   { action: "sweep" }  — the one reminder, then deletion of lapsed pending
 *                          contacts. Pages has no cron, so an admin session
 *                          calls this.
 *
 * A mail-provider failure is counted, never a 500.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "members");
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: { action?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (body.action !== "send" && body.action !== "sweep") {
    return json({ error: "action must be 'send' or 'sweep'" }, { status: 400 });
  }

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const ctx = {
    env: context.env,
    origin: new URL(context.request.url).origin,
    multiClub: isMultiClubMode(context.env),
  };
  const posthog = getPostHog(context.env);

  if (body.action === "send") {
    const result = await sendActivationBatch(context.env.DB, ctx, {
      clubSlug, actorId: adminId, kind: "activation",
    });
    if (posthog && (result.sent > 0 || result.failed > 0)) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "activation emails sent",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          kind: "activation",
          sent_count: result.sent,
          failed_count: result.failed,
        },
      });
    }
    return json(result);
  }

  const result = await sweepUnactivatedContacts(context.env.DB, ctx, {
    clubSlug, actorId: adminId,
  });
  if (posthog) {
    if (result.reminders.sent > 0 || result.reminders.failed > 0) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "activation emails sent",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          kind: "reminder",
          sent_count: result.reminders.sent,
          failed_count: result.reminders.failed,
        },
      });
    }
    if (result.lapsed > 0) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "unactivated contacts lapsed",
        ...clubGroups(clubSlug),
        properties: { club_slug: clubSlug, lapsed_count: result.lapsed },
      });
    }
  }
  return json(result);
};

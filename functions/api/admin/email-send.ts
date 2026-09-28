import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requireAdmin,
  getClubSlug,
} from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  parseEmailPurpose,
  parseSendAudience,
  sendClubEmail,
} from "../../lib/send-guard";

/**
 * Admin send through the structural guard (#133).
 *
 * Body must name a purpose and an audience (team / club / player / contact id).
 * Recipients are never supplied — no `to`, `emails`, or `recipients` fields.
 * Marketing preference cannot be set here.
 */

type SendBody = {
  purpose?: unknown;
  audience?: unknown;
  subject?: unknown;
  html?: unknown;
  text?: unknown;
  fromName?: unknown;
  replyTo?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: SendBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }

  // Reject any attempt to drive recipients or marketing preference at the call site.
  const forbiddenKeys = [
    "to", "email", "emails", "recipients", "addresses",
    "marketingOptIn", "marketing", "operationalOptIn",
  ];
  for (const key of forbiddenKeys) {
    if (body && typeof body === "object" && key in body) {
      return json(
        {
          error:
            "Recipients and marketing preferences cannot be supplied; "
            + "purpose + audience decide eligibility, and only the parent sets marketing",
          code: "forbidden_call_site_field",
          field: key,
        },
        { status: 403 },
      );
    }
  }

  const purpose = parseEmailPurpose(body.purpose);
  if (!purpose) {
    return json(
      { error: "purpose must be transactional, operational, or marketing" },
      { status: 400 },
    );
  }

  const audience = parseSendAudience(body.audience);
  if (!audience) {
    return json(
      {
        error:
          "audience is required as { type: 'team'|'club'|'player'|'contact', ... } "
          + "without email addresses",
      },
      { status: 400 },
    );
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const html = typeof body.html === "string" ? body.html : "";
  const text = typeof body.text === "string" ? body.text : "";
  if (!subject) return json({ error: "subject is required" }, { status: 400 });
  if (!html && !text) return json({ error: "html or text is required" }, { status: 400 });

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const fromName = typeof body.fromName === "string" ? body.fromName : undefined;
  const replyTo = typeof body.replyTo === "string" ? body.replyTo : undefined;

  const result = await sendClubEmail(context.env, context.env.DB, {
    clubSlug,
    purpose,
    audience,
    subject,
    html: html || text,
    text: text || html.replace(/<[^>]+>/g, " "),
    fromName,
    replyTo,
    initiatedBy: adminId,
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    const sentCount = result.sent.filter((s) => s.outcome === "sent").length;
    const skipped = result.sent.filter((s) => s.outcome === "skipped_unconfigured").length;
    if (sentCount > 0 || skipped > 0) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "club email send completed",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          purpose,
          audience_type: audience.type,
          sent: sentCount,
          skipped_unconfigured: skipped,
          dropped: result.dropped.length,
          batch_id: result.batchId,
          mail_configured: result.mailConfigured,
        },
      });
    }
    if (result.dropped.length > 0) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "club email recipients dropped",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          purpose,
          audience_type: audience.type,
          dropped: result.dropped.length,
          reasons: result.dropped.map((d) => d.dropReason),
          batch_id: result.batchId,
        },
      });
    }
  }

  return json({
    ok: true,
    batchId: result.batchId,
    purpose,
    audience,
    mailConfigured: result.mailConfigured,
    sent: result.sent,
    dropped: result.dropped,
    eligibleCount: result.resolution.eligible.length,
    droppedCount: result.resolution.dropped.length,
  });
};

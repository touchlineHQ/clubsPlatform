import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requireAdmin,
  getClubSlug,
  isMultiClubMode,
} from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  ParentConsentError,
  askParentForContactConsent,
  consentFormUrl,
  listContactsForFan,
} from "../../lib/parent-consent";

/**
 * Admin: list player_contact rows for a FAN, and mint a parent consent link
 * (#149). Marketing cannot be set from this endpoint.
 */

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const fanId = new URL(context.request.url).searchParams.get("fanId")?.trim() ?? "";
  if (!fanId) return json({ error: "fanId is required" }, { status: 400 });

  const contacts = await listContactsForFan(context.env.DB, clubSlug, fanId);
  return json({ fanId, contacts });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: {
    fanId?: unknown;
    email?: unknown;
    relationship?: unknown;
  };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const fanId = typeof body.fanId === "string" ? body.fanId.trim() : "";
  const email = typeof body.email === "string" ? body.email : "";
  const relationship = body.relationship === "self" ? "self" as const : "guardian" as const;
  if (!fanId) return json({ error: "fanId is required" }, { status: 400 });
  if (!email.trim()) return json({ error: "email is required" }, { status: 400 });

  // Reject any attempt to set marketing on the parent's behalf.
  if (
    body
    && typeof body === "object"
    && ("marketingOptIn" in body || "marketing" in body || "operationalOptIn" in body)
  ) {
    return json(
      { error: "Admin cannot set marketing or operational opt-in; the parent form owns those" },
      { status: 403 },
    );
  }

  const adminId = (auth.session.user as Record<string, unknown>).id as string;

  try {
    const result = await askParentForContactConsent(context.env.DB, {
      clubSlug,
      fanId,
      email,
      relationship,
      sourcedBy: adminId,
    });

    const origin = new URL(context.request.url).origin;
    const consentUrl = consentFormUrl(
      origin,
      clubSlug,
      result.token,
      isMultiClubMode(context.env),
    );

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "parent consent link created",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          contact_id: result.contactId,
          created: result.created,
        },
      });
    }

    return json({
      ok: true,
      contactId: result.contactId,
      state: result.state,
      email: result.email,
      expiresAt: result.expiresAt,
      consentPath: result.consentPath,
      // Absolute URL for WhatsApp / existing email. Token returned once.
      consentUrl,
      token: result.token,
      created: result.created,
    }, { status: result.created ? 201 : 200 });
  } catch (err) {
    if (err instanceof ParentConsentError) {
      const status =
        err.code === "not_found" || err.code === "player_not_found" ? 404
          : err.code === "no_signoff" ? 409
            : err.code === "invalid_email" ? 400
              : err.code === "invalid_state" ? 409
                : 400;
      return json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
};

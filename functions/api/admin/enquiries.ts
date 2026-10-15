import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, nowMs, requirePermission, getClubSlug } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { deleteEnquiry, isEnquiryStatus, purgeStaleEnquiries, setEnquiryStatus } from "../../lib/enquiries";

/**
 * Secretary triage of player enquiries (#73). Needs the `members` permission
 * (admin, secretary).
 *
 * GET              → the club's enquiries, newest first (runs the stale purge first)
 * PATCH {id,status} → move along new → contacted → fa_sent → registered | declined
 * DELETE ?id=      → one-click erasure
 */

const LIST_LIMIT = 200;

async function capture(env: Env, actorId: string, clubSlug: string, e: { event: string; properties: Record<string, unknown> }) {
  const posthog = getPostHog(env);
  if (!posthog) return;
  try {
    await posthog.captureImmediate({ distinctId: actorId, event: e.event, ...clubGroups(clubSlug), properties: { club_slug: clubSlug, ...e.properties } });
  } catch {
    // ignore
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "members");
  if ("error" in auth) return auth.error;
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  await purgeStaleEnquiries(context.env.DB, nowMs());
  const { results } = await context.env.DB
    .prepare(
      `SELECT "id", "ageGroup", "team", "enquirerType", "contactName", "contactEmail", "contactPhone",
        "playerFirstName", "status", "contactPurgedAt", "createdAt", "updatedAt"
       FROM "player_enquiry" WHERE "clubSlug" = ? ORDER BY "createdAt" DESC LIMIT ${LIST_LIMIT}`,
    )
    .bind(clubSlug)
    .all();
  return json({ items: results ?? [] });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "members");
  if ("error" in auth) return auth.error;
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: { id?: unknown; status?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id || !isEnquiryStatus(body.status)) return json({ error: "id and a valid status are required" }, { status: 400 });

  const ok = await setEnquiryStatus(context.env.DB, clubSlug, id, body.status, nowMs());
  if (!ok) return json({ error: "Enquiry not found" }, { status: 404 });
  const actorId = (auth.session.user as Record<string, unknown>).id as string;
  await capture(context.env, actorId, clubSlug, { event: "player enquiry status changed", properties: { enquiry_id: id, status: body.status } });
  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requirePermission(context, "members");
  if ("error" in auth) return auth.error;
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const id = new URL(context.request.url).searchParams.get("id") ?? "";
  if (!id) return json({ error: "id is required" }, { status: 400 });
  const ok = await deleteEnquiry(context.env.DB, clubSlug, id);
  if (!ok) return json({ error: "Enquiry not found" }, { status: 404 });
  const actorId = (auth.session.user as Record<string, unknown>).id as string;
  await capture(context.env, actorId, clubSlug, { event: "player enquiry deleted", properties: { enquiry_id: id } });
  return json({ ok: true });
};

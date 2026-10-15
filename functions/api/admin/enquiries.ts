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

export const LIST_LIMIT = 200;

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

  const url = new URL(context.request.url);
  const rawOffset = Number(url.searchParams.get("offset") ?? "0");
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;

  await purgeStaleEnquiries(context.env.DB, nowMs());
  // Fetch one extra row so the client knows when older enquiries remain.
  const { results } = await context.env.DB
    .prepare(
      `SELECT "id", "ageGroup", "team", "enquirerType", "contactName", "contactEmail", "contactPhone",
        "playerFirstName", "status", "contactPurgedAt", "createdAt", "updatedAt"
       FROM "player_enquiry" WHERE "clubSlug" = ? ORDER BY "createdAt" DESC LIMIT ? OFFSET ?`,
    )
    .bind(clubSlug, LIST_LIMIT + 1, offset)
    .all();
  const rows = results ?? [];
  const hasMore = rows.length > LIST_LIMIT;
  const items = hasMore ? rows.slice(0, LIST_LIMIT) : rows;
  return json({ items, hasMore, offset, limit: LIST_LIMIT });
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
  context.waitUntil(capture(context.env, actorId, clubSlug, { event: "player enquiry status changed", properties: { enquiry_id: id, status: body.status } }));
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
  context.waitUntil(capture(context.env, actorId, clubSlug, { event: "player enquiry deleted", properties: { enquiry_id: id } }));
  return json({ ok: true });
};

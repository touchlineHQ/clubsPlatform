import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, requireAdmin, getClubSlug } from "../lib/api-helpers";
import { prepareAuditLog } from "../lib/audit-log";
import { deploymentDefault, getClubFeatures, isClubFeature } from "../lib/club-features";

/**
 * Per-club feature switches (#83).
 *
 * GET returns the club's resolved features (public: it only says which sidebar
 * items exist) plus, per feature, whether the deployment has it killed, so the
 * admin toggle can say why it cannot be turned on.
 *
 * PUT { feature, enabled } is club-admin only and scoped to the X-Club-Slug
 * club, so enabling a feature for one club never touches another. It is
 * audit-logged like going live.
 */

async function describe(env: Env, clubSlug: string) {
  const features = await getClubFeatures(env, env.DB, clubSlug);
  const killed = { pitchBookings: deploymentDefault(env, "pitchBookings") === "killed" };
  return { features, killed };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });
  return json(await describe(context.env, clubSlug));
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: { feature?: unknown; enabled?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  if (!body || !isClubFeature(body.feature)) return json({ error: "Unknown feature" }, { status: 400 });
  if (typeof body.enabled !== "boolean") return json({ error: "enabled must be a boolean" }, { status: 400 });
  const feature = body.feature;

  const club = await context.env.DB
    .prepare(`SELECT id FROM club_config WHERE slug = ? AND active = 1`)
    .bind(clubSlug)
    .first<{ id: string }>();
  if (!club) return json({ error: "Club not found" }, { status: 404 });

  const before = (await getClubFeatures(context.env, context.env.DB, clubSlug))[feature];
  const adminId = (auth.session.user as Record<string, unknown>).id as string;

  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `INSERT INTO "club_feature" (clubSlug, feature, enabled, updatedBy, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (clubSlug, feature) DO UPDATE SET
           enabled = excluded.enabled, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
      )
      .bind(clubSlug, feature, body.enabled ? 1 : 0, adminId, nowMs()),
    prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: "club.feature",
      targetTable: "club_feature",
      targetId: `${clubSlug}:${feature}`,
      oldStatus: before ? "on" : "off",
      newStatus: body.enabled ? "on" : "off",
      note: feature,
    }),
  ]);

  return json({ ok: true, ...(await describe(context.env, clubSlug)) });
};

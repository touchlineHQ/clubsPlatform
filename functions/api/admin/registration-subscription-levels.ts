import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug, nowMs } from "../../lib/api-helpers";
import { getPostHog } from "../../lib/posthog";

interface AssignBody {
  registrationId?: string;
  subscriptionLevelId?: string | null;
}

/**
 * Assign or clear a per-registration subscription level override.
 *
 * This is the highest-priority tier above team_status_subscription_level,
 * status_subscription_level, and team_subscription_level. It lets two
 * players on the same team be charged different rates while still drawing
 * from the club's existing subscription_level catalogue.
 *
 * Body:
 *   { registrationId, subscriptionLevelId }         → upsert override
 *   { registrationId, subscriptionLevelId: null }   → clear override
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "club slug header missing" }, { status: 400 });

  let body: AssignBody;
  try {
    body = await context.request.json<AssignBody>();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const registrationId = (body.registrationId ?? "").trim();
  if (!registrationId) return json({ error: "registrationId is required" }, { status: 400 });

  const registration = await context.env.DB
    .prepare(
      `SELECT id FROM "player_registration" WHERE id = ? AND clubSlug = ?`
    )
    .bind(registrationId, clubSlug)
    .first<{ id: string }>();
  if (!registration) {
    return json({ error: "registration not found for this club" }, { status: 404 });
  }

  const levelId = body.subscriptionLevelId ?? null;
  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);

  if (levelId === null) {
    await context.env.DB
      .prepare(
        `DELETE FROM "registration_subscription_level" WHERE registrationId = ?`
      )
      .bind(registrationId)
      .run();
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: 'subscription rate cleared',
        properties: {
          club_slug: clubSlug,
          registration_id: registrationId,
          scope: 'registration',
        },
      });
    }
    return json({ ok: true, cleared: true });
  }

  const level = await context.env.DB
    .prepare(`SELECT id FROM "subscription_level" WHERE id = ? AND clubSlug = ?`)
    .bind(levelId, clubSlug)
    .first<{ id: string }>();
  if (!level) return json({ error: "subscription level not found for this club" }, { status: 404 });

  await context.env.DB
    .prepare(
      `INSERT INTO "registration_subscription_level"
         (clubSlug, registrationId, subscriptionLevelId, updatedAt)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(registrationId) DO UPDATE SET
         subscriptionLevelId = excluded.subscriptionLevelId,
         updatedAt           = excluded.updatedAt`
    )
    .bind(clubSlug, registrationId, levelId, nowMs())
    .run();

  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'subscription rate assigned',
      properties: {
        club_slug: clubSlug,
        registration_id: registrationId,
        subscription_level_id: levelId,
        scope: 'registration',
      },
    });
  }

  return json({ ok: true });
};

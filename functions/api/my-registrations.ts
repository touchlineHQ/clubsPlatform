import { type Env, json, requireAuth, requireAdmin, getClubSlug, isMultiClubMode } from "../lib/api-helpers";

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  relationship: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
}

const PAYMENT_STATUS_SUBQUERY = `(
  SELECT CASE
    WHEN SUM(CASE WHEN pp.status = 'active' THEN 1 ELSE 0 END) > 0 THEN 'active'
    WHEN SUM(CASE WHEN pp.status = 'mandate_only' THEN 1 ELSE 0 END) > 0 THEN 'pending'
    WHEN COUNT(pp.id) > 0 THEN 'inactive'
    ELSE NULL
  END
  FROM "player_payment" pp WHERE pp.registrationId = pr.id
) AS paymentStatus`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;

  const { session } = result;
  const user = session.user as Record<string, unknown>;
  const userId = session.user.id;
  const role = (user.role as string) ?? "member";
  const userClubSlug = (user.clubSlug as string | null) ?? null;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) {
    return json({ error: "Missing X-Club-Slug header" }, { status: 400 });
  }

  const isAdmin = role === "admin";

  if (isAdmin && isMultiClubMode(context.env) && userClubSlug !== null && userClubSlug !== clubSlug) {
    return json({ error: "Access denied: club mismatch" }, { status: 403 });
  }

  const personalRows = await context.env.DB
    .prepare(
      `SELECT
         pr.id            AS registrationId,
         p.fanId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         up.relationship  AS relationship,
         NULL             AS linkedAccounts,
         sl.id            AS subscriptionLevelId,
         sl.name          AS subscriptionLevelName,
         ${PAYMENT_STATUS_SUBQUERY}
       FROM user_player up
       JOIN player p ON p.id = up.playerId
       JOIN player_registration pr ON pr.playerId = p.id
       LEFT JOIN team_subscription_level tsl
              ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
       LEFT JOIN subscription_level sl ON sl.id = tsl.subscriptionLevelId
       WHERE up.userId = ? AND pr.clubSlug = ?
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(userId, clubSlug)
    .all<RegistrationRow>();

  if (!isAdmin) {
    return json({
      personal: personalRows.results,
      club: null,
      scope: "user",
    });
  }

  const clubRows = await context.env.DB
    .prepare(
      `SELECT
         pr.id            AS registrationId,
         p.fanId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         NULL             AS relationship,
         GROUP_CONCAT(u.email || '|' || up.relationship, ',') AS linkedAccounts,
         sl.id            AS subscriptionLevelId,
         sl.name          AS subscriptionLevelName,
         ${PAYMENT_STATUS_SUBQUERY}
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       LEFT JOIN user_player up ON up.playerId = p.id
       LEFT JOIN "user" u ON u.id = up.userId
       LEFT JOIN team_subscription_level tsl
              ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
       LEFT JOIN subscription_level sl ON sl.id = tsl.subscriptionLevelId
       WHERE pr.clubSlug = ?
       GROUP BY pr.id
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(clubSlug)
    .all<RegistrationRow>();

  return json({
    personal: personalRows.results,
    club: clubRows.results,
    scope: "admin",
  });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const registrationId = url.searchParams.get("registrationId");
  if (!registrationId) {
    return json({ error: "registrationId is required" }, { status: 400 });
  }

  const result = await context.env.DB
    .prepare(`DELETE FROM "player_registration" WHERE id = ? AND clubSlug = ?`)
    .bind(registrationId, clubSlug)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: "registration not found" }, { status: 404 });
  }
  return json({ ok: true });
};

import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null; // "email|relationship,email|relationship"
  subscriptionLevelId: string | null;
  subscriptionLevelName: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: string | null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT
         p.fanId,
         pr.id            AS registrationId,
         pr.teamName,
         pr.ageGroup,
         pr.registrationExpiry,
         pr.registrationStatus,
         GROUP_CONCAT(u.email || '|' || up.relationship, ',') AS linkedAccounts,
         tsl.subscriptionLevelId            AS subscriptionLevelId,
         sl.name                            AS subscriptionLevelName,
         sl.yearlyPriceInPence              AS yearlyPriceInPence,
         sl.intervalCount                   AS intervalCount,
         sl.intervalUnit                    AS intervalUnit
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
    .all<PlayerRegistrationRow>();

  return json({ registrations: rows.results });
};

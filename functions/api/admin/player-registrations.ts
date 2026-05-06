import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null; // "email|relationship,email|relationship"
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
         GROUP_CONCAT(u.email || '|' || up.relationship, ',') AS linkedAccounts
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       LEFT JOIN user_player up ON up.playerId = p.id
       LEFT JOIN "user" u ON u.id = up.userId
       WHERE pr.clubSlug = ?
       GROUP BY pr.id
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(clubSlug)
    .all<PlayerRegistrationRow>();

  return json({ registrations: rows.results });
};

import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import {
  SUBSCRIPTION_LEVEL_ID_SQL,
  mergeColumnsSql,
  subscriptionLevelJoinSql,
} from "../../lib/registration-merge";

interface PlayerRegistrationRow {
  fanId: string;
  registrationId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null; // "email|relationship,email|relationship"
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  yearlyPriceInPence: number | null;
  intervalCount: number | null;
  intervalUnit: string | null;
  startDate: string | null;
  /** The registration whose payment covers this one — itself, unless merged. */
  billingRegistrationId: string;
  /** This registration's primary's team, when it is a secondary. */
  billedWithTeamName: string | null;
  /** The other teams this registration is billed for, when it is a primary. */
  mergedTeamNames: string | null;
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
         ${SUBSCRIPTION_LEVEL_ID_SQL} AS subscriptionLevelId,
         rsl.subscriptionLevelId            AS overrideLevelId,
         sl.name                            AS subscriptionLevelName,
         sl.yearlyPriceInPence              AS yearlyPriceInPence,
         sl.intervalCount                   AS intervalCount,
         sl.intervalUnit                    AS intervalUnit,
         sl.startDate                       AS startDate,
         ${mergeColumnsSql('pr')}
       FROM player_registration pr
       JOIN player p ON p.id = pr.playerId
       LEFT JOIN user_player up ON up.playerId = p.id
       LEFT JOIN "user" u ON u.id = up.userId
       ${subscriptionLevelJoinSql('pr')}
       WHERE pr.clubSlug = ?
       GROUP BY pr.id
       ORDER BY pr.teamName ASC, p.fanId ASC`
    )
    .bind(clubSlug)
    .all<PlayerRegistrationRow>();

  return json({ registrations: rows.results });
};

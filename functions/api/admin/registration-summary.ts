import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import {
  billingIdFromJoinSql,
  billingMergeJoinSql,
  subscriptionLevelJoinSql,
} from "../../lib/registration-merge";
import {
  HAS_LEVEL_SQL,
  PAYING_STATUSES_SQL,
  buildRegistrationFilters,
  paymentStatusSql,
  readFilters,
} from "../../lib/registration-query";

/**
 * The summary strip's counts, over the whole filtered set rather than a page.
 *
 * Returns the same shape as the client's `summariseRegistrations`, so
 * RegistrationsSummary renders it unchanged — but the club tab must stop
 * calling that helper, because the two disagree by design (below) and running
 * both would put two different sets of figures on one page.
 *
 * **Filters select rows; the counts are over the units those rows belong to.**
 * A billing unit enters the set when *any* of its members survives the filter,
 * and is then evaluated on the primary's own row.
 *
 * That last part is the deliberate divergence. `summariseRegistrations`
 * substitutes "the first member seen" when a filter hides the primary, which
 * can report a unit as having no level purely because of which member happened
 * to stay visible. Evaluating on the primary is strictly more correct — the
 * money genuinely lives there — and the visible consequence is that under
 * `team = 'U15 Thursday'` the `noLevel` tile can be non-zero while every row on
 * screen shows a level, because the primary is off-screen. The tile is labelled
 * Billable units.
 */

interface SummaryRow {
  registrations: number;
  players: number;
  billableUnits: number;
  paying: number;
  outstanding: number;
  noLevel: number;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const filters = buildRegistrationFilters(clubSlug, readFilters(url));
  if (filters.error) return json({ error: filters.error }, { status: 400 });

  // `paying` deliberately cuts across the other two, and `outstanding` and
  // `noLevel` do NOT partition the units: a unit with a level that is paying
  // increments neither. Deriving outstanding as billableUnits - noLevel would
  // over-report what the club is owed by exactly the paid-up count.
  const sql = `WITH "filtered" AS (
    SELECT pr."id"   AS "registrationId",
           p."fanId" AS "fanId",
           ${billingIdFromJoinSql("pr")} AS "unitId"
      FROM "player_registration" pr
      JOIN "player" p ON p."id" = pr."playerId"
      ${billingMergeJoinSql("pr")}
     WHERE ${filters.sql}
  ),
  "unit" AS (SELECT DISTINCT "unitId" FROM "filtered"),
  "classified" AS (
    SELECT
      CASE WHEN ${paymentStatusSql(true, `upr."id"`)} IN ${PAYING_STATUSES_SQL}
           THEN 1 ELSE 0 END AS "isPaying",
      CASE WHEN ${HAS_LEVEL_SQL} THEN 1 ELSE 0 END AS "hasLevel"
      FROM "unit"
      JOIN "player_registration" upr ON upr."id" = "unit"."unitId"
      ${subscriptionLevelJoinSql("upr")}
  )
  SELECT
    (SELECT COUNT(*)                FROM "filtered") AS "registrations",
    (SELECT COUNT(DISTINCT "fanId") FROM "filtered") AS "players",
    COUNT(*)                                         AS "billableUnits",
    COALESCE(SUM("isPaying"), 0)                     AS "paying",
    COALESCE(SUM(CASE WHEN "hasLevel" = 1 AND "isPaying" = 0 THEN 1 ELSE 0 END), 0) AS "outstanding",
    COALESCE(SUM(CASE WHEN "hasLevel" = 0 THEN 1 ELSE 0 END), 0)                    AS "noLevel"
  FROM "classified"`;

  const row = await context.env.DB
    .prepare(sql)
    .bind(...filters.bindings)
    .first<SummaryRow>();

  return json({
    registrations: row?.registrations ?? 0,
    players: row?.players ?? 0,
    billableUnits: row?.billableUnits ?? 0,
    paying: row?.paying ?? 0,
    outstanding: row?.outstanding ?? 0,
    noLevel: row?.noLevel ?? 0,
  });
};

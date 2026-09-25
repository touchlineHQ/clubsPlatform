import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import {
  SUBSCRIPTION_LEVEL_ID_SQL,
  subscriptionLevelJoinSql,
} from "../../lib/registration-merge";
import { buildSearchPredicate } from "../../lib/registration-query";

/**
 * Typeahead over the club's registrations, for the payment pages' player picker.
 *
 * This used to return every registration in the club, which is the same
 * unbounded read #114 removed from the registrations table. It is deliberately
 * *not* paginated though: both callers feed a Mantine `Select`, and a cursor is
 * the wrong shape for a picker — nobody pages through a dropdown. Search is.
 *
 * Two modes, and the second is not optional:
 *
 * - `?q=<prefix>` searches FAN ID and team name. Below MIN_QUERY_CHARS it
 *   returns nothing rather than the whole club, so an empty picker costs one
 *   trivial query instead of a full scan.
 * - `?registrationId=<id>` rehydrates one row by id. Without it a selection
 *   would vanish the moment the search text changed, because the option
 *   backing it would no longer be in the results.
 *
 * Both modes return the **full** row shape. The pricing fields autofill the
 * subscription form on select, so a by-id lookup that trimmed them would leave
 * the form silently blank.
 */

/** Below this, a search matches too much to be worth running. */
const MIN_QUERY_CHARS = 2;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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
}

/**
 * Linked accounts as a scalar subquery rather than a GROUP_CONCAT over a join.
 *
 * Same reasoning as the registrations list: a join plus GROUP BY has no defined
 * argument order, and the grouping costs the index-ordered walk that makes the
 * `q` prefix cheap.
 */
const LINKED_ACCOUNTS_SQL = `(SELECT GROUP_CONCAT(la."v", ',') FROM (
      SELECT u2."email" || '|' || up2."relationship" AS "v"
        FROM "user_player" up2
        JOIN "user" u2 ON u2."id" = up2."userId"
       WHERE up2."playerId" = pr."playerId"
       ORDER BY u2."email"
    ) la)`;

function selectSql(where: string, order: string, limit: boolean): string {
  return `SELECT
         p."fanId"                 AS fanId,
         pr."id"                   AS registrationId,
         pr."teamName"             AS teamName,
         pr."ageGroup"             AS ageGroup,
         pr."registrationExpiry"   AS registrationExpiry,
         pr."registrationStatus"   AS registrationStatus,
         ${LINKED_ACCOUNTS_SQL}    AS linkedAccounts,
         ${SUBSCRIPTION_LEVEL_ID_SQL} AS subscriptionLevelId,
         rsl."subscriptionLevelId" AS overrideLevelId,
         sl."name"                 AS subscriptionLevelName,
         sl."yearlyPriceInPence"   AS yearlyPriceInPence,
         sl."intervalCount"        AS intervalCount,
         sl."intervalUnit"         AS intervalUnit,
         sl."startDate"            AS startDate
       FROM "player_registration" pr
       JOIN "player" p ON p."id" = pr."playerId"
       ${subscriptionLevelJoinSql("pr")}
      WHERE ${where}
      ${order}${limit ? "\n      LIMIT ?" : ""}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);
  const registrationId = url.searchParams.get("registrationId")?.trim();

  // Rehydrating a selection: one row, by id, scoped to the club.
  if (registrationId) {
    const row = await context.env.DB
      .prepare(selectSql(`pr."clubSlug" = ? AND pr."id" = ?`, "", false))
      .bind(clubSlug, registrationId)
      .first<PlayerRegistrationRow>();

    return json({ registrations: row ? [row] : [] });
  }

  const q = url.searchParams.get("q")?.trim() ?? "";
  // Nothing rather than everything: the old behaviour here was the whole club.
  if (q.length < MIN_QUERY_CHARS) return json({ registrations: [], minQueryChars: MIN_QUERY_CHARS });

  // Presence-checked, not just parsed: Number(null) and Number("") are both 0,
  // which is finite, so a missing limit would clamp to 1 rather than default.
  const rawLimit = url.searchParams.get("limit")?.trim();
  const parsedLimit = rawLimit ? Number(rawLimit) : NaN;
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsedLimit)))
    : DEFAULT_LIMIT;

  // Shared with the club table's `q`, so both search boxes mean the same thing —
  // including the arm that matches a query typed as the label reads, `FAN 12345`.
  const search = buildSearchPredicate(q);

  const { results } = await context.env.DB
    .prepare(selectSql(
      `pr."clubSlug" = ?
        AND ${search.sql}`,
      `ORDER BY pr."teamName" COLLATE NOCASE ASC, p."fanId" COLLATE NOCASE ASC`,
      true,
    ))
    .bind(clubSlug, ...search.bindings, limit)
    .all<PlayerRegistrationRow>();

  return json({ registrations: results, limit });
};

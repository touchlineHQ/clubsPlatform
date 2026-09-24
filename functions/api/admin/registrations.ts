import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import {
  billingMergeJoinSql,
  mergedTeamNamesSql,
  subscriptionLevelJoinSql,
} from "../../lib/registration-merge";
import {
  buildCursorColumn,
  buildKeysetPredicate,
  buildOrderBy,
  fetchLimit,
  parsePageRequest,
  takePage,
} from "../../lib/pagination";
import {
  REGISTRATION_SORTS,
  buildRegistrationFilters,
  paymentStatusSql,
  readFilters,
} from "../../lib/registration-query";

/**
 * One page of the club's registrations.
 *
 * Replaces the club half of api/my-registrations.ts, which returned every
 * registration in the club in one response and did three more unbounded reads
 * alongside it. That endpoint keeps the personal tab and the import stamp.
 *
 * Keyset rather than OFFSET, and not primarily for scan cost: an admin sits on
 * this page while an import commits and while merges are applied, and OFFSET
 * under a shifting result set silently skips and duplicates rows.
 *
 * There is deliberately no `total`. A COUNT(*) over the filtered set is the
 * full scan this endpoint exists to escape; the counts come from
 * registration-summary as a separate request the UI renders as loading.
 */

interface RegistrationRow {
  registrationId: string;
  fanId: string;
  teamName: string;
  ageGroup: string | null;
  registrationExpiry: string | null;
  registrationStatus: string | null;
  linkedAccounts: string | null;
  subscriptionLevelId: string | null;
  overrideLevelId: string | null;
  subscriptionLevelName: string | null;
  paymentStatus: string | null;
  billingRegistrationId: string | null;
  billedWithTeamName: string | null;
  mergedTeamNames: string | null;
  /** The sort key, carried out of SQL so the cursor is never re-derived in JS. */
  __cursor?: string;
}

/** As api/my-registrations.ts: one pass, no database access. */
function omitMergeFieldsWhenUnmerged(rows: RegistrationRow[]): RegistrationRow[] {
  return rows.map((r) => {
    const { __cursor: _c, ...rest } = r;
    if (rest.billingRegistrationId || rest.mergedTeamNames) return rest as RegistrationRow;
    const { billingRegistrationId: _b, billedWithTeamName: _t, mergedTeamNames: _m, ...bare } = rest;
    return bare as RegistrationRow;
  });
}

const LINKED_ACCOUNTS_SQL = `(SELECT GROUP_CONCAT(la."v", ',') FROM (
      SELECT u2."email" || '|' || up2."relationship" AS "v"
        FROM "user_player" up2
        JOIN "user" u2 ON u2."id" = up2."userId"
       WHERE up2."playerId" = pr."playerId"
       ORDER BY u2."email"
    ) la)`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "Missing X-Club-Slug header" }, { status: 400 });

  const url = new URL(context.request.url);

  const parsed = parsePageRequest(
    {
      sort: url.searchParams.get("sort"),
      dir: url.searchParams.get("dir"),
      limit: url.searchParams.get("limit"),
      cursor: url.searchParams.get("cursor"),
    },
    REGISTRATION_SORTS,
    { sort: "teamName", dir: "asc" },
  );
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const page = parsed.value;

  const filters = buildRegistrationFilters(clubSlug, readFilters(url));
  if (filters.error) return json({ error: filters.error }, { status: 400 });

  const keyset = buildKeysetPredicate(page, REGISTRATION_SORTS, `pr."id"`);

  // No GROUP BY: linkedAccounts is a scalar subquery, so rows arrive in the
  // index's own order and idx_player_registration_club_team can satisfy the
  // default sort as a walk with an early exit rather than a temp B-tree.
  const sql = `SELECT
         pr."id"                 AS registrationId,
         p."fanId"               AS fanId,
         pr."teamName"           AS teamName,
         pr."ageGroup"           AS ageGroup,
         pr."registrationExpiry" AS registrationExpiry,
         pr."registrationStatus" AS registrationStatus,
         ${LINKED_ACCOUNTS_SQL}  AS linkedAccounts,
         sl."id"                 AS subscriptionLevelId,
         rsl."subscriptionLevelId" AS overrideLevelId,
         sl."name"               AS subscriptionLevelName,
         ${paymentStatusSql(true)} AS paymentStatus,
         rm0."primaryRegistrationId" AS billingRegistrationId,
         bpr."teamName"              AS billedWithTeamName,
         ${mergedTeamNamesSql("pr")} AS mergedTeamNames,
         ${buildCursorColumn(page, REGISTRATION_SORTS)}
       FROM "player_registration" pr
       JOIN "player" p ON p."id" = pr."playerId"
       ${billingMergeJoinSql("pr")}
       ${subscriptionLevelJoinSql("pr")}
      WHERE ${filters.sql}
        ${keyset.sql}
      ${buildOrderBy(page, REGISTRATION_SORTS, { idAlias: `pr."id"` })}
      LIMIT ?`;

  const { results } = await context.env.DB
    .prepare(sql)
    .bind(...filters.bindings, ...keyset.bindings, fetchLimit(page))
    .all<RegistrationRow>();

  const { items, nextCursor } = takePage(results, page, (row) => ({
    v: row.__cursor ?? "",
    id: row.registrationId,
  }));

  return json({
    rows: omitMergeFieldsWhenUnmerged(items),
    nextCursor,
    limit: page.limit,
  });
};

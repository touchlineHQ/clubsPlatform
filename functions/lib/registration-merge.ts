import type { D1Database } from '@cloudflare/workers-types';

/**
 * Merged registrations: one payment covering many registrations.
 *
 * An admin groups several of one player's registrations into a billing group.
 * One member is the primary and carries the payment; the rest are secondaries,
 * billed through it. Only secondaries get a `registration_merge` row, so an
 * unmerged registration is the trivial group of one.
 *
 * Two rules the call sites depend on:
 *
 * - **Gating reads** ("may this player be sent into the mandate flow?") cover
 *   every member, via `GROUP_MEMBER_IDS_SQL` — a row stranded on a secondary by
 *   an in-flight payment still means "do not charge again". **Write and
 *   attribution reads** key on the primary alone, so a group has one
 *   authoritative record.
 * - **The primary's team name is the group's billing identity.** The GoCardless
 *   reference is derived from it and `api/gocardless/confirm.ts` matches an
 *   existing subscription on that reference, so a group that has been paid
 *   cannot be re-pointed at a different primary without collecting twice.
 */

/** Resolves a registration to its billing registration id. `alias` is a caller-owned SQL alias. */
export function billingRegistrationIdSql(alias: string): string {
  return `COALESCE(
    (SELECT rm."primaryRegistrationId" FROM "registration_merge" rm WHERE rm."registrationId" = ${alias}."id"),
    ${alias}."id"
  )`;
}

/**
 * The club-scoped LEFT JOINs that resolve a registration to its billing row.
 *
 * Prefer this over {@link billingRegistrationJoinSql} on a read that also wants
 * the group's team names. Three reasons:
 *
 * - **LEFT, not INNER.** `primaryRegistrationId` is `ON DELETE RESTRICT`, so a
 *   dangling primary is unreachable today — but an inner join would *delete the
 *   row from the result* if that ever broke, and a merge bug that hides
 *   registrations from the admin list is far worse than one that shows a blank
 *   badge.
 * - **Club-scoped.** `billingRegistrationIdSql` does not constrain
 *   `registration_merge` by club, so a cross-club row (which the API prevents
 *   but the schema permits) would pull another club's team name onto the page.
 * - **Real columns.** `${merge}."primaryRegistrationId"` is then a column rather
 *   than a correlated subquery, so {@link billingIdFromJoinSql} is a COALESCE
 *   over two columns and stays cheap wherever it is repeated.
 *
 * `${merge}` is a PK seek (`registration_merge.registrationId` is the PRIMARY
 * KEY) and `${billing}` is a PK seek.
 */
export function billingMergeJoinSql(
  alias: string,
  merge = "rm0",
  billing = "bpr",
): string {
  return `LEFT JOIN "registration_merge" ${merge}
                ON ${merge}."registrationId" = ${alias}."id"
               AND ${merge}."clubSlug"       = ${alias}."clubSlug"
         LEFT JOIN "player_registration" ${billing}
                ON ${billing}."id" = ${merge}."primaryRegistrationId"`;
}

/** The billing id, once {@link billingMergeJoinSql} has supplied the columns. */
export function billingIdFromJoinSql(alias: string, merge = "rm0"): string {
  return `COALESCE(${merge}."primaryRegistrationId", ${alias}."id")`;
}

/**
 * The other teams a primary is billed for, as a `', '`-joined string.
 *
 * Walks `idx_registration_merge_primary`, so a primary names every sibling
 * whether or not the sibling is in the caller's result set — which is the whole
 * point once the caller only sees one page.
 *
 * Ordered by team name in a nested subquery rather than with `GROUP_CONCAT(x, s
 * ORDER BY y)`: that form needs SQLite 3.44+, and D1's version is pinned
 * nowhere in this repo. Without an explicit order `GROUP_CONCAT` is free to
 * return its arguments in any order, which reads as text flickering between
 * requests.
 */
export function mergedTeamNamesSql(alias: string): string {
  return `(SELECT GROUP_CONCAT(mt."t", ', ') FROM (
      SELECT mpr."teamName" AS "t"
        FROM "registration_merge" rm2
        JOIN "player_registration" mpr ON mpr."id" = rm2."registrationId"
       WHERE rm2."primaryRegistrationId" = ${alias}."id"
         AND rm2."clubSlug"              = ${alias}."clubSlug"
       ORDER BY mpr."teamName" COLLATE NOCASE
    ) mt)`;
}

/**
 * Joins `src` to the registration its money hangs off, bound to `dest`.
 *
 * A join rather than a separate lookup, so resolving costs no extra round trip.
 */
export function billingRegistrationJoinSql(src: string, dest: string): string {
  return `JOIN "player_registration" ${dest}
            ON ${dest}."id" = ${billingRegistrationIdSql(src)}`;
}

/** Every id in a group, for gating reads. Takes the primary's id as two bindings. */
export const GROUP_MEMBER_IDS_SQL = `(
  SELECT ?
   UNION
  SELECT "registrationId" FROM "registration_merge" WHERE "primaryRegistrationId" = ?
)`;

/** Level precedence, highest first: per-registration, team+status, status, team. */
export const SUBSCRIPTION_LEVEL_ID_SQL =
  `COALESCE(rsl."subscriptionLevelId", tssl."subscriptionLevelId", ssl."subscriptionLevelId", tsl."subscriptionLevelId")`;

/** The joins feeding {@link SUBSCRIPTION_LEVEL_ID_SQL}, lifted out of the five copies of this block. */
export function subscriptionLevelJoinSql(alias: string): string {
  return `LEFT JOIN "registration_subscription_level" rsl
                ON rsl."registrationId" = ${alias}."id"
         LEFT JOIN "team_status_subscription_level" tssl
                ON tssl."clubSlug" = ${alias}."clubSlug"
               AND tssl."teamName" = ${alias}."teamName"
               AND tssl."registrationStatus" = ${alias}."registrationStatus"
         LEFT JOIN "status_subscription_level" ssl
                ON ssl."clubSlug" = ${alias}."clubSlug"
               AND ssl."registrationStatus" = ${alias}."registrationStatus"
         LEFT JOIN "team_subscription_level" tsl
                ON tsl."clubSlug" = ${alias}."clubSlug"
               AND tsl."teamName" = ${alias}."teamName"
         LEFT JOIN "subscription_level" sl
                ON sl."id" = ${SUBSCRIPTION_LEVEL_ID_SQL}`;
}

/** The registration a payment should hang off; unchanged when unmerged, so callers apply it blind. */
export async function resolveBillingRegistrationId(
  db: D1Database,
  registrationId: string,
  clubSlug?: string,
): Promise<string> {
  const sql = clubSlug
    ? `SELECT "primaryRegistrationId" FROM "registration_merge" WHERE "registrationId" = ? AND "clubSlug" = ?`
    : `SELECT "primaryRegistrationId" FROM "registration_merge" WHERE "registrationId" = ?`;

  const bindings = clubSlug ? [registrationId, clubSlug] : [registrationId];

  const row = await db
    .prepare(sql)
    .bind(...bindings)
    .first<{ primaryRegistrationId: string }>();

  return row?.primaryRegistrationId ?? registrationId;
}

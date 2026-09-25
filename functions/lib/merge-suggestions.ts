/**
 * Registrations that look like they should be billed together but are not.
 *
 * Same player and same age group is a hint, never a decision: U18 Blue and U18
 * Purple share an age group and are two sets of subs, while U15s on different
 * days are billed once. Only the club knows which, so this surfaces candidates
 * and stops — and an admin who has ruled against one can dismiss it.
 *
 * A set is a candidate only while **every** member is billed separately. Once
 * any member is merged the admin has already ruled on it, which is why the
 * candidate scan excludes a registration that is either a secondary *or* a
 * primary of an existing group.
 *
 * The grouping used to live in the browser, in
 * `website/src/utils/mergeSuggestions.ts`, over the whole club held in memory.
 * #114 paged that array away, so it moved here. That module survives as the
 * executable spec these fragments mirror; its tests are the same cases
 * `functions/__tests__/api/admin-merge-suggestions.test.ts` asserts in SQL.
 */

/**
 * Case- and whitespace-insensitive, since age groups arrive from an FA export.
 *
 * Deliberately duplicated from `normaliseAgeGroup` in
 * `website/src/utils/mergeSuggestions.ts`: `website/src` compiles from its own
 * tsconfig and imports nothing from `functions/` (see the header of
 * `lib/payment-status.ts` for the house rule). {@link SUGGESTION_AGE_KEY_SQL}
 * is a third copy, in SQL, and all three must stay exactly equivalent — a
 * mismatch silently splits one candidate set into two.
 */
export function normaliseAgeGroup(ageGroup: string): string {
  return ageGroup.trim().toLowerCase();
}

/** The SQL spelling of {@link normaliseAgeGroup}, over a `player_registration` alias. */
export function suggestionAgeKeySql(alias = "pr"): string {
  return `LOWER(TRIM(${alias}."ageGroup"))`;
}

/**
 * The row-level candidate set for one club, as a CTE body. Binds `clubSlug`.
 *
 * The two `NOT EXISTS` clauses are an anti-join rather than
 * `billingMergeJoinSql`: a LEFT JOIN plus an `IS NULL` reads worse here, and
 * `lib/registration-merge.ts` warns against adding a third spelling of that
 * join. They are also what excludes a group's **primary** and not merely its
 * secondaries — a primary is already billing for the set, so re-suggesting it
 * would be suggesting what the admin just did.
 */
export function suggestionCandidateSql(alias = "pr"): string {
  return `SELECT ${alias}."id"        AS "registrationId",
                 ${alias}."playerId"  AS "playerId",
                 p."fanId"            AS "fanId",
                 ${alias}."teamName"  AS "teamName",
                 ${suggestionAgeKeySql(alias)} AS "ageKey",
                 TRIM(${alias}."ageGroup")     AS "ageGroup"
            FROM "player_registration" ${alias}
            JOIN "player" p ON p."id" = ${alias}."playerId"
           WHERE ${alias}."clubSlug" = ?
             AND TRIM(COALESCE(${alias}."ageGroup", '')) <> ''
             AND NOT EXISTS (SELECT 1 FROM "registration_merge" rm
                              WHERE rm."registrationId" = ${alias}."id")
             AND NOT EXISTS (SELECT 1 FROM "registration_merge" rm
                              WHERE rm."primaryRegistrationId" = ${alias}."id")`;
}

/**
 * The candidate set grouped into suggestions, as a CTE body over `candidate`.
 *
 * `fanId` is in the GROUP BY although it is functionally dependent on
 * `playerId` (`player.fanId` is NOT NULL UNIQUE, so the two are 1:1). It costs
 * nothing and keeps the select legal without leaning on SQLite's bare-column
 * behaviour. The server keys on `playerId` because that is where the foreign
 * key belongs; the old client keyed on `fanId`; the constraint is what makes
 * those the same grouping.
 *
 * {@link SUGGESTION_LIST_SEPARATOR}, not `', '`: team names contain commas, so
 * a comma-joined list cannot be split back apart. The two `GROUP_CONCAT`s run
 * over one scan and so stay positionally parallel — {@link zipSuggestionLists}
 * is what relies on that, and it sorts the pairs, because
 * `GROUP_CONCAT(x, s ORDER BY y)` needs SQLite >= 3.44 and D1's version is
 * pinned nowhere in this repo.
 */
export function suggestionGroupSql(): string {
  return `SELECT "playerId", "fanId", "ageKey",
                 MIN("ageGroup") AS "ageGroup",
                 COUNT(*)        AS "setSize",
                 GROUP_CONCAT("registrationId", CHAR(31)) AS "ids",
                 GROUP_CONCAT("teamName", CHAR(31))       AS "teamNames"
            FROM candidate
           GROUP BY "playerId", "fanId", "ageKey"
          HAVING COUNT(*) >= 2`;
}

/** Unit separator. A team name can contain a comma; it cannot contain this. */
export const SUGGESTION_LIST_SEPARATOR = "\u001f";

/**
 * Suppresses a suggestion the admin has dismissed, as a SQL predicate over a
 * grouped alias. Binds `clubSlug`.
 *
 * `d."setSize" >= g."setSize"` *is* the re-raise rule: a dismissal covers the
 * set as it was, so a set that has since grown is a new question.
 */
export function suggestionNotDismissedSql(alias = "g"): string {
  return `NOT EXISTS (SELECT 1 FROM "registration_merge_suggestion_dismissal" d
                       WHERE d."clubSlug" = ?
                         AND d."playerId" = ${alias}."playerId"
                         AND d."ageKey"   = ${alias}."ageKey"
                         AND d."setSize" >= ${alias}."setSize")`;
}

/**
 * The two CTEs every suggestion read opens with. Binds `clubSlug` once.
 *
 * Shared so the suggestions endpoint and `?suggestedOnly=1` on the paginated
 * list cannot disagree about what is suggested.
 */
export function suggestionCtesSql(): string {
  return `WITH candidate AS (
  ${suggestionCandidateSql()}
),
grouped AS (
  ${suggestionGroupSql()}
)`;
}

/**
 * The registration ids of every undismissed suggestion, as a subquery.
 * Binds `clubSlug` twice — once for the candidate scan, once for the dismissals.
 *
 * This is the `?suggestedOnly=1` predicate's right-hand side. It returns ids
 * rather than a bound list so nothing here approaches D1's 100-parameter cap.
 */
export function suggestedRegistrationIdsSql(): string {
  return `${suggestionCtesSql()},
suggested AS (
  SELECT c."registrationId"
    FROM candidate c
    JOIN grouped g ON g."playerId" = c."playerId" AND g."ageKey" = c."ageKey"
   WHERE ${suggestionNotDismissedSql()}
)`;
}

/**
 * Splits the two parallel `GROUP_CONCAT`s back into registration/team pairs,
 * ordered by team name.
 *
 * Sorted here rather than in SQL so the order does not depend on D1's SQLite
 * version, and so a page of suggestions reads the same way twice.
 */
export function zipSuggestionLists(
  ids: string | null,
  teamNames: string | null,
): { registrationIds: string[]; teamNames: string[] } {
  const idList = (ids ?? "").split(SUGGESTION_LIST_SEPARATOR).filter(Boolean);
  const nameList = (teamNames ?? "").split(SUGGESTION_LIST_SEPARATOR);

  const pairs = idList.map((id, i) => ({ id, name: nameList[i] ?? "" }));
  pairs.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    registrationIds: pairs.map((p) => p.id),
    teamNames: pairs.map((p) => p.name),
  };
}

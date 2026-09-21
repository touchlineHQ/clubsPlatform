import type { D1Database } from '@cloudflare/workers-types';

/**
 * Merged registrations: one payment covering many registrations.
 *
 * An admin can group several of one player's registrations at one club into a
 * single *billing group*. One member is the primary and carries the payment; the
 * rest are secondaries, billed through it. `registration_merge` holds a row per
 * secondary only, so an unmerged registration is the trivial group of one and
 * needs no row.
 *
 * The concept this module exists to name is the **billing registration id**: the
 * registration a given registration's money hangs off. For a primary (or an
 * unmerged registration) that is itself; for a secondary it is its primary.
 *
 * ── The read-asymmetry rule ───────────────────────────────────────────────────
 *
 * Not every read converts the same way, and making them uniform is the easiest
 * way to reintroduce a double charge:
 *
 * - **Gating reads** — "may this player be sent into the mandate flow?" — must
 *   union *every member's* payment rows. A row stranded on a secondary by a
 *   payment flow that was already in flight when the merge happened must still
 *   disable the card. Use `groupMemberIdsForGating`.
 * - **Write and attribution reads** — upserts, the collapsed payment status, who
 *   marked something manually paid — key on the **primary alone**, so a group has
 *   exactly one authoritative record. Use `resolveBillingRegistrationId` or
 *   `billingRegistrationIdSql`.
 *
 * ── The primary's team name is the group's billing identity ───────────────────
 *
 * `lib/gocardless-link.ts` derives the GoCardless `reference` from the
 * registration's `teamName`, and `api/gocardless/confirm.ts` matches an existing
 * subscription on that reference. Re-pointing a group at a different primary
 * therefore changes the reference, the match fails *on the same mandate*, and
 * GoCardless creates a second subscription against it. That is why
 * api/admin/registration-merges.ts refuses to re-point a group that holds any
 * payment row.
 */

/**
 * Scalar SQL resolving a registration to its billing registration id.
 *
 * `alias` is the `player_registration` alias in the surrounding query. Built from
 * literals and the caller's own alias, so it is safe to interpolate; never pass
 * user input as `alias`.
 */
export function billingRegistrationIdSql(alias: string): string {
  return `COALESCE(
    (SELECT rm."primaryRegistrationId" FROM "registration_merge" rm WHERE rm."registrationId" = ${alias}."id"),
    ${alias}."id"
  )`;
}

/**
 * A JOIN mapping one registration to the registration its money hangs off.
 *
 * `src` is an already-joined `player_registration` alias; `dest` is the alias the
 * billing registration is bound to. Callers then select `dest` throughout and
 * never see the secondary.
 *
 * Deliberately a join rather than a separate lookup: folding the resolution into
 * the query that was already being run keeps every one of these code paths at
 * the same number of round trips it had before merging existed.
 */
export function billingRegistrationJoinSql(src: string, dest: string): string {
  return `JOIN "player_registration" ${dest}
            ON ${dest}."id" = ${billingRegistrationIdSql(src)}`;
}

/**
 * SQL matching every registration id in a billing group — the set a **gating**
 * read must cover, as one subquery rather than a round trip.
 *
 * Takes the group's primary id as two bindings. For an unmerged registration it
 * matches just that id, so callers use it unconditionally.
 */
export const GROUP_MEMBER_IDS_SQL = `(
  SELECT ?
   UNION
  SELECT "registrationId" FROM "registration_merge" WHERE "primaryRegistrationId" = ?
)`;

/**
 * Selectable columns describing a registration's place in a billing group, for
 * the admin and player registration lists.
 *
 * - `billingRegistrationId` — the registration whose payment covers this one.
 * - `billedWithTeamName` — for a secondary, its primary's team. NULL otherwise;
 *   its presence is how the UI knows a row is a secondary.
 * - `mergedTeamNames` — for a primary, the other teams it is billed for, comma
 *   separated. NULL when the registration is not a primary of anything.
 *
 * `alias` is the `player_registration` alias in the surrounding query.
 */
export function mergeColumnsSql(alias: string): string {
  return `${billingRegistrationIdSql(alias)} AS billingRegistrationId,
         (SELECT pr_primary."teamName"
            FROM "registration_merge" rm_self
            JOIN "player_registration" pr_primary ON pr_primary."id" = rm_self."primaryRegistrationId"
           WHERE rm_self."registrationId" = ${alias}."id") AS billedWithTeamName,
         (SELECT GROUP_CONCAT(pr_member."teamName", ', ')
            FROM "registration_merge" rm_members
            JOIN "player_registration" pr_member ON pr_member."id" = rm_members."registrationId"
           WHERE rm_members."primaryRegistrationId" = ${alias}."id") AS mergedTeamNames`;
}

/**
 * The subscription level a registration resolves to, highest precedence first:
 * per-registration override, then team+status, then status, then team.
 *
 * The joins below bind the aliases `rsl`, `tssl`, `ssl`, `tsl` and `sl`, which is
 * what every existing copy of this block already used.
 */
export const SUBSCRIPTION_LEVEL_ID_SQL =
  `COALESCE(rsl."subscriptionLevelId", tssl."subscriptionLevelId", ssl."subscriptionLevelId", tsl."subscriptionLevelId")`;

/**
 * The join block feeding {@link SUBSCRIPTION_LEVEL_ID_SQL}.
 *
 * Lifted out of the five places it was copy-pasted (api/my-registrations.ts twice,
 * api/gocardless/confirm.ts, api/admin/player-registrations.ts,
 * api/admin/player-payments.ts and [clubSlug]/payments/[paymentType]/[fanId].ts,
 * which carried a "keep them in sync" comment admitting the problem). `alias` is
 * the `player_registration` alias to join against.
 */
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

/**
 * The registration a payment for `registrationId` should hang off.
 *
 * Returns `registrationId` unchanged when it is a primary or unmerged, so callers
 * can apply it unconditionally. Scoped to `clubSlug` when given — a merge can
 * never span clubs, so a mismatch means the caller is looking at the wrong club
 * and the safe answer is the id it already had.
 */
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

/**
 * Every registration id in the billing group `registrationId` belongs to,
 * including `registrationId` itself and the primary.
 *
 * This is the set a **gating** read must cover. For an unmerged registration it
 * is just `[registrationId]`, so callers can use it unconditionally.
 */
export async function groupMemberIdsForGating(
  db: D1Database,
  registrationId: string,
  clubSlug: string,
): Promise<string[]> {
  const primaryId = await resolveBillingRegistrationId(db, registrationId, clubSlug);

  const { results } = await db
    .prepare(
      `SELECT "registrationId" FROM "registration_merge"
        WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?`
    )
    .bind(primaryId, clubSlug)
    .all<{ registrationId: string }>();

  const ids = new Set<string>([registrationId, primaryId]);
  for (const row of results) ids.add(row.registrationId);
  return [...ids];
}

/** One registration's membership of a billing group, as the UI needs it. */
export interface MergeMembership {
  registrationId: string;
  primaryRegistrationId: string;
  teamName: string;
}

/**
 * Every merge membership at a club, with each secondary's own team name.
 *
 * One query for the whole club rather than a correlated subquery per row — the
 * same trade `attachManualAttribution` in api/my-registrations.ts makes.
 */
export async function loadClubMemberships(
  db: D1Database,
  clubSlug: string,
): Promise<MergeMembership[]> {
  const { results } = await db
    .prepare(
      `SELECT rm."registrationId", rm."primaryRegistrationId", pr."teamName"
         FROM "registration_merge" rm
         JOIN "player_registration" pr ON pr."id" = rm."registrationId"
        WHERE rm."clubSlug" = ?`
    )
    .bind(clubSlug)
    .all<MergeMembership>();

  return results;
}

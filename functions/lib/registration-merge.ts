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

import { ensureTables } from '../../lib/ensure-tables';
import {
  type Env,
  json,
  nowMs,
  randomId,
  requireAdmin,
  getClubSlug,
} from '../../lib/api-helpers';
import { prepareAuditLog } from '../../lib/audit-log';
import { getPostHog, clubGroups } from '../../lib/posthog';
import { GC_BLOCKING_STATUSES } from '../../lib/payment-status';
import {
  GROUP_MEMBER_IDS_SQL,
  SUBSCRIPTION_LEVEL_ID_SQL,
  subscriptionLevelJoinSql,
} from '../../lib/registration-merge';

/**
 * Merge registrations into one billing group — one payment, many registrations.
 * See lib/registration-merge.ts for the model.
 *
 * The invariants below all come from one fact: the primary's team name is the
 * group's billing identity, because the GoCardless reference is derived from it
 * and confirm.ts matches an existing subscription on that reference. A reference
 * that moved would fail that match on the same mandate and collect twice.
 */

/**
 * The most registrations one merge may name.
 *
 * D1 caps a query at 100 bound parameters. The guarded audit statement sets the
 * limit, not the INSERT: prepareAuditLog repeats its guard across a UNION ALL
 * and the guard binds the member list three times, so it costs 33 + 6 per
 * member. Eleven keeps that at 99; the INSERT and both unmerge statements are
 * well under. A player in eleven teams at one club is not a real case, so
 * capping is cheaper than slicing.
 */
const MAX_MERGE_GROUP = 11;

interface RegistrationRow {
  registrationId: string;
  clubSlug: string;
  playerId: string;
  teamName: string;
  createdAt: number;
  levelId: string | null;
  /** Its current primary, when it is already a secondary. */
  primaryRegistrationId: string | null;
}

interface PaymentRow {
  registrationId: string;
  status: string;
  mandateId: string;
}

/** Every named registration with its player, level and existing membership, in one snapshot. */
async function loadRegistrations(
  db: D1Database,
  clubSlug: string,
  ids: string[],
): Promise<RegistrationRow[]> {
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT pr.id        AS registrationId,
              pr.clubSlug,
              pr.playerId,
              pr.teamName,
              pr.createdAt,
              ${SUBSCRIPTION_LEVEL_ID_SQL} AS levelId,
              rm."primaryRegistrationId"
         FROM "player_registration" pr
         ${subscriptionLevelJoinSql('pr')}
         LEFT JOIN "registration_merge" rm ON rm."registrationId" = pr.id
        WHERE pr.id IN (${placeholders}) AND pr.clubSlug = ?`
    )
    .bind(...ids, clubSlug)
    .all<RegistrationRow>();

  return results;
}

/** Every payment row held by any of `ids`, for the invariant checks. */
async function loadPayments(
  db: D1Database,
  clubSlug: string,
  ids: string[],
): Promise<PaymentRow[]> {
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT registrationId, status, mandateId FROM "player_payment"
        WHERE registrationId IN (${placeholders}) AND clubSlug = ?`
    )
    .bind(...ids, clubSlug)
    .all<PaymentRow>();

  return results;
}

/**
 * POST — create or replace a billing group.
 *
 * Body: `{ primaryRegistrationId, registrationIds: string[] }`. The group is
 * written in one conditional batch, so re-pointing a primary is just another POST.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: 'Missing X-Club-Slug header' }, { status: 400 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;

  const body = await context.request.json<{
    primaryRegistrationId?: string;
    registrationIds?: string[];
  }>();

  const primaryId = body.primaryRegistrationId?.trim();
  const secondaryIds = [...new Set((body.registrationIds ?? []).map(id => id.trim()))]
    .filter(id => id && id !== primaryId);

  if (!primaryId) {
    return json({ error: 'primaryRegistrationId required' }, { status: 400 });
  }
  if (secondaryIds.length === 0) {
    return json(
      { error: 'registrationIds must name at least one registration other than the primary' },
      { status: 400 },
    );
  }
  if (secondaryIds.length > MAX_MERGE_GROUP) {
    return json(
      { error: `A billing group can hold at most ${MAX_MERGE_GROUP} other registrations.` },
      { status: 400 },
    );
  }

  const allIds = [primaryId, ...secondaryIds];
  const registrations = await loadRegistrations(context.env.DB, clubSlug, allIds);

  if (registrations.length !== allIds.length) {
    return json({ error: 'One or more registrations were not found at this club' }, { status: 404 });
  }

  const primary = registrations.find(r => r.registrationId === primaryId)!;
  const secondaries = registrations.filter(r => r.registrationId !== primaryId);

  // Same player (club is already enforced by the loader's WHERE). Load-bearing:
  // posthog-identity.ts resolves a fan from the payment's registration.
  const wrongPlayer = secondaries.find(r => r.playerId !== primary.playerId);
  if (wrongPlayer) {
    return json(
      {
        error: `${wrongPlayer.teamName} is a different player's registration. `
          + 'Registrations can only be merged for one player at a time.',
      },
      { status: 409 },
    );
  }

  // The group is priced off the primary, so one without a level would render a
  // dead "no subscription level" card for a perfectly payable player.
  if (!primary.levelId) {
    return json(
      {
        error: `${primary.teamName} has no subscription level assigned, so it cannot be `
          + 'the registration the group is billed through. Assign a level first, or pick '
          + 'a different primary.',
      },
      { status: 409 },
    );
  }

  // No secondary may hold a non-'inactive' payment. Stricter than "not settled":
  // 'mandate_only' is a live mandate and a secondary's 'manual' row is unreachable
  // by the undo path. Dead 'inactive' rows pass — abandoned setups are common.
  const payments = await loadPayments(context.env.DB, clubSlug, allIds);
  const secondaryIdSet = new Set(secondaryIds);
  const blocking = payments.find(
    p => secondaryIdSet.has(p.registrationId) && p.status !== 'inactive',
  );

  if (blocking) {
    const team = registrations.find(r => r.registrationId === blocking.registrationId)?.teamName
      ?? blocking.registrationId;
    return json(
      {
        error: blocking.status === 'manual'
          ? `${team} is marked as manually paid. Undo that first, or make it the primary.`
          : `${team} has a payment with GoCardless (${blocking.status}). Cancel it on the `
            + 'Payments tab first, or make it the primary.',
        status: blocking.status,
        conflictingRegistrationId: blocking.registrationId,
      },
      { status: 409 },
    );
  }

  // No chains: COALESCE resolves one hop, so a chain would split a group's money
  // from its members.
  if (primary.primaryRegistrationId) {
    return json(
      {
        error: `${primary.teamName} is already billed through another registration. `
          + 'Unmerge that group first, then merge again with the primary you want.',
      },
      { status: 409 },
    );
  }

  // Absorbing another group would need its members re-pointed too — a second
  // decision the admin has not made here.
  const { results: nestedPrimaries } = await context.env.DB
    .prepare(
      `SELECT DISTINCT "primaryRegistrationId" FROM "registration_merge"
        WHERE "clubSlug" = ?
          AND "primaryRegistrationId" IN (${secondaryIds.map(() => '?').join(',')})`
    )
    .bind(clubSlug, ...secondaryIds)
    .all<{ primaryRegistrationId: string }>();

  if (nestedPrimaries.length > 0) {
    const team = registrations.find(
      r => r.registrationId === nestedPrimaries[0].primaryRegistrationId,
    )?.teamName ?? nestedPrimaries[0].primaryRegistrationId;
    return json(
      {
        error: `${team} is already the registration another group is billed through. `
          + 'Unmerge that group first.',
      },
      { status: 409 },
    );
  }

  // A paid group cannot be re-pointed (see the header). Its current primary may
  // not be among the named ids, so look its payments up separately.
  const demotedPrimaryIds = [...new Set(
    secondaries
      .map(r => r.primaryRegistrationId)
      .filter((id): id is string => id !== null && id !== primaryId),
  )];

  if (demotedPrimaryIds.length > 0) {
    const demotedPayments = await loadPayments(context.env.DB, clubSlug, demotedPrimaryIds);
    if (demotedPayments.some(p => p.status !== 'inactive')) {
      return json(
        {
          error: 'These registrations are already billed through a registration that has a '
            + 'payment against it. Unmerge that group first, then merge again with the '
            + 'primary you want.',
        },
        { status: 409 },
      );
    }
  }

  const now = nowMs();

  // One INSERT selects either every proposed member or none. The guarded audit
  // deliberately violates its NOT NULL id when that invariant is false, which
  // makes D1 roll the whole batch back instead of committing a partial group.
  const proposedValues = secondaryIds.map(() => '(?)').join(', ');
  const mergeStatement = context.env.DB
    .prepare(
      `WITH proposed("registrationId") AS (VALUES ${proposedValues})
       INSERT INTO "registration_merge"
         ("clubSlug", "registrationId", "primaryRegistrationId", "createdAt", "updatedAt")
       SELECT ?, proposed."registrationId", ?, ?, ?
         FROM proposed
        WHERE NOT EXISTS (
                SELECT 1 FROM "registration_merge" WHERE "registrationId" = ?
              )
          AND NOT EXISTS (
                SELECT 1 FROM "registration_merge" rm
                 WHERE rm."clubSlug" = ?
                   AND rm."primaryRegistrationId" IN (SELECT "registrationId" FROM proposed)
              )
          AND NOT EXISTS (
                SELECT 1 FROM "player_payment" pp
                 WHERE pp."clubSlug" = ?
                   AND pp."registrationId" IN (SELECT "registrationId" FROM proposed)
                   AND pp."status" <> 'inactive'
              )
          AND NOT EXISTS (
                SELECT 1
                  FROM "registration_merge" current_group
                  JOIN "player_payment" pp
                    ON pp."registrationId" = current_group."primaryRegistrationId"
                   AND pp."clubSlug" = current_group."clubSlug"
                 WHERE current_group."clubSlug" = ?
                   AND current_group."registrationId" IN (
                     SELECT "registrationId" FROM proposed
                   )
                   AND current_group."primaryRegistrationId" <> ?
                   AND pp."status" <> 'inactive'
              )
          AND (
                SELECT COUNT(*) FROM "registration_merge" existing
                 WHERE existing."clubSlug" = ?
                   AND existing."primaryRegistrationId" = ?
                   AND existing."registrationId" NOT IN (SELECT "registrationId" FROM proposed)
              ) + (SELECT COUNT(*) FROM proposed) <= ?
       ON CONFLICT("registrationId") DO UPDATE SET
         "primaryRegistrationId" = excluded."primaryRegistrationId",
         "updatedAt"             = excluded."updatedAt"`,
    )
    .bind(
      ...secondaryIds,
      clubSlug, primaryId, now, now,
      primaryId, clubSlug, clubSlug,
      clubSlug, primaryId,
      clubSlug, primaryId, MAX_MERGE_GROUP,
    );

  const secondaryPlaceholders = secondaryIds.map(() => '?').join(', ');
  const auditGuardSql = `(
    SELECT COUNT(*) FROM "registration_merge"
     WHERE "clubSlug" = ?
       AND "primaryRegistrationId" = ?
       AND "updatedAt" = ?
       AND "registrationId" IN (${secondaryPlaceholders})
  ) = ?
  AND NOT EXISTS (
    SELECT 1 FROM "registration_merge" WHERE "registrationId" = ?
  )
  AND NOT EXISTS (
    SELECT 1 FROM "registration_merge"
     WHERE "clubSlug" = ? AND "primaryRegistrationId" IN (${secondaryPlaceholders})
  )
  AND NOT EXISTS (
    SELECT 1 FROM "player_payment"
     WHERE "clubSlug" = ?
       AND "registrationId" IN (${secondaryPlaceholders})
       AND "status" <> 'inactive'
  )`;
  const auditGuardBindings = [
    clubSlug, primaryId, now, ...secondaryIds, secondaryIds.length,
    primaryId,
    clubSlug, ...secondaryIds,
    clubSlug, ...secondaryIds,
  ];
  const auditStatement = prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: 'registrations_merged',
      targetTable: 'player_registration',
      targetId: primaryId,
      newStatus: `primary:${primary.teamName}`,
      note: `Billed with: ${secondaries.map(s => s.teamName).join(', ')}`,
    }, { sql: auditGuardSql, bindings: auditGuardBindings });

  let writes: D1Result<unknown>[];
  try {
    writes = await context.env.DB.batch([mergeStatement, auditStatement]);
  } catch (error) {
    console.error('Registration merge transaction rejected', error);
    return json(
      { error: 'Another change landed while this merge was being saved. Reload and try again.' },
      { status: 409 },
    );
  }

  if ((writes[0]?.meta?.changes ?? 0) !== secondaryIds.length) {
    return json(
      {
        error: 'Another change landed while this merge was being saved. '
          + 'Reload the registrations and try again.',
        conflictingRegistrationIds: secondaryIds,
      },
      { status: 409 },
    );
  }

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'registrations merged',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        group_size: allIds.length,
        had_existing_payment: payments.some(p => p.status !== 'inactive'),
      },
    });
  }

  return json({ ok: true, primaryRegistrationId: primaryId, memberCount: allIds.length });
};

/**
 * DELETE — dissolve a billing group, by `?primaryRegistrationId=`.
 *
 * Refused while a live GoCardless payment exists: every ex-secondary would be
 * left with no payment rows and re-offered the mandate flow while the group's
 * subscription is still collecting.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: 'Missing X-Club-Slug header' }, { status: 400 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;

  const url = new URL(context.request.url);
  const primaryId = url.searchParams.get('primaryRegistrationId')?.trim();
  if (!primaryId) {
    return json({ error: 'primaryRegistrationId is required' }, { status: 400 });
  }

  const livePayment = await context.env.DB
    .prepare(
      `SELECT status FROM "player_payment"
        WHERE registrationId IN ${GROUP_MEMBER_IDS_SQL}
          AND clubSlug = ?
          AND status IN (${GC_BLOCKING_STATUSES.map(() => '?').join(',')})
          AND mandateId != ''
        LIMIT 1`
    )
    .bind(primaryId, primaryId, clubSlug, ...GC_BLOCKING_STATUSES)
    .first<{ status: string }>();

  if (livePayment) {
    return json(
      {
        error: 'This group has a live GoCardless payment. Cancel the subscription on the '
          + 'Payments tab first — unmerging now would ask every other team to pay again.',
        status: livePayment.status,
      },
      { status: 409 },
    );
  }

  const members = await context.env.DB
    .prepare(
      `SELECT rm."registrationId", pr."teamName"
         FROM "registration_merge" rm
         JOIN "player_registration" pr ON pr."id" = rm."registrationId"
        WHERE rm."primaryRegistrationId" = ? AND rm."clubSlug" = ?`
    )
    .bind(primaryId, clubSlug)
    .all<{ registrationId: string; teamName: string }>();

  if (members.results.length === 0) {
    return json({ error: 'No merged registrations found for this primary' }, { status: 404 });
  }

  const memberIds = [primaryId, ...members.results.map(member => member.registrationId)];
  const mergedMemberIds = members.results.map(member => member.registrationId);
  const candidateValues = memberIds.map(() => '(?)').join(', ');
  const memberPlaceholders = memberIds.map(() => '?').join(', ');
  const mergedMemberPlaceholders = mergedMemberIds.map(() => '?').join(', ');
  const now = nowMs();
  const claimId = randomId('unmerge');

  const claimDeletion = context.env.DB
    .prepare(
      `WITH members("registrationId") AS (VALUES ${candidateValues})
       INSERT INTO "registration_payment_state"
         ("clubSlug", "registrationId", "generation", "claimId", "updatedAt")
       SELECT ?, members."registrationId", 1, ?, ?
         FROM members
        WHERE NOT EXISTS (
                SELECT 1 FROM "player_payment"
                 WHERE "clubSlug" = ?
                   AND "registrationId" IN (SELECT "registrationId" FROM members)
                   AND "status" IN (${GC_BLOCKING_STATUSES.map(() => '?').join(', ')})
                   AND "mandateId" != ''
              )
          AND NOT EXISTS (
                SELECT 1 FROM "registration_payment_state"
                 WHERE "clubSlug" = ?
                   AND "registrationId" IN (SELECT "registrationId" FROM members)
                   AND "confirmationId" IS NOT NULL
                   AND "confirmationExpiresAt" > ?
              )
          AND (
                SELECT COUNT(*) FROM "registration_merge"
                 WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?
              ) = ?
          AND (
                SELECT COUNT(*) FROM "registration_merge"
                 WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?
                   AND "registrationId" IN (${mergedMemberPlaceholders})
              ) = ?
       ON CONFLICT("registrationId") DO UPDATE SET
         "generation" = "registration_payment_state"."generation" + 1,
         "claimId" = excluded."claimId",
         "confirmationId" = NULL,
         "confirmationExpiresAt" = NULL,
         "updatedAt" = excluded."updatedAt"`,
    )
    .bind(
      ...memberIds,
      clubSlug, claimId, now, clubSlug, ...GC_BLOCKING_STATUSES,
      clubSlug, now,
      primaryId, clubSlug, members.results.length,
      primaryId, clubSlug, ...mergedMemberIds, members.results.length,
    );

  const deleteMappings = context.env.DB
    .prepare(
      `DELETE FROM "registration_merge"
        WHERE "primaryRegistrationId" = ?
          AND "clubSlug" = ?
          AND "registrationId" IN (${mergedMemberPlaceholders})
          AND (
                SELECT COUNT(*) FROM "registration_payment_state"
                 WHERE "clubSlug" = ? AND "claimId" = ?
                   AND "registrationId" IN (${memberPlaceholders})
              ) = ?
          AND NOT EXISTS (
                SELECT 1 FROM "player_payment"
                 WHERE "clubSlug" = ?
                   AND "registrationId" IN (${memberPlaceholders})
                   AND "status" IN (${GC_BLOCKING_STATUSES.map(() => '?').join(', ')})
                   AND "mandateId" != ''
              )`
    )
    .bind(
      primaryId, clubSlug, ...mergedMemberIds,
      clubSlug, claimId, ...memberIds, memberIds.length,
      clubSlug, ...memberIds, ...GC_BLOCKING_STATUSES,
    );

  const unmergeAuditGuard = `NOT EXISTS (
    SELECT 1 FROM "registration_merge"
     WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?
  )
  AND (
    SELECT COUNT(*) FROM "registration_payment_state"
     WHERE "clubSlug" = ? AND "claimId" = ?
       AND "registrationId" IN (${memberPlaceholders})
  ) = ?
  AND NOT EXISTS (
    SELECT 1 FROM "player_payment"
     WHERE "clubSlug" = ?
       AND "registrationId" IN (${memberPlaceholders})
       AND "status" IN (${GC_BLOCKING_STATUSES.map(() => '?').join(', ')})
       AND "mandateId" != ''
  )`;
  const unmergeAudit = prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: 'registrations_unmerged',
      targetTable: 'player_registration',
      targetId: primaryId,
      oldStatus: `primary:${primaryId}`,
      note: `Unmerged: ${members.results.map(m => m.teamName).join(', ')}`,
    }, {
      sql: unmergeAuditGuard,
      bindings: [
        primaryId, clubSlug,
        clubSlug, claimId, ...memberIds, memberIds.length,
        clubSlug, ...memberIds, ...GC_BLOCKING_STATUSES,
      ],
    });

  let writes: D1Result<unknown>[];
  try {
    writes = await context.env.DB.batch([claimDeletion, deleteMappings, unmergeAudit]);
  } catch (error) {
    console.error('Registration unmerge transaction rejected', error);
    return json(
      { error: 'A payment started while this group was being unmerged. Reload and try again.' },
      { status: 409 },
    );
  }

  if (
    (writes[0]?.meta?.changes ?? 0) === 0
    || (writes[1]?.meta?.changes ?? 0) !== members.results.length
  ) {
    return json(
      { error: 'A payment started while this group was being unmerged. Reload and try again.' },
      { status: 409 },
    );
  }

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'registrations unmerged',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        group_size: members.results.length + 1,
      },
    });
  }

  return json({ ok: true });
};

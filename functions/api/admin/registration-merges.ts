import { ensureTables } from '../../lib/ensure-tables';
import {
  type Env,
  json,
  nowMs,
  requireAdmin,
  getClubSlug,
} from '../../lib/api-helpers';
import { prepareAuditLog } from '../../lib/audit-log';
import { getPostHog, clubGroups } from '../../lib/posthog';
import { GC_BLOCKING_STATUSES } from '../../lib/payment-status';
import { SUBSCRIPTION_LEVEL_ID_SQL, subscriptionLevelJoinSql } from '../../lib/registration-merge';

/**
 * Merge registrations into one billing group — one payment, many registrations.
 *
 * A player can hold several registrations at one club, and the club may bill
 * them once: a U15 playing Tuesdays and Thursdays is two registrations and one
 * set of subs. Nothing in the data distinguishes that from a player with two
 * genuine commitments, so this is an explicit admin action, not a heuristic.
 *
 * One member of the group is the primary. It carries the payment; the rest are
 * secondaries and read their status from it. Only secondaries get a
 * registration_merge row, so an unmerged registration is the trivial group of
 * one and needs no row.
 *
 * ── Why the invariants below are what they are ────────────────────────────────
 *
 * The primary's team name is the group's *billing identity*: lib/gocardless-link
 * derives the GoCardless reference from it, and api/gocardless/confirm.ts matches
 * an existing subscription on that reference. A reference that moved would fail
 * that match on the same mandate and collect twice. That is why a group holding
 * any payment row cannot be re-pointed at a different primary, and why a
 * secondary must not carry a live payment of its own.
 */

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

/**
 * Load every registration named by the request, with its player, level and any
 * merge membership it already has. One query, so the whole validation below
 * works off a consistent snapshot.
 */
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
 * Body: `{ primaryRegistrationId, registrationIds: string[] }`, where
 * `registrationIds` are the members to bill through the primary. The whole group
 * is written in one conditional batch, so re-pointing a primary and absorbing one
 * group into another are both just another POST.
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

  const allIds = [primaryId, ...secondaryIds];
  const registrations = await loadRegistrations(context.env.DB, clubSlug, allIds);

  if (registrations.length !== allIds.length) {
    return json({ error: 'One or more registrations were not found at this club' }, { status: 404 });
  }

  const primary = registrations.find(r => r.registrationId === primaryId)!;
  const secondaries = registrations.filter(r => r.registrationId !== primaryId);

  // Invariant 1 — same player, same club. Club is already enforced by the WHERE
  // above; player has to be asserted here. It is load-bearing beyond tidiness:
  // lib/posthog-identity.ts resolves a fan from the payment's registration, which
  // stays correct only because every member is the same player.
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

  // The group is priced off the primary's resolved level, so a primary with no
  // level would render a dead "no subscription level assigned" card for a player
  // who is perfectly payable.
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

  // Invariant 2 — no member but the primary may hold a payment row that is not
  // 'inactive'. Stricter than "no settled payment" on purpose: 'mandate_only' is
  // a live uncollected mandate, and a 'manual' row left on a secondary becomes
  // unreachable by the undo path once manual-payment.ts resolves forward. Dead
  // 'inactive' rows are allowed to stay put — abandoned setup attempts are
  // common, and blocking on them would block most real merges.
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

  // The proposed primary is itself somebody else's secondary. Chains are not
  // allowed — COALESCE resolves exactly one hop, so a chain would silently split
  // a group's money from its members.
  if (primary.primaryRegistrationId) {
    return json(
      {
        error: `${primary.teamName} is already billed through another registration. `
          + 'Unmerge that group first, then merge again with the primary you want.',
      },
      { status: 409 },
    );
  }

  // A named member is itself the primary of an existing group. Absorbing one
  // group into another would need its members re-pointed too, which is a second
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

  // Invariant 3 — a group holding a payment cannot be re-pointed at a different
  // primary, because the group's GoCardless reference is derived from the
  // primary's team name; see the note at the top of this file. The current
  // primary may not be among the ids the request named, so look its payments up
  // separately.
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

  // Conditional writes, not read-then-write: two admins merging overlapping sets
  // can form a chain from opposite ends ({X→P} and {P→Q} both pass a "no chains"
  // pre-read), and a confirm.ts flow can land a payment row between the checks
  // above and the write. Each guard is re-asserted in the statement itself, and
  // meta.changes tells us whether it held — the idiom api/admin/manual-payment.ts
  // uses.
  //
  // The audit row goes in the same batch, so an audited merge that does not exist
  // (or a merge nobody can see) is not possible.
  const statements = secondaryIds.map(secondaryId =>
    context.env.DB
      .prepare(
        `INSERT INTO "registration_merge"
           ("clubSlug", "registrationId", "primaryRegistrationId", "createdAt", "updatedAt")
         SELECT ?, ?, ?, ?, ?
          WHERE NOT EXISTS (
                  SELECT 1 FROM "registration_merge" WHERE "registrationId" = ?
                )
            AND NOT EXISTS (
                  SELECT 1 FROM "registration_merge" WHERE "primaryRegistrationId" = ?
                )
            AND NOT EXISTS (
                  SELECT 1 FROM "player_payment"
                   WHERE "registrationId" = ? AND "clubSlug" = ? AND "status" <> 'inactive'
                )
         ON CONFLICT("registrationId") DO UPDATE SET
           "primaryRegistrationId" = excluded."primaryRegistrationId",
           "updatedAt"             = excluded."updatedAt"`
      )
      .bind(
        clubSlug, secondaryId, primaryId, now, now,
        primaryId,      // the primary must not itself be a secondary
        secondaryId,    // this member must not be some other group's primary
        secondaryId, clubSlug,
      ),
  );

  statements.push(
    prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: 'registrations_merged',
      targetTable: 'player_registration',
      targetId: primaryId,
      newStatus: `primary:${primary.teamName}`,
      note: `Billed with: ${secondaries.map(s => s.teamName).join(', ')}`,
    }),
  );

  const writes = await context.env.DB.batch(statements);

  // D1 runs a batch as an implicit transaction but cannot abort mid-batch, so a
  // guard that failed leaves the other rows committed. Roll those back by hand
  // rather than leaving a half-formed group.
  const merged = writes.slice(0, secondaryIds.length);
  const failed = secondaryIds.filter((_, i) => (merged[i]?.meta?.changes ?? 0) === 0);

  if (failed.length > 0) {
    const written = secondaryIds.filter(id => !failed.includes(id));
    if (written.length > 0) {
      await context.env.DB
        .prepare(
          `DELETE FROM "registration_merge"
            WHERE "clubSlug" = ?
              AND "primaryRegistrationId" = ?
              AND "registrationId" IN (${written.map(() => '?').join(',')})`
        )
        .bind(clubSlug, primaryId, ...written)
        .run();
    }
    return json(
      {
        error: 'Another change landed while this merge was being saved. '
          + 'Reload the registrations and try again.',
        conflictingRegistrationIds: failed,
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
 * DELETE — dissolve a billing group.
 *
 * Query: `?primaryRegistrationId=<id>`. Refused while the group holds a live
 * GoCardless payment: dissolving would leave every ex-secondary with no payment
 * rows, so the payer page would re-offer each of them the mandate flow while the
 * group's subscription is still collecting — the mirror image of the double
 * charge merging exists to prevent.
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
        WHERE registrationId = ?
          AND clubSlug = ?
          AND status IN (${GC_BLOCKING_STATUSES.map(() => '?').join(',')})
          AND mandateId != ''
        LIMIT 1`
    )
    .bind(primaryId, clubSlug, ...GC_BLOCKING_STATUSES)
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

  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `DELETE FROM "registration_merge"
          WHERE "primaryRegistrationId" = ? AND "clubSlug" = ?`
      )
      .bind(primaryId, clubSlug),
    prepareAuditLog(context.env.DB, {
      clubSlug,
      adminId,
      action: 'registrations_unmerged',
      targetTable: 'player_registration',
      targetId: primaryId,
      oldStatus: `primary:${primaryId}`,
      note: `Unmerged: ${members.results.map(m => m.teamName).join(', ')}`,
    }),
  ]);

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

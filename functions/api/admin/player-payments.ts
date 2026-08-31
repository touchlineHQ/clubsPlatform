import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from '../../lib/api-helpers';
import { getPostHog, clubGroups } from '../../lib/posthog';
import { getSecret } from '../../lib/secrets';
import { writeAuditLog } from '../../lib/audit-log';
import {
  resolveSubscriptionStartDate,
  fetchNextPossibleChargeDate,
} from '../../lib/gocardless-link';
import { stripReferenceSuffix } from '../../lib/payment-reference';
import { subscriptionStatusToPaymentStatus } from '../../lib/payment-status';
import type { GCSubscription } from '../gocardless/_types';

/**
 * Subscription statuses meaning "will never collect", so it is safe to create a
 * replacement. Deliberately excludes 'finished': that means every payment of a
 * count-limited plan was collected, so the payer has already paid in full and
 * creating a replacement would charge them the whole plan again. That case is
 * reconciled to 'completed' instead — see lib/payment-status.ts.
 */
const TERMINAL_SUBSCRIPTION_STATUSES = new Set(['cancelled', 'customer_approval_denied']);

interface PlayerPaymentRow {
  id: string;
  registrationId: string;
  fanId: string;
  teamName: string;
  reference: string;
  mandateId: string;
  subscriptionId: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * GET handler — fetches all player payment records for the club.
 *
 * Admin-only endpoint. Returns payment details including mandate, subscription,
 * and status information ordered by creation date descending.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(
      `SELECT
         pp.id, pp.registrationId, p.fanId, pr.teamName,
         pp.reference, pp.mandateId, pp.subscriptionId,
         pp.status, pp.createdAt, pp.updatedAt
       FROM "player_payment" pp
       JOIN "player_registration" pr ON pr.id = pp.registrationId
       JOIN "player" p ON p.id = pr.playerId
       WHERE pp.clubSlug = ?
       ORDER BY pp.createdAt DESC`
    )
    .bind(clubSlug)
    .all<PlayerPaymentRow>();

  return json({ payments: rows.results });
};

/**
 * PATCH handler — deactivates a player payment record.
 *
 * Admin-only endpoint. Sets the payment status to 'inactive' and writes an audit log
 * entry. Returns 409 if the payment is already inactive.
 */
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const body = await context.request.json<{ id?: string }>();

  if (!body.id) return json({ error: 'id required' }, { status: 400 });

  const payment = await context.env.DB
    .prepare(`SELECT id, status FROM "player_payment" WHERE id = ? AND clubSlug = ?`)
    .bind(body.id, clubSlug)
    .first<{ id: string; status: string }>();

  if (!payment) return json({ error: 'Payment not found' }, { status: 404 });
  if (payment.status === 'inactive') return json({ error: 'Already inactive' }, { status: 409 });
  // Deactivating is DB-only — it cancels nothing at GoCardless. Losing the
  // 'completed' marker would put a paid-up player back in front of the mandate
  // flow, so a plan that collected in full is not deactivatable.
  if (payment.status === 'completed') {
    return json(
      { error: 'This plan was paid in full and cannot be deactivated' },
      { status: 409 },
    );
  }

  await context.env.DB
    .prepare(`UPDATE "player_payment" SET status = 'inactive', updatedAt = ? WHERE id = ? AND clubSlug = ?`)
    .bind(nowMs(), body.id, clubSlug)
    .run();

  await writeAuditLog(context.env.DB, {
    clubSlug: clubSlug ?? '',
    adminId,
    action: 'deactivate',
    targetTable: 'player_payment',
    targetId: body.id,
    oldStatus: payment.status,
    newStatus: 'inactive',
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment deactivated',
      ...clubGroups(clubSlug),
      properties: { club_slug: clubSlug, payment_id: body.id },
    });
  }

  return json({ ok: true });
};

/**
 * POST handler — retries GoCardless subscription creation for a mandate_only payment.
 *
 * Admin-only endpoint. For payments stuck at mandate_only (mandate created but
 * subscription failed), this creates the subscription at GoCardless. First checks
 * for existing subscriptions to avoid duplicates, then creates a new one if needed.
 * Returns 409 if the payment is not in mandate_only status, or 422 if no
 * subscription level is configured.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const result = await requireAdmin(context);
  if ('error' in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const adminId = (result.session.user as Record<string, unknown>).id as string;

  const body = await context.request.json<{ id?: string }>();
  if (!body.id) return json({ error: 'id required' }, { status: 400 });

  // Load the payment row with enough context to build a subscription
  const payment = await context.env.DB
    .prepare(
      `SELECT pp.id, pp.registrationId, pp.mandateId, pp.reference, pp.status,
              sl.yearlyPriceInPence, sl.intervalCount, sl.intervalUnit, sl.startDate
         FROM "player_payment" pp
         JOIN "player_registration" pr ON pr.id = pp.registrationId
         LEFT JOIN registration_subscription_level rsl ON rsl.registrationId = pr.id
         LEFT JOIN team_status_subscription_level tssl
                ON tssl.clubSlug = pr.clubSlug
               AND tssl.teamName = pr.teamName
               AND tssl.registrationStatus = pr.registrationStatus
         LEFT JOIN status_subscription_level ssl
                ON ssl.clubSlug = pr.clubSlug
               AND ssl.registrationStatus = pr.registrationStatus
         LEFT JOIN team_subscription_level tsl
                ON tsl.clubSlug = pr.clubSlug AND tsl.teamName = pr.teamName
         LEFT JOIN subscription_level sl
                ON sl.id = COALESCE(rsl.subscriptionLevelId, tssl.subscriptionLevelId, ssl.subscriptionLevelId, tsl.subscriptionLevelId)
        WHERE pp.id = ? AND pp.clubSlug = ?`
    )
    .bind(body.id, clubSlug)
    .first<{
      id: string;
      registrationId: string;
      mandateId: string;
      reference: string;
      status: string;
      yearlyPriceInPence: number | null;
      intervalCount: number | null;
      intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
      startDate: string | null;
    }>();

  if (!payment) return json({ error: 'Payment not found' }, { status: 404 });
  if (payment.status !== 'mandate_only') {
    return json({ error: 'Only mandate_only payments can be retried' }, { status: 409 });
  }
  if (!payment.yearlyPriceInPence || !payment.intervalCount || !payment.intervalUnit) {
    return json({ error: 'No subscription level configured for this registration' }, { status: 422 });
  }

  const gcToken = await getSecret(context.env.DB, context.env, clubSlug, 'GC_ACCESS_TOKEN');
  if (!gcToken) return json({ error: 'GoCardless token not configured' }, { status: 503 });

  const gcBase = context.env.GC_ENVIRONMENT === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com';

  const gcHeaders = {
    Authorization: `Bearer ${gcToken}`,
    'GoCardless-Version': '2015-07-06',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  // player_payment.reference carries an 8-char billing-request suffix, but
  // confirm.ts writes the *logical* reference into subscription metadata. Match
  // both: the logical form for subscriptions created by the payer-facing flow,
  // the suffixed form for those created by earlier runs of this handler.
  const dbRef = payment.reference;
  const logicalRef = stripReferenceSuffix(dbRef);
  const refCandidates = new Set([dbRef, logicalRef]);

  // Idempotency: check GC for an existing live subscription before creating one
  const listRes = await fetch(`${gcBase}/subscriptions?mandate=${payment.mandateId}`, {
    headers: gcHeaders,
  });

  if (listRes.ok) {
    const { subscriptions: existing } = await listRes.json<{ subscriptions: GCSubscription[] }>();
    const live = existing.filter((s) => !TERMINAL_SUBSCRIPTION_STATUSES.has(s.status));

    // This mandate was created by a single billing request for a single payment
    // row, so any live subscription on it belongs to this payment and creating a
    // second one would double-charge the payer. Prefer a reference match for an
    // accurate audit trail, but fall back to "any live subscription on this
    // mandate" — the reference format has already drifted once.
    const match =
      live.find((s) => s.metadata?.reference && refCandidates.has(s.metadata.reference)) ?? live[0];

    if (match) {
      const matchedByReference =
        !!match.metadata?.reference && refCandidates.has(match.metadata.reference);
      // A finished subscription collected every payment of its plan, so the row
      // is paid in full rather than live — same mapping the webhook applies.
      const reconciledStatus = subscriptionStatusToPaymentStatus(match.status);

      // Subscription already exists — reconcile the DB row and return success
      await context.env.DB
        .prepare(
          `UPDATE "player_payment"
              SET subscriptionId = ?, status = ?, updatedAt = ?
            WHERE id = ?`
        )
        .bind(match.id, reconciledStatus, nowMs(), payment.id)
        .run();

      await writeAuditLog(context.env.DB, {
        clubSlug: clubSlug ?? '',
        adminId,
        action: 'retry_subscription_reconciled',
        targetTable: 'player_payment',
        targetId: payment.id,
        oldStatus: 'mandate_only',
        newStatus: reconciledStatus,
        note: matchedByReference
          ? `Existing subscription ${match.id} (${match.status}) found on GC; DB reconciled.`
          : `Existing subscription ${match.id} (${match.status}) found on mandate `
            + `${payment.mandateId} with reference "${match.metadata?.reference ?? '(none)'}" `
            + `(expected "${logicalRef}"); DB reconciled rather than creating a duplicate.`,
      });

      return json({
        ok: true,
        subscriptionId: match.id,
        reconciled: true,
        matchedByReference,
        status: reconciledStatus,
      });
    }
  }

  const amountInPence = Math.round(payment.yearlyPriceInPence / Math.max(1, payment.intervalCount));

  // Skipped entirely when no start date is configured — GoCardless then picks
  // the earliest chargeable date itself.
  const nextPossible = payment.startDate
    ? await fetchNextPossibleChargeDate(gcBase, gcHeaders, payment.mandateId)
    : null;
  const resolvedStartDate = resolveSubscriptionStartDate(
    payment.startDate,
    new Date(),
    nextPossible,
  );

  const subRes = await fetch(`${gcBase}/subscriptions`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      subscriptions: {
        amount: amountInPence,
        currency: 'GBP',
        interval_unit: payment.intervalUnit,
        interval: 1,
        // Without this the subscription is open-ended and collects forever.
        count: payment.intervalCount,
        name: logicalRef,
        metadata: { reference: logicalRef, customer_ref: logicalRef },
        links: { mandate: payment.mandateId },
        ...(resolvedStartDate ? { start_date: resolvedStartDate } : {}),
      },
    }),
  });

  if (!subRes.ok) {
    const detail = await subRes.text();
    console.error('Retry subscription creation failed:', detail);
    return json({ error: 'GoCardless rejected the subscription', detail }, { status: 502 });
  }

  const { subscriptions: sub } = await subRes.json<{ subscriptions: GCSubscription }>();

  await context.env.DB
    .prepare(
      `UPDATE "player_payment"
          SET subscriptionId = ?, status = 'active', updatedAt = ?
        WHERE id = ?`
    )
    .bind(sub.id, nowMs(), payment.id)
    .run();

  await writeAuditLog(context.env.DB, {
    clubSlug: clubSlug ?? '',
    adminId,
    action: 'retry_subscription',
    targetTable: 'player_payment',
    targetId: payment.id,
    oldStatus: 'mandate_only',
    newStatus: 'active',
    note: `New subscription ${sub.id} created on GC`
      + `${resolvedStartDate ? `, first collection ${resolvedStartDate}` : ''}.`,
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment subscription retried',
      ...clubGroups(clubSlug),
      properties: {
        club_slug: clubSlug,
        payment_id: payment.id,
        mandate_id: payment.mandateId,
        subscription_id: sub.id,
      },
    });
  }

  return json({ ok: true, subscriptionId: sub.id, startDate: resolvedStartDate });
};

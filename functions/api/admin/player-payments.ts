import { ensureTables } from '../../lib/ensure-tables';
import { type Env, json, nowMs, randomId, requireAdmin, getClubSlug } from '../../lib/api-helpers';
import { getPostHog } from '../../lib/posthog';
import { getSecret } from '../../lib/secrets';
import { writeAuditLog } from '../../lib/audit-log';
import { resolveSubscriptionStartDate } from '../../lib/gocardless-link';
import type { GCSubscription } from '../gocardless/_types';

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

// PATCH — deactivate a payment
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
      properties: { club_slug: clubSlug, payment_id: body.id },
    });
  }

  return json({ ok: true });
};

// POST — retry subscription creation for a mandate_only payment
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

  // Idempotency: check GC for an existing live subscription before creating one
  const listRes = await fetch(`${gcBase}/subscriptions?mandate=${payment.mandateId}`, {
    headers: gcHeaders,
  });

  if (listRes.ok) {
    const { subscriptions: existing } = await listRes.json<{ subscriptions: GCSubscription[] }>();
    const match = existing.find(
      (s) =>
        s.metadata?.reference === payment.reference &&
        s.status !== 'cancelled' &&
        s.status !== 'customer_approval_denied'
    );
    if (match) {
      // Subscription already exists — reconcile the DB row and return success
      await context.env.DB
        .prepare(
          `UPDATE "player_payment"
              SET subscriptionId = ?, status = 'active', updatedAt = ?
            WHERE id = ?`
        )
        .bind(match.id, nowMs(), payment.id)
        .run();

      await writeAuditLog(context.env.DB, {
        clubSlug: clubSlug ?? '',
        adminId,
        action: 'retry_subscription_reconciled',
        targetTable: 'player_payment',
        targetId: payment.id,
        oldStatus: 'mandate_only',
        newStatus: 'active',
        note: `Existing subscription ${match.id} found on GC; DB reconciled.`,
      });

      return json({ ok: true, subscriptionId: match.id, reconciled: true });
    }
  }

  const amountInPence = Math.round(payment.yearlyPriceInPence / Math.max(1, payment.intervalCount));
  const resolvedStartDate = resolveSubscriptionStartDate(payment.startDate);

  const subRes = await fetch(`${gcBase}/subscriptions`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      subscriptions: {
        amount: amountInPence,
        currency: 'GBP',
        interval_unit: payment.intervalUnit,
        interval: 1,
        name: payment.reference,
        metadata: { reference: payment.reference, customer_ref: payment.reference },
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
    note: `New subscription ${sub.id} created on GC.`,
  });

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'player payment subscription retried',
      properties: {
        club_slug: clubSlug,
        payment_id: payment.id,
        mandate_id: payment.mandateId,
        subscription_id: sub.id,
      },
    });
  }

  return json({ ok: true, subscriptionId: sub.id });
};

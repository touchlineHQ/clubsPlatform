import { ensureTables } from '../../lib/ensure-tables';
import { randomId, nowMs } from '../../lib/api-helpers';
import type { Env, GCBillingRequest, GCSubscription } from './_types';
import { getSecret } from '../../lib/secrets';

async function upsertPaymentRecord(
  db: D1Database,
  {
    clubSlug,
    registrationId,
    reference,
    mandateId,
    subscriptionId,
    amountInPence,
    intervalUnit,
    status,
  }: {
    clubSlug: string | null;
    registrationId: string;
    reference: string;
    mandateId: string;
    subscriptionId: string | null;
    amountInPence: number;
    intervalUnit: string;
    status: 'active' | 'mandate_only';
  }
): Promise<void> {
  if (!clubSlug || !registrationId) return;
  const now = nowMs();
  await db
    .prepare(
      `INSERT INTO "player_payment"
         (id, clubSlug, registrationId, reference, mandateId, subscriptionId,
          amountInPence, intervalUnit, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(clubSlug, reference) DO UPDATE SET
         mandateId      = excluded.mandateId,
         subscriptionId = COALESCE(excluded.subscriptionId, subscriptionId),
         status         = excluded.status,
         updatedAt      = excluded.updatedAt`
    )
    .bind(
      randomId('pay'),
      clubSlug,
      registrationId,
      reference,
      mandateId,
      subscriptionId,
      amountInPence,
      intervalUnit,
      status,
      now,
      now,
    )
    .run();
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  await ensureTables(env.DB);

  const url = new URL(request.url);
  const origin = url.origin;

  const billingRequestId = url.searchParams.get('billing_request_id');
  const reference = url.searchParams.get('reference');
  const amountStr = url.searchParams.get('amount');
  const intervalUnit = url.searchParams.get('interval_unit') as 'monthly' | 'weekly' | 'yearly' | null;
  const description = url.searchParams.get('description');
  const clubSlug = url.searchParams.get('club_slug');
  const registrationId = url.searchParams.get('registration_id') ?? '';

  if (!billingRequestId || !reference || !amountStr) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=missing_params`, 302);
  }

  const amountInPence = parseInt(amountStr, 10);
  if (isNaN(amountInPence) || amountInPence <= 0) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=invalid_amount`, 302);
  }

  const gcToken = await getSecret(env.DB, env, clubSlug, 'GC_ACCESS_TOKEN');
  if (!gcToken) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=token_missing`, 302);
  }

  const gcBase =
    env.GC_ENVIRONMENT === 'live'
      ? 'https://api.gocardless.com'
      : 'https://api-sandbox.gocardless.com';

  const gcHeaders = {
    Authorization: `Bearer ${gcToken}`,
    'GoCardless-Version': '2015-07-06',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const brRes = await fetch(`${gcBase}/billing_requests/${billingRequestId}`, {
    headers: gcHeaders,
  });

  if (!brRes.ok) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=fetch_failed`, 302);
  }

  let { billing_requests: br } = await brRes.json<{ billing_requests: GCBillingRequest }>();

  if (br.status !== 'fulfilled') {
    const fulfilRes = await fetch(
      `${gcBase}/billing_requests/${billingRequestId}/actions/fulfil`,
      {
        method: 'POST',
        headers: gcHeaders,
        body: JSON.stringify({}),
      }
    );

    if (!fulfilRes.ok) {
      const errText = await fulfilRes.text();
      console.error('Fulfil failed:', { initialStatus: br.status, error: errText });
      return Response.redirect(
        `${origin}/#/payment-cancelled?reason=fulfil_failed&status=${br.status}`,
        302
      );
    }

    const fulfilJson = await fulfilRes.json<{ billing_requests: GCBillingRequest }>();
    br = fulfilJson.billing_requests;
  }

  const mandateId = br.links?.mandate_request_mandate;
  if (!mandateId) {
    console.error('No mandate after fulfil:', { status: br.status, links: br.links });
    return Response.redirect(
      `${origin}/#/payment-cancelled?reason=no_mandate&status=${br.status}`,
      302
    );
  }

  // Idempotency: reuse existing non-terminated subscription with same reference
  const listRes = await fetch(`${gcBase}/subscriptions?mandate=${mandateId}`, {
    headers: gcHeaders,
  });
  if (listRes.ok) {
    const { subscriptions: existing } = await listRes.json<{ subscriptions: GCSubscription[] }>();
    const match = existing.find(
      (s) =>
        s.metadata?.reference === reference &&
        s.status !== 'cancelled' &&
        s.status !== 'customer_approval_denied'
    );
    if (match) {
      try {
        await upsertPaymentRecord(env.DB, {
          clubSlug, registrationId, reference, mandateId,
          subscriptionId: match.id,
          amountInPence, intervalUnit: intervalUnit || 'monthly', status: 'active',
        });
      } catch (e) {
        console.error('Failed to upsert payment record (existing sub):', e);
      }
      return Response.redirect(
        `${origin}/#/payment-success?mandate=${mandateId}&subscription=${match.id}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit || 'monthly'}&existing=1`,
        302
      );
    }
  }

  const subRes = await fetch(`${gcBase}/subscriptions`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      subscriptions: {
        amount: amountInPence,
        currency: 'GBP',
        interval_unit: intervalUnit || 'monthly',
        interval: 1,
        name: description || reference,
        metadata: { reference, customer_ref: reference },
        links: { mandate: mandateId },
      },
    }),
  });

  if (!subRes.ok) {
    console.error('Subscription creation failed:', await subRes.text());
    // Mandate exists — record it even without a subscription
    try {
      await upsertPaymentRecord(env.DB, {
        clubSlug, registrationId, reference, mandateId,
        subscriptionId: null,
        amountInPence, intervalUnit: intervalUnit || 'monthly', status: 'mandate_only',
      });
    } catch (e) {
      console.error('Failed to upsert payment record (mandate_only):', e);
    }
    return Response.redirect(
      `${origin}/#/payment-success?mandate=${mandateId}&warning=subscription_failed&ref=${encodeURIComponent(reference)}`,
      302
    );
  }

  const { subscriptions: sub } = await subRes.json<{ subscriptions: GCSubscription }>();

  try {
    await upsertPaymentRecord(env.DB, {
      clubSlug, registrationId, reference, mandateId,
      subscriptionId: sub.id,
      amountInPence, intervalUnit: intervalUnit || 'monthly', status: 'active',
    });
  } catch (e) {
    console.error('Failed to upsert payment record:', e);
  }

  return Response.redirect(
    `${origin}/#/payment-success?mandate=${mandateId}&subscription=${sub.id}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit || 'monthly'}`,
    302
  );
};

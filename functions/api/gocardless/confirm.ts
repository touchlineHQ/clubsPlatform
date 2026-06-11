import { ensureTables } from '../../lib/ensure-tables';
import { randomId, nowMs } from '../../lib/api-helpers';
import type { Env, GCBillingRequest, GCSubscription } from './_types';
import { getSecret } from '../../lib/secrets';
import { getPostHog } from '../../lib/posthog';
import { resolveFanIdFromRegistration } from '../../lib/posthog-identity';
import { resolveSubscriptionStartDate } from '../../lib/gocardless-link';

async function upsertPaymentRecord(
  db: D1Database,
  {
    clubSlug,
    registrationId,
    reference,
    billingRequestId,
    mandateId,
    subscriptionId,
    status,
  }: {
    clubSlug: string | null;
    registrationId: string;
    reference: string;
    billingRequestId: string;
    mandateId: string;
    subscriptionId: string | null;
    status: 'active' | 'mandate_only';
  }
): Promise<void> {
  if (!clubSlug || !registrationId) return;
  // Append the last 8 chars of the billing request ID so each distinct payment
  // attempt creates its own row rather than overwriting the previous one.
  // Same billing request replayed → same dbReference → idempotent UPDATE.
  const dbReference = `${reference}-${billingRequestId.slice(-8)}`;
  const now = nowMs();
  await db
    .prepare(
      `INSERT INTO "player_payment"
         (id, clubSlug, registrationId, reference, mandateId, subscriptionId,
          status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      dbReference,
      mandateId,
      subscriptionId,
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
  const urlReference = url.searchParams.get('reference');
  const description = url.searchParams.get('description');

  // NOTE: registration_id, club_slug, amount, interval_unit, count are
  // deliberately NOT trusted from the URL — they're either read from the
  // billing-request metadata (set server-side at link creation) or
  // re-derived from the DB. See P0#3 in the go-live review.

  if (!billingRequestId || !urlReference) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=missing_params`, 302);
  }

  // We need the club_slug to look up the GC token, but we can't trust the URL
  // params. The token lookup tolerates an initial guess from the URL — if it
  // mismatches the metadata after fetch we redirect to cancelled.
  const urlClubSlug = url.searchParams.get('club_slug');

  const gcToken = await getSecret(env.DB, env, urlClubSlug, 'GC_ACCESS_TOKEN');
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

  // Server-side authoritative values — set in gocardless-link.ts when the
  // billing request was created. URL params for these are ignored.
  const registrationId = br.metadata?.registration_id ?? '';
  const reference = br.metadata?.reference ?? urlReference;

  if (!registrationId) {
    // Legacy link created before metadata stamping (PR 2). The grace period
    // is intentionally short — by the time these matter, payers have re-clicked.
    return Response.redirect(`${origin}/#/payment-cancelled?reason=legacy_link`, 302);
  }

  // Re-derive the payment plan AND the club slug from the DB, keyed by
  // registration id (the only authoritative identifier we get from metadata).
  // clubSlug must come from the DB, not the URL, so an attacker can't write
  // a payment row against a club they don't own.
  const pricing = await env.DB
    .prepare(
      `SELECT pr.clubSlug, sl.yearlyPriceInPence, sl.intervalCount, sl.intervalUnit, sl.startDate
         FROM player_registration pr
         LEFT JOIN registration_subscription_level rsl
                ON rsl.registrationId = pr.id
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
        WHERE pr.id = ?`
    )
    .bind(registrationId)
    .first<{
      clubSlug: string;
      yearlyPriceInPence: number | null;
      intervalCount: number | null;
      intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
      startDate: string | null;
    }>();

  if (
    !pricing ||
    pricing.yearlyPriceInPence == null ||
    pricing.intervalCount == null ||
    !pricing.intervalUnit
  ) {
    return Response.redirect(`${origin}/#/payment-cancelled?reason=no_level`, 302);
  }

  const clubSlug = pricing.clubSlug;

  const amountInPence = Math.round(pricing.yearlyPriceInPence / Math.max(1, pricing.intervalCount));
  const intervalUnit = pricing.intervalUnit;
  const subscriptionCount = pricing.intervalCount;
  const resolvedStartDate = resolveSubscriptionStartDate(pricing.startDate);

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

  // Cross-mandate dedupe: GC's per-mandate subscription idempotency below only
  // catches replays against the *same* mandate. If the player completes the
  // flow twice (timeout, retry hours apart) they end up with two mandates. We
  // store player_payment.reference as `<reference>-<last-8-of-billing-request>`
  // — match the logical prefix to detect a prior successful setup against a
  // different mandate. If found, cancel the new mandate and reuse the existing
  // subscription so the player isn't double-charged.
  const priorPayment = await env.DB
    .prepare(
      `SELECT mandateId, subscriptionId, status FROM "player_payment"
         WHERE clubSlug = ?
           AND registrationId = ?
           AND reference LIKE ? || '-________'
           AND status IN ('active', 'mandate_only')
         ORDER BY updatedAt DESC
         LIMIT 1`
    )
    .bind(clubSlug, registrationId, reference)
    .first<{ mandateId: string; subscriptionId: string | null; status: string }>();

  if (
    priorPayment &&
    priorPayment.subscriptionId &&
    priorPayment.mandateId !== mandateId
  ) {
    // Best-effort cancel of the duplicate new mandate. Failures here are
    // non-fatal — the player just ends up with an extra cancellable mandate
    // visible in GoCardless; they won't be charged because we don't create a
    // subscription against it.
    await fetch(`${gcBase}/mandates/${mandateId}/actions/cancel`, {
      method: 'POST',
      headers: gcHeaders,
      body: JSON.stringify({}),
    }).catch((e) => console.error('Failed to cancel duplicate mandate', e));

    const posthog = getPostHog(env);
    if (posthog) {
      const fanId = await resolveFanIdFromRegistration(env.DB, registrationId);
      // Fire-and-forget: don't block response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || registrationId,
        event: 'payment duplicate mandate cancelled',
        properties: {
          club_slug: clubSlug,
          reference,
          new_mandate_id: mandateId,
          existing_mandate_id: priorPayment.mandateId,
          existing_subscription_id: priorPayment.subscriptionId,
        },
      }).catch(err => console.error('PostHog capture failed', err));
    }

    return Response.redirect(
      `${origin}/#/payment-success?mandate=${priorPayment.mandateId}&subscription=${priorPayment.subscriptionId}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit}&existing=1`,
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
          clubSlug, registrationId, reference, billingRequestId,
          mandateId, subscriptionId: match.id,
          status: 'active',
        });
      } catch (e) {
        console.error('Failed to upsert payment record (existing sub):', e);
      }
      return Response.redirect(
        `${origin}/#/payment-success?mandate=${mandateId}&subscription=${match.id}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit}&existing=1`,
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
        interval_unit: intervalUnit,
        interval: 1,
        count: subscriptionCount,
        name: description || reference,
        metadata: { reference, customer_ref: reference },
        links: { mandate: mandateId },
        ...(resolvedStartDate ? { start_date: resolvedStartDate } : {}),
      },
    }),
  });

  const subResText = await subRes.text();
  if (!subRes.ok) {
    console.error('Subscription creation failed:', subResText);
    // Mandate exists — record it even without a subscription
    try {
      await upsertPaymentRecord(env.DB, {
        clubSlug, registrationId, reference, billingRequestId,
        mandateId, subscriptionId: null,
        status: 'mandate_only',
      });
    } catch (e) {
      console.error('Failed to upsert payment record (mandate_only):', e);
    }
    const posthog = getPostHog(env);
    if (posthog) {
      const fanId = await resolveFanIdFromRegistration(env.DB, registrationId);
      // Fire-and-forget: don't block response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || registrationId,
        event: 'payment failed',
        properties: { club_slug: clubSlug, reference, mandate_id: mandateId, reason: 'subscription_creation_failed' },
      }).catch(err => console.error('PostHog capture failed', err));
    }
    return Response.redirect(
      `${origin}/#/payment-success?mandate=${mandateId}&warning=subscription_failed&ref=${encodeURIComponent(reference)}`,
      302
    );
  }

  const { subscriptions: sub } = JSON.parse(subResText) as { subscriptions: GCSubscription };

  try {
    await upsertPaymentRecord(env.DB, {
      clubSlug, registrationId, reference, billingRequestId,
      mandateId, subscriptionId: sub.id,
      status: 'active',
    });
  } catch (e) {
    console.error('Failed to upsert payment record:', e);
  }

  const posthog = getPostHog(env);
  if (posthog) {
    const fanId = await resolveFanIdFromRegistration(env.DB, registrationId);
    // Fire-and-forget: don't block response on PostHog
    posthog.captureImmediate({
      distinctId: fanId || registrationId,
      event: 'payment completed',
      properties: {
        club_slug: clubSlug,
        reference,
        mandate_id: mandateId,
        subscription_id: sub.id,
        amount_in_pence: amountInPence,
        interval_unit: intervalUnit,
      },
    }).catch(err => console.error('PostHog capture failed', err));
  }

  return Response.redirect(
    `${origin}/#/payment-success?mandate=${mandateId}&subscription=${sub.id}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit}`,
    302
  );
};

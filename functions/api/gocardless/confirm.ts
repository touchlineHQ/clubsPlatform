import { ensureTables } from '../../lib/ensure-tables';
import { randomId, nowMs } from '../../lib/api-helpers';
import type { Env, GCBillingRequest, GCSubscription } from './_types';
import { getSecret } from '../../lib/secrets';
import { getPostHog, clubGroups } from '../../lib/posthog';
import { resolveFanIdFromRegistration } from '../../lib/posthog-identity';
import {
  resolveSubscriptionStartDate,
  fetchNextPossibleChargeDate,
} from '../../lib/gocardless-link';
import {
  buildDbReference,
  buildLogicalReference,
  paymentTypeFromReference,
} from '../../lib/payment-reference';
import {
  PAID_IN_FULL_STATUSES,
  subscriptionStatusToPaymentStatus,
} from '../../lib/payment-status';
import {
  billingRegistrationJoinSql,
  subscriptionLevelJoinSql,
} from '../../lib/registration-merge';

/**
 * Inserts or updates a player_payment record for a completed GoCardless flow.
 *
 * Appends the billing request ID to the reference to ensure each payment attempt
 * gets its own row. Replays of the same billing request become idempotent updates.
 * Throws if the registration changed or persistence cannot be completed, so the
 * caller can compensate the remote GoCardless resources.
 */
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
    linkedRegistrationId,
    expectedGeneration,
  }: {
    clubSlug: string | null;
    registrationId: string;
    reference: string;
    billingRequestId: string;
    mandateId: string;
    subscriptionId: string | null;
    status: 'active' | 'completed' | 'mandate_only';
    linkedRegistrationId: string;
    expectedGeneration: number;
  }
): Promise<void> {
  if (!clubSlug || !registrationId) {
    throw new Error('Cannot persist payment without a club and registration');
  }
  // Append the last 8 chars of the billing request ID so each distinct payment
  // attempt creates its own row rather than overwriting the previous one.
  // Same billing request replayed → same dbReference → idempotent UPDATE.
  const dbReference = buildDbReference(reference, billingRequestId);
  const now = nowMs();
  const write = await db
    .prepare(
      `INSERT INTO "player_payment"
         (id, clubSlug, registrationId, reference, mandateId, subscriptionId,
          status, createdAt, updatedAt)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
        WHERE COALESCE((
                SELECT generation FROM "registration_payment_state"
                 WHERE "registrationId" = ? AND "clubSlug" = ?
              ), 0) = ?
          AND ? = COALESCE((
                SELECT "primaryRegistrationId" FROM "registration_merge"
                 WHERE "registrationId" = ? AND "clubSlug" = ?
              ), ?)
       ON CONFLICT(clubSlug, reference) DO UPDATE SET
         mandateId      = excluded.mandateId,
         subscriptionId = COALESCE(excluded.subscriptionId, subscriptionId),
         -- A row that has paid the season in full stays that way. A replay
         -- long after the plan completed would otherwise write it back to
         -- 'active' and re-open the mandate flow to a paid-up player.
         status         = CASE
                            WHEN "player_payment".status IN (${PAID_IN_FULL_STATUSES.map(() => '?').join(', ')})
                            THEN "player_payment".status
                            ELSE excluded.status
                          END,
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
      linkedRegistrationId,
      clubSlug,
      expectedGeneration,
      registrationId,
      linkedRegistrationId,
      clubSlug,
      linkedRegistrationId,
      ...PAID_IN_FULL_STATUSES,
    )
    .run();

  if ((write.meta.changes ?? 0) !== 1) {
    throw new Error('Registration changed while the GoCardless flow was completing');
  }
}

async function cancelGoCardlessResources(
  gcBase: string,
  gcHeaders: Record<string, string>,
  mandateId: string,
  subscriptionId: string | null,
): Promise<void> {
  const cancel = async (kind: 'subscriptions' | 'mandates', id: string) => {
    try {
      const response = await fetch(`${gcBase}/${kind}/${id}/actions/cancel`, {
        method: 'POST',
        headers: gcHeaders,
        body: JSON.stringify({}),
      });
      if (!response.ok) console.error(`Failed to cancel GoCardless ${kind}`, { id, status: response.status });
    } catch (error) {
      console.error(`Failed to cancel GoCardless ${kind}`, { id, error });
    }
  };

  if (subscriptionId) await cancel('subscriptions', subscriptionId);
  await cancel('mandates', mandateId);
}

async function claimPaymentConfirmation(
  db: D1Database,
  {
    clubSlug,
    linkedRegistrationId,
    registrationId,
    expectedGeneration,
    billingRequestId,
  }: {
    clubSlug: string;
    linkedRegistrationId: string;
    registrationId: string;
    expectedGeneration: number;
    billingRequestId: string;
  },
): Promise<boolean> {
  const now = nowMs();
  const expiresAt = now + 15 * 60_000;
  const result = await db
    .prepare(
      `INSERT INTO "registration_payment_state"
         ("clubSlug", "registrationId", "generation", "claimId",
          "confirmationId", "confirmationExpiresAt", "updatedAt")
       SELECT ?, ?, ?, '', ?, ?, ?
        WHERE ? = COALESCE((
                SELECT "primaryRegistrationId" FROM "registration_merge"
                 WHERE "registrationId" = ? AND "clubSlug" = ?
              ), ?)
       ON CONFLICT("registrationId") DO UPDATE SET
         "confirmationId" = excluded."confirmationId",
         "confirmationExpiresAt" = excluded."confirmationExpiresAt",
         "updatedAt" = excluded."updatedAt"
       WHERE "registration_payment_state"."clubSlug" = excluded."clubSlug"
         AND "registration_payment_state"."generation" = ?
         AND (
           "registration_payment_state"."confirmationId" IS NULL
           OR "registration_payment_state"."confirmationExpiresAt" <= ?
           OR "registration_payment_state"."confirmationId" = excluded."confirmationId"
         )`,
    )
    .bind(
      clubSlug, linkedRegistrationId, expectedGeneration, billingRequestId, expiresAt, now,
      registrationId, linkedRegistrationId, clubSlug, linkedRegistrationId,
      expectedGeneration, now,
    )
    .run();

  return (result.meta.changes ?? 0) === 1;
}

async function releasePaymentConfirmation(
  db: D1Database,
  clubSlug: string,
  linkedRegistrationId: string,
  billingRequestId: string,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE "registration_payment_state"
            SET "confirmationId" = NULL, "confirmationExpiresAt" = NULL, "updatedAt" = ?
          WHERE "clubSlug" = ? AND "registrationId" = ? AND "confirmationId" = ?`,
      )
      .bind(nowMs(), clubSlug, linkedRegistrationId, billingRequestId)
      .run();
  } catch (error) {
    // The lease expires, so a cleanup failure delays unmerge rather than blocking it forever.
    console.error('Failed to release payment confirmation claim', error);
  }
}

/**
 * GET handler — GoCardless redirect endpoint after a payer completes the billing flow.
 *
 * Validates the billing request, creates or reconciles a GoCardless subscription,
 * and writes the payment record to the database. Handles cross-mandate deduplication
 * to prevent double-charging. All authoritative data (club, pricing, registration)
 * is re-derived from the database rather than trusting URL parameters.
 */
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
  const linkedRegistrationId = br.metadata?.registration_id ?? '';
  const linkedReference = br.metadata?.reference ?? urlReference;

  if (!linkedRegistrationId) {
    // Legacy link created before metadata stamping (PR 2). The grace period
    // is intentionally short — by the time these matter, payers have re-clicked.
    return Response.redirect(`${origin}/#/payment-cancelled?reason=legacy_link`, 302);
  }

  // clubSlug from the URL would let an attacker write against a club they don't own.
  // The join resolves through any merge: a link minted before this registration
  // became a secondary is still live, and billing it directly would charge twice.
  const pricing = await env.DB
    .prepare(
      `SELECT pr.id AS registrationId, pr.clubSlug, pr.teamName, p.fanId,
              sl.yearlyPriceInPence, sl.intervalCount, sl.intervalUnit, sl.startDate,
              COALESCE(rps.generation, 0) AS paymentGeneration
         FROM player_registration src
         ${billingRegistrationJoinSql('src', 'pr')}
         JOIN player p ON p.id = pr.playerId
         ${subscriptionLevelJoinSql('pr')}
         LEFT JOIN registration_payment_state rps ON rps.registrationId = src.id
        WHERE src.id = ?`
    )
    .bind(linkedRegistrationId)
    .first<{
      registrationId: string;
      clubSlug: string;
      teamName: string;
      fanId: string;
      yearlyPriceInPence: number | null;
      intervalCount: number | null;
      intervalUnit: 'monthly' | 'weekly' | 'yearly' | null;
      startDate: string | null;
      paymentGeneration: number;
    }>();

  const registrationId = pricing?.registrationId ?? linkedRegistrationId;

  // Rebuilt from the billing registration so a group keeps one stable reference;
  // identical when unmerged. The parse is a fallback for pre-payment_type links.
  const paymentType = br.metadata?.payment_type ?? paymentTypeFromReference(linkedReference);
  const reference = pricing
    ? buildLogicalReference(pricing.teamName, pricing.fanId, paymentType)
    : linkedReference;

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
  const stampedGeneration = br.metadata?.registration_generation;
  const expectedGeneration = stampedGeneration === undefined
    ? 0
    : /^\d+$/.test(stampedGeneration) ? Number(stampedGeneration) : -1;

  // Unmerge advances this generation in the same transaction that removes the
  // mappings. Old links are rejected before fulfilment; the guarded UPSERT below
  // closes the remaining race if unmerge starts during a GoCardless request.
  if ((pricing.paymentGeneration ?? 0) !== expectedGeneration) {
    const mandateId = br.links?.mandate_request_mandate;
    if (mandateId) await cancelGoCardlessResources(gcBase, gcHeaders, mandateId, null);
    return Response.redirect(`${origin}/#/payment-cancelled?reason=registration_changed`, 302);
  }

  const confirmationClaimed = await claimPaymentConfirmation(env.DB, {
    clubSlug,
    linkedRegistrationId,
    registrationId,
    expectedGeneration,
    billingRequestId,
  });
  if (!confirmationClaimed) {
    const mandateId = br.links?.mandate_request_mandate;
    if (mandateId) await cancelGoCardlessResources(gcBase, gcHeaders, mandateId, null);
    return Response.redirect(`${origin}/#/payment-cancelled?reason=registration_changed`, 302);
  }

  try {
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
  // flow twice (timeout, retry hours apart) they end up with two mandates. Find
  // a prior successful setup against a different mandate, cancel the new
  // mandate and reuse the existing subscription so the player isn't
  // double-charged.
  //
  // The old `reference LIKE` clause is gone: a pre-merge link carries the
  // secondary's reference and the stored row the primary's, so it failed exactly
  // when the dedupe was needed. The status filter still excludes manual rows.
  const priorPayment = await env.DB
    .prepare(
      `SELECT mandateId, subscriptionId, status FROM "player_payment"
         WHERE clubSlug = ?
           AND registrationId = ?
           AND status IN ('active', 'mandate_only')
         ORDER BY updatedAt DESC
         LIMIT 1`
    )
    .bind(clubSlug, registrationId)
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
        ...clubGroups(clubSlug),
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
          // The finder above only skips subscriptions that will never collect,
          // so a 'finished' one — the plan already paid in full — matches here.
          status: subscriptionStatusToPaymentStatus(match.status),
          linkedRegistrationId,
          expectedGeneration,
        });
      } catch (e) {
        console.error('Failed to upsert payment record (existing sub):', e);
        await cancelGoCardlessResources(gcBase, gcHeaders, mandateId, match.id);
        return Response.redirect(`${origin}/#/payment-cancelled?reason=persistence_failed`, 302);
      }
      return Response.redirect(
        `${origin}/#/payment-success?mandate=${mandateId}&subscription=${match.id}&ref=${encodeURIComponent(reference)}&amount=${amountInPence}&interval_unit=${intervalUnit}&existing=1`,
        302
      );
    }
  }

  // Resolved here rather than earlier so the mandate lookup is never spent on a
  // path that returns before creating a subscription, and skipped entirely when
  // no start date is configured.
  const nextPossible = pricing.startDate
    ? await fetchNextPossibleChargeDate(gcBase, gcHeaders, mandateId)
    : null;
  const resolvedStartDate = resolveSubscriptionStartDate(
    pricing.startDate,
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
        linkedRegistrationId,
        expectedGeneration,
      });
    } catch (e) {
      console.error('Failed to upsert payment record (mandate_only):', e);
      await cancelGoCardlessResources(gcBase, gcHeaders, mandateId, null);
      return Response.redirect(`${origin}/#/payment-cancelled?reason=persistence_failed`, 302);
    }
    const posthog = getPostHog(env);
    if (posthog) {
      const fanId = await resolveFanIdFromRegistration(env.DB, registrationId);
      // Fire-and-forget: don't block response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || registrationId,
        event: 'payment failed',
        ...clubGroups(clubSlug),
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
      linkedRegistrationId,
      expectedGeneration,
    });
  } catch (e) {
    console.error('Failed to upsert payment record:', e);
    await cancelGoCardlessResources(gcBase, gcHeaders, mandateId, sub.id);
    return Response.redirect(`${origin}/#/payment-cancelled?reason=persistence_failed`, 302);
  }

  const posthog = getPostHog(env);
  if (posthog) {
    const fanId = await resolveFanIdFromRegistration(env.DB, registrationId);
    // Fire-and-forget: don't block response on PostHog
    posthog.captureImmediate({
      distinctId: fanId || registrationId,
      event: 'payment completed',
      ...clubGroups(clubSlug),
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
  } finally {
    await releasePaymentConfirmation(env.DB, clubSlug, linkedRegistrationId, billingRequestId);
  }
};

import { ensureTables } from '../../lib/ensure-tables';
import { nowMs } from '../../lib/api-helpers';
import { decryptSecret } from '../../lib/secrets';
import { getPostHog } from '../../lib/posthog';
import { resolveFanIdFromGCResource } from '../../lib/posthog-identity';
import { NOT_PAID_IN_FULL_SQL } from '../../lib/payment-status';
import type { Env } from './_types';

interface GCWebhookEvent {
  id: string;
  created_at?: string;
  resource_type: string;
  action: string;
  links?: {
    mandate?: string;
    subscription?: string;
    payment?: string;
    customer?: string;
  };
  details?: {
    cause?: string;
    description?: string;
    reason_code?: string;
  };
}

interface GCWebhookBody {
  events: GCWebhookEvent[];
}

function hexFromBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function computeHmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return hexFromBuffer(sig);
}

/**
 * Try every configured GC_WEBHOOK_SECRET until one HMAC matches. Returns true if
 * verified. With one club, this is a single iteration; with N clubs, at most N.
 */
async function verifySignature(
  env: Env,
  rawBody: string,
  signatureHeader: string,
): Promise<boolean> {
  const rows = await env.DB
    .prepare(
      `SELECT encryptedValue, iv FROM "club_secret" WHERE key = 'GC_WEBHOOK_SECRET'`,
    )
    .all<{ encryptedValue: string; iv: string }>();
  if (!rows.results || rows.results.length === 0) return false;
  for (const row of rows.results) {
    let secret: string;
    try {
      secret = await decryptSecret(env, row.encryptedValue, row.iv);
    } catch {
      continue;
    }
    const expected = await computeHmacHex(secret, rawBody);
    if (constantTimeEqual(expected, signatureHeader.toLowerCase())) return true;
  }
  return false;
}

/** Map a GC mandate action to our internal player_payment status. */
function mandateActionToStatus(action: string): 'active' | 'inactive' | null {
  switch (action) {
    case 'cancelled':
    case 'expired':
    case 'failed':
    case 'consumed':
      return 'inactive';
    case 'reinstated':
    case 'active':
      return 'active';
    default:
      return null;
  }
}

/**
 * Map a GC subscription action to our internal player_payment status.
 *
 * 'finished' and 'cancelled' both end a subscription but mean opposite things
 * to a treasurer: finished is the plan collecting its last payment, cancelled
 * is the payer stopping early. Only 'cancelled' is a problem.
 *
 * created / customer_approval_granted / payment_created deliberately map to
 * nothing: they arrive throughout the life of a subscription, so treating them
 * as "active" would resurrect a row an admin had just deactivated.
 */
function subscriptionActionToStatus(action: string): 'completed' | 'inactive' | null {
  switch (action) {
    case 'finished':
      return 'completed';
    case 'cancelled':
      return 'inactive';
    default:
      return null;
  }
}

async function handleEvent(env: Env, ev: GCWebhookEvent): Promise<void> {
  const now = nowMs();
  const mandateId = ev.links?.mandate ?? null;
  const subscriptionId = ev.links?.subscription ?? null;
  const paymentId = ev.links?.payment ?? null;

  // Idempotency: skip if we've already processed this event. GoCardless retries
  // indefinitely until we 2xx, so seeing the same event id again means done.
  const existing = await env.DB
    .prepare(`SELECT id FROM "gc_webhook_event" WHERE id = ? LIMIT 1`)
    .bind(ev.id)
    .first<{ id: string }>();
  if (existing) return;

  const posthog = getPostHog(env);

  // Resolve fanId for PostHog identity stitching (frontend uses fanId as distinctId)
  const fanId = await resolveFanIdFromGCResource(env.DB, mandateId, subscriptionId);

  // No club group on these events: a GoCardless callback carries no club
  // context, and resolving one would mean returning clubSlug alongside fanId
  // from resolveFanIdFromGCResource. The payer-facing funnel (payment page
  // viewed → link created → payment completed) is grouped at every step, so
  // these downstream mirrors are the least valuable place to add that lookup.

  const recordEvent = async () => {
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO "gc_webhook_event"
           (id, resourceType, action, mandateId, subscriptionId, paymentId, rawBody, receivedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        ev.id,
        ev.resource_type,
        ev.action,
        mandateId,
        subscriptionId,
        paymentId,
        JSON.stringify(ev),
        now,
      )
      .run();
  };

  if (ev.resource_type === 'mandates' && mandateId) {
    const status = mandateActionToStatus(ev.action);
    if (status) {
      // The paid-in-full guard matters most here: a payer who has finished
      // their plan usually cancels the Direct Debit afterwards, and the
      // mandates.cancelled that follows must not undo "paid in full".
      await env.DB
        .prepare(
          `UPDATE "player_payment"
              SET status = ?, updatedAt = ?
            WHERE mandateId = ?
              AND status != ?
              AND ${NOT_PAID_IN_FULL_SQL}`,
        )
        .bind(status, now, mandateId, status)
        .run();
    }
    if (posthog) {
      // Fire-and-forget: don't block webhook response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || mandateId,
        event: `gc mandate ${ev.action}`,
        properties: {
          mandate_id: mandateId,
          action: ev.action,
          cause: ev.details?.cause,
          description: ev.details?.description,
        },
      }).catch(err => console.error('PostHog capture failed', err));
    }
    await recordEvent();
    return;
  }

  if (ev.resource_type === 'subscriptions' && subscriptionId) {
    const status = subscriptionActionToStatus(ev.action);
    if (status) {
      await env.DB
        .prepare(
          `UPDATE "player_payment"
              SET status = ?, updatedAt = ?
            WHERE subscriptionId = ?
              AND status != ?
              AND ${NOT_PAID_IN_FULL_SQL}`,
        )
        .bind(status, now, subscriptionId, status)
        .run();
    }
    if (posthog) {
      // Fire-and-forget: don't block webhook response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || subscriptionId,
        event: `gc subscription ${ev.action}`,
        properties: {
          subscription_id: subscriptionId,
          action: ev.action,
          cause: ev.details?.cause,
          description: ev.details?.description,
        },
      }).catch(err => console.error('PostHog capture failed', err));
    }
    await recordEvent();
    return;
  }

  if (ev.resource_type === 'payments' && paymentId) {
    // Single payment events don't change mandate/subscription status — a single
    // failed collection is recoverable. We log for visibility only.
    if (posthog) {
      // Fire-and-forget: don't block webhook response on PostHog
      posthog.captureImmediate({
        distinctId: fanId || paymentId,
        event: `gc payment ${ev.action}`,
        properties: {
          payment_id: paymentId,
          mandate_id: mandateId,
          subscription_id: subscriptionId,
          action: ev.action,
          cause: ev.details?.cause,
          description: ev.details?.description,
        },
      }).catch(err => console.error('PostHog capture failed', err));
    }
    await recordEvent();
    return;
  }

  // Unhandled resource_type — still record so we don't reprocess on retry.
  await recordEvent();
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  await ensureTables(env.DB);

  const signatureHeader = request.headers.get('Webhook-Signature');
  if (!signatureHeader) {
    return new Response('missing signature', { status: 401 });
  }

  // GoCardless signs the raw body — must read once, verify, then parse.
  const rawBody = await request.text();

  const verified = await verifySignature(env, rawBody, signatureHeader);
  if (!verified) {
    return new Response('invalid signature', { status: 401 });
  }

  let body: GCWebhookBody;
  try {
    body = JSON.parse(rawBody) as GCWebhookBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }
  if (!Array.isArray(body.events)) {
    return new Response('invalid payload', { status: 400 });
  }

  let anyFailed = false;
  for (const ev of body.events) {
    try {
      await handleEvent(env, ev);
    } catch (e) {
      anyFailed = true;
      console.error('webhook event handler failed', { eventId: ev.id, error: e });
    }
  }

  // 5xx if anything failed so GoCardless retries the batch. Successfully
  // processed events are skipped on retry via the gc_webhook_event idempotency.
  if (anyFailed) return new Response('partial failure', { status: 500 });
  return new Response(null, { status: 204 });
};

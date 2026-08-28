import type { Env } from '../api/gocardless/_types';
import type { GCBillingRequest, GCBillingRequestFlow, GCMandate } from '../api/gocardless/_types';
import { getSecret } from './secrets';

export interface CreateLinkInput {
  env: Env;
  db: D1Database;
  clubSlug: string | null;
  registrationId: string;
  paymentType: string;
  amountInPence: number;
  intervalUnit: 'monthly' | 'weekly' | 'yearly';
  count?: number | null;
  /** YYYY-MM-DD. Configured first payment date for the subscription. */
  startDate?: string | null;
  description?: string;
  origin: string;
}

/**
 * Resolve the GoCardless subscription start_date from a configured start date.
 * If today is already past the configured date, push to the first of next month
 * so we don't try to start a subscription in the past.
 *
 * `earliestChargeable` is the mandate's next_possible_charge_date. Bacs mandates
 * carry a submission lead time (roughly 3-5 working days, longer while still
 * pending_submission) and GoCardless rejects anything earlier with "start_date
 * must be on or after mandate's next_possible_charge_date". Clamping is applied
 * to whichever branch above produced the date — the first-of-next-month fallback
 * needs it just as much, since on the 30th that date is a day away.
 *
 * ISO YYYY-MM-DD strings compare lexicographically the same way they compare
 * chronologically, so plain string comparison is correct throughout.
 *
 * Returns YYYY-MM-DD, or null if no date is configured — callers omit
 * start_date entirely in that case and let GoCardless pick the earliest itself.
 */
export function resolveSubscriptionStartDate(
  configured: string | null | undefined,
  today: Date = new Date(),
  earliestChargeable: string | null = null,
): string | null {
  if (!configured || !/^\d{4}-\d{2}-\d{2}$/.test(configured)) return null;
  const todayIso = today.toISOString().slice(0, 10);
  let resolved = configured;
  if (configured < todayIso) {
    const nextMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    resolved = nextMonth.toISOString().slice(0, 10);
  }
  if (earliestChargeable && /^\d{4}-\d{2}-\d{2}$/.test(earliestChargeable)) {
    return earliestChargeable > resolved ? earliestChargeable : resolved;
  }
  return resolved;
}

/**
 * Read a mandate's earliest chargeable date, for clamping a subscription's
 * start_date. Returns null when the mandate can't be read or has no such date
 * (cancelled, failed, expired) — both mean the same thing to every caller:
 * don't clamp. Never throws; confirm.ts has no try/catch around the payer flow,
 * so a rejection here would turn a redirect into a 500.
 */
export async function fetchNextPossibleChargeDate(
  gcBase: string,
  gcHeaders: Record<string, string>,
  mandateId: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${gcBase}/mandates/${mandateId}`, { headers: gcHeaders });
    if (!res.ok) {
      console.error('Mandate lookup failed', { mandateId, status: res.status });
      return null;
    }
    const { mandates } = await res.json<{ mandates: GCMandate }>();
    return mandates?.next_possible_charge_date ?? null;
  } catch (e) {
    console.error('Mandate lookup threw', { mandateId, error: e });
    return null;
  }
}

export interface CreateLinkResult {
  ok: true;
  authorisationUrl: string;
  reference: string;
  billingRequestId: string;
}

export interface CreateLinkError {
  ok: false;
  status: number;
  error: string;
  detail?: string;
}

/**
 * Looks up a registration, creates a GoCardless billing request + flow,
 * and returns the hosted authorisation URL. Used by both the authenticated
 * admin endpoint and the public per-player payment redirect.
 */
export async function createGoCardlessLink(input: CreateLinkInput): Promise<CreateLinkResult | CreateLinkError> {
  const { env, db, clubSlug, registrationId, paymentType, amountInPence, intervalUnit, origin } = input;

  if (!registrationId || !paymentType || !amountInPence || amountInPence <= 0) {
    return { ok: false, status: 400, error: 'Missing or invalid required fields' };
  }

  let totalCount: number | null = null;
  if (input.count !== undefined && input.count !== null) {
    const n = Number(input.count);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      return { ok: false, status: 400, error: 'count must be an integer between 1 and 200' };
    }
    totalCount = n;
  }

  const gcToken = await getSecret(db, env, clubSlug, 'GC_ACCESS_TOKEN');
  if (!gcToken) {
    return {
      ok: false,
      status: 503,
      error: 'GoCardless API token not configured. Set GC_ACCESS_TOKEN in Admin → API Secrets.',
    };
  }

  const reg = await db
    .prepare(
      `SELECT pr.id, pr.teamName, p.fanId
         FROM player_registration pr
         JOIN player p ON p.id = pr.playerId
        WHERE pr.id = ? AND pr.clubSlug = ?`
    )
    .bind(registrationId, clubSlug)
    .first<{ id: string; teamName: string; fanId: string }>();

  if (!reg) {
    return { ok: false, status: 404, error: 'Registration not found' };
  }

  const { fanId, teamName } = reg;
  const reference = `${teamName.replace(/\s+/g, '').toUpperCase()}-${fanId}-${paymentType}`;
  const baseDescription = input.description ?? `${teamName} — FAN ${fanId}`;

  const pounds = (amountInPence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
  });
  const freq = intervalUnit === 'weekly' ? 'week' : intervalUnit === 'yearly' ? 'year' : 'month';
  const hostedDescription = totalCount === 1
    ? `${baseDescription} — ${pounds} one-off`
    : `${baseDescription} — ${pounds} per ${freq}${totalCount ? ` for ${totalCount} payments` : ''}`;

  const gcBase =
    env.GC_ENVIRONMENT === 'live'
      ? 'https://api.gocardless.com'
      : 'https://api-sandbox.gocardless.com';

  const gcHeaders = {
    Authorization: `Bearer ${gcToken}`,
    'GoCardless-Version': '2015-07-06',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  const brRes = await fetch(`${gcBase}/billing_requests`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      billing_requests: {
        mandate_request: {
          scheme: 'bacs',
          description: hostedDescription,
        },
        metadata: {
          reference,
          registration_id: registrationId,
          tracking_info: `team:${teamName}|fan:${fanId}|type:${paymentType}|${amountInPence}p-${intervalUnit}${totalCount ? `-x${totalCount}` : ''}`,
        },
      },
    }),
  });

  if (!brRes.ok) {
    const detail = await brRes.text();
    return { ok: false, status: 502, error: 'Failed to create billing request', detail };
  }

  const { billing_requests: br } = await brRes.json<{ billing_requests: GCBillingRequest }>();

  const confirmParams = new URLSearchParams({
    billing_request_id: br.id,
    reference,
    amount: String(amountInPence),
    interval_unit: intervalUnit,
    description: baseDescription,
    registration_id: registrationId,
    ...(totalCount !== null ? { count: String(totalCount) } : {}),
    ...(clubSlug ? { club_slug: clubSlug } : {}),
    ...(input.startDate ? { start_date: input.startDate } : {}),
  });
  const redirectUri = `${origin}/api/gocardless/confirm?${confirmParams.toString()}`;
  const exitUri = `${origin}/#/payment-cancelled`;

  const flowRes = await fetch(`${gcBase}/billing_request_flows`, {
    method: 'POST',
    headers: gcHeaders,
    body: JSON.stringify({
      billing_request_flows: {
        redirect_uri: redirectUri,
        exit_uri: exitUri,
        links: { billing_request: br.id },
      },
    }),
  });

  if (!flowRes.ok) {
    const detail = await flowRes.text();
    return { ok: false, status: 502, error: 'Failed to create billing request flow', detail };
  }

  const { billing_request_flows: flow } = await flowRes.json<{
    billing_request_flows: GCBillingRequestFlow;
  }>();

  return {
    ok: true,
    authorisationUrl: flow.authorisation_url,
    reference,
    billingRequestId: br.id,
  };
}

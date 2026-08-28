import type { Env, GCMandate } from '../api/gocardless/_types';
import { resolveSubscriptionStartDate, clampStartDateToMandate } from './gocardless-link';

export function gcApiBase(env: Pick<Env, 'GC_ENVIRONMENT'>): string {
  return env.GC_ENVIRONMENT === 'live'
    ? 'https://api.gocardless.com'
    : 'https://api-sandbox.gocardless.com';
}

export function gcApiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'GoCardless-Version': '2015-07-06',
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * GET /mandates/{id}.
 *
 * Returns null on any transport error or non-2xx response, and never throws.
 * That is load-bearing: confirm.ts has no try/catch around the subscription
 * flow, so an unhandled rejection here would turn the payer's redirect into a
 * 500 rather than degrading to the existing mandate_only recovery path.
 */
export async function fetchMandate(
  gcBase: string,
  gcHeaders: Record<string, string>,
  mandateId: string,
): Promise<GCMandate | null> {
  try {
    const res = await fetch(`${gcBase}/mandates/${mandateId}`, { headers: gcHeaders });
    if (!res.ok) {
      console.error('Mandate lookup failed', {
        mandateId,
        status: res.status,
        body: await res.text(),
      });
      return null;
    }
    const { mandates } = await res.json<{ mandates: GCMandate }>();
    return mandates ?? null;
  } catch (e) {
    console.error('Mandate lookup threw', { mandateId, error: e });
    return null;
  }
}

export interface StartDateResolution {
  /** Value to send as subscriptions.start_date, or null to omit the field. */
  startDate: string | null;
  /** True when next_possible_charge_date pushed the date later than configured. */
  clamped: boolean;
  /** What resolveSubscriptionStartDate produced before clamping. */
  resolved: string | null;
  nextPossibleChargeDate: string | null;
  /** True when the mandate lookup failed and we proceeded without clamping. */
  lookupFailed: boolean;
}

/**
 * Resolve the subscription start_date for a specific mandate — the single entry
 * point shared by the confirm redirect flow and the admin retry.
 *
 * On a failed mandate lookup we proceed with the unclamped date. That is exactly
 * the behaviour that existed before clamping, so the change can only turn
 * GoCardless 422s into successes, never the reverse. The alternatives are worse:
 * omitting start_date would start collecting immediately from a payer who agreed
 * to a later date, and aborting would strand an already-created mandate with no
 * payment row at all.
 *
 * Note: next_possible_charge_date is expressed in the creditor's local timezone
 * while resolveSubscriptionStartDate works in UTC. Because the clamp is a max,
 * that skew can only ever push the date later, never earlier, so it needs no
 * correction.
 */
export async function resolveStartDateForMandate(args: {
  configuredStartDate: string | null | undefined;
  mandateId: string;
  gcBase: string;
  gcHeaders: Record<string, string>;
  today?: Date;
}): Promise<StartDateResolution> {
  const resolved = resolveSubscriptionStartDate(args.configuredStartDate, args.today);

  // No configured date → we omit start_date and let GoCardless choose the
  // earliest valid one. Short-circuit so this path costs no extra API call.
  if (!resolved) {
    return {
      startDate: null,
      clamped: false,
      resolved: null,
      nextPossibleChargeDate: null,
      lookupFailed: false,
    };
  }

  const mandate = await fetchMandate(args.gcBase, args.gcHeaders, args.mandateId);
  if (!mandate) {
    return {
      startDate: resolved,
      clamped: false,
      resolved,
      nextPossibleChargeDate: null,
      lookupFailed: true,
    };
  }

  const nextPossibleChargeDate = mandate.next_possible_charge_date ?? null;
  const startDate = clampStartDateToMandate(resolved, nextPossibleChargeDate);

  return {
    startDate,
    clamped: startDate !== resolved,
    resolved,
    nextPossibleChargeDate,
    lookupFailed: false,
  };
}

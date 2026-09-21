import { getSubscriptionStatus, type SubscriptionStatusSource } from './subscriptionStatus';

/** Structural, so the page's own row type satisfies it. */
export interface SummaryRow extends SubscriptionStatusSource {
  registrationId: string;
  fanId: string;
  subscriptionLevelId?: string | null;
  overrideLevelId?: string | null;
  /**
   * The registration this one is billed through. Absent or empty means the row
   * is its own billing unit, so rows from before merging existed count as one
   * each without any change to the caller.
   */
  billingRegistrationId?: string | null;
}

export interface RegistrationSummary {
  registrations: number;
  players: number;
  billableUnits: number;
  paying: number;
  outstanding: number;
  noLevel: number;
}

/** `subscriptionLevelId` already absorbs an override; the fallback is belt and braces. */
function hasLevel(row: SummaryRow): boolean {
  return Boolean(row.subscriptionLevelId ?? row.overrideLevelId);
}

/** The billing unit a row belongs to; its own id when it is not merged. */
function billingIdOf(row: SummaryRow): string {
  return row.billingRegistrationId || row.registrationId;
}

/**
 * Counts over a set of rows, normally the filtered ones.
 *
 * Three different denominators, and the gaps between them are the point:
 *
 * - `registrations` counts rows — what the FA thinks it has.
 * - `players` counts people. It differs for a multi-team player.
 * - `billableUnits` counts things to charge for. It differs again once an admin
 *   has merged registrations: a U15 playing two days is two registrations, one
 *   player, one billable unit.
 *
 * The money counts are per billing unit, not per row. Counting a merged group of
 * three as three outstanding is what made the reports wrong in the first place —
 * one payment was owed, not three. A group is counted once, against its primary,
 * whose level prices it and whose payment settles it.
 *
 * `outstanding` and `noLevel` partition the billing units; `paying` cuts across
 * both, so the money counts are not meant to sum to `registrations`.
 */
export function summariseRegistrations(rows: readonly SummaryRow[]): RegistrationSummary {
  // A group is represented by its primary when the primary is in view. When a
  // filter has hidden it, the first member seen stands in — the alternative is
  // dropping the group from the counts entirely.
  const unitRows = new Map<string, SummaryRow>();
  for (const row of rows) {
    const billingId = billingIdOf(row);
    const existing = unitRows.get(billingId);
    if (!existing || row.registrationId === billingId) unitRows.set(billingId, row);
  }

  const summary: RegistrationSummary = {
    registrations: rows.length,
    players: new Set(rows.map(r => r.fanId)).size,
    billableUnits: unitRows.size,
    paying: 0,
    outstanding: 0,
    noLevel: 0,
  };

  for (const row of unitRows.values()) {
    const { status } = getSubscriptionStatus(row);
    const isPaying = status === 'paid' || status === 'paying';

    if (isPaying) summary.paying++;

    // A mandate that is only set up has collected nothing yet.
    if (!hasLevel(row)) summary.noLevel++;
    else if (!isPaying) summary.outstanding++;
  }

  return summary;
}

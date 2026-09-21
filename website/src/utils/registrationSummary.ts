import { getSubscriptionStatus, type SubscriptionStatusSource } from './subscriptionStatus';

/** Structural, so the page's own row type satisfies it. */
export interface SummaryRow extends SubscriptionStatusSource {
  registrationId: string;
  fanId: string;
  subscriptionLevelId?: string | null;
  overrideLevelId?: string | null;
  /** Billed through this registration; absent means the row is its own unit. */
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
 * Counts over a set of rows, normally the filtered ones. Three denominators, and
 * the gaps between them are the point: `registrations` counts rows, `players`
 * counts people, `billableUnits` counts things to charge for.
 *
 * The money counts are per billing unit, against the primary — counting a merged
 * group of three as three outstanding is what made the reports overstate what
 * the club was owed. `outstanding` and `noLevel` partition the units; `paying`
 * cuts across both, so they do not sum to `registrations`.
 */
export function summariseRegistrations(rows: readonly SummaryRow[]): RegistrationSummary {
  // The primary represents its group; if a filter hid it, the first member seen
  // stands in, since dropping the group entirely would understate what is owed.
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

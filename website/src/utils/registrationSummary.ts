import { getSubscriptionStatus, type SubscriptionStatusSource } from './subscriptionStatus';

/** Structural, so the page's own row type satisfies it. */
export interface SummaryRow extends SubscriptionStatusSource {
  fanId: string;
  subscriptionLevelId?: string | null;
  overrideLevelId?: string | null;
}

export interface RegistrationSummary {
  registrations: number;
  players: number;
  paying: number;
  outstanding: number;
  noLevel: number;
}

/** `subscriptionLevelId` already absorbs an override; the fallback is belt and braces. */
function hasLevel(row: SummaryRow): boolean {
  return Boolean(row.subscriptionLevelId ?? row.overrideLevelId);
}

/**
 * Counts over a set of rows, normally the filtered ones. Registrations and
 * players differ for a multi-team player — that gap is the point.
 *
 * `outstanding` and `noLevel` partition the rows; `paying` cuts across both, so
 * the money counts are not meant to sum to `registrations`.
 */
export function summariseRegistrations(rows: readonly SummaryRow[]): RegistrationSummary {
  const summary: RegistrationSummary = {
    registrations: rows.length,
    players: new Set(rows.map(r => r.fanId)).size,
    paying: 0,
    outstanding: 0,
    noLevel: 0,
  };

  for (const row of rows) {
    const { status } = getSubscriptionStatus(row);
    const isPaying = status === 'paid' || status === 'paying';

    if (isPaying) summary.paying++;

    // A mandate that is only set up has collected nothing yet.
    if (!hasLevel(row)) summary.noLevel++;
    else if (!isPaying) summary.outstanding++;
  }

  return summary;
}

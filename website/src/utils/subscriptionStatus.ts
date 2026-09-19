export type SubStatus = 'paid' | 'paying' | 'setup' | 'outstanding' | 'cancelled';

export interface SubStatusInfo {
  status: SubStatus;
  label: string;
  color: string;
}

/** Optional as well as nullable: an absent status falls through to `outstanding`. */
export interface SubscriptionStatusSource {
  paymentStatus?: string | null;
}

/**
 * `row.paymentStatus` is the token /api/my-registrations collapses a
 * registration's payment rows into; the canonical list of the underlying
 * database statuses lives in functions/lib/payment-status.ts.
 *
 * Green means the season is paid for and nothing more is owed. Blue means a
 * Direct Debit is collecting without error, which is the state a treasurer
 * needs to tell apart from a finished one.
 */
export function getSubscriptionStatus(row: SubscriptionStatusSource): SubStatusInfo {
  switch (row.paymentStatus) {
    case 'completed':
    // A manual admin override is a paid player — identical badge, so filtering,
    // sorting and the export all treat them the same. Only the admin table adds
    // a marker showing who overrode it.
    case 'manual':
      return { status: 'paid', label: 'Paid in full', color: 'green' };
    case 'active':
      return { status: 'paying', label: 'Paying', color: 'blue' };
    case 'pending':
      return { status: 'setup', label: 'Mandate set up', color: 'cyan' };
    case 'inactive':
      return { status: 'cancelled', label: 'Cancelled', color: 'red' };
    default:
      return { status: 'outstanding', label: 'Outstanding', color: 'orange' };
  }
}

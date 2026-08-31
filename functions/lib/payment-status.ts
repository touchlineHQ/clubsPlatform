/**
 * The vocabulary of "player_payment"."status". The column is bare TEXT with no
 * CHECK constraint, so this module is the only place the set is written down —
 * keep it in step with anything that reads the column.
 *
 * - active        a GoCardless subscription is collecting, no error
 * - completed     every payment of a count-limited plan was collected: paid in
 *                 full for the season
 * - manual        an admin recorded payment made outside GoCardless
 * - mandate_only  the mandate exists but subscription creation failed
 * - inactive      cancelled, expired, or deactivated by an admin
 *
 * The frontend keeps its own copies of these literals: website/src is compiled
 * from its own tsconfig and imports nothing from functions/, and the two pages
 * consume different vocabularies anyway (PaymentRecordsTab shows the raw
 * status, RegistrationsPage the token my-registrations collapses it to).
 */
export type PlayerPaymentStatus =
  | 'active'
  | 'completed'
  | 'manual'
  | 'mandate_only'
  | 'inactive';

/**
 * Statuses meaning the player has paid for the season in full. Terminal and
 * sticky: a later GoCardless event must never downgrade one of these. A mandate
 * going cancelled/expired/consumed after the last collection is the normal end
 * of a count-limited plan, not someone dropping out — and treating it as one is
 * what badged paid-up players "Cancelled" and re-offered them the mandate flow.
 */
export const PAID_IN_FULL_STATUSES = ['completed', 'manual'] as const;

/**
 * Statuses meaning money is still expected through GoCardless. 'mandate_only'
 * belongs here — the mandate exists and an admin can still retry creating the
 * subscription against it — but not in SETTLED_STATUSES, because nothing has
 * been collected yet and the player does need to complete the flow.
 */
export const LIVE_GC_STATUSES = ['active', 'mandate_only'] as const;

/**
 * Statuses meaning the player is sorted for the season, so never send them
 * into the mandate flow again.
 */
export const SETTLED_STATUSES = ['active', ...PAID_IN_FULL_STATUSES] as const;

/**
 * Statuses that make an admin's manual override wrong: a live GoCardless
 * payment would end up with two records, and a completed plan is already paid.
 */
export const GC_BLOCKING_STATUSES = [...LIVE_GC_STATUSES, 'completed'] as const;

/**
 * WHERE fragment guarding an UPDATE against downgrading a terminal row. Built
 * from literals only, so it is safe to interpolate into SQL.
 *
 * 'inactive' is deliberately absent: GoCardless does not guarantee event
 * ordering, so a mandates.consumed that lands before subscriptions.finished
 * leaves the row inactive, and it must still be able to reach 'completed'.
 */
export const NOT_PAID_IN_FULL_SQL = `status NOT IN (${PAID_IN_FULL_STATUSES.map(
  (s) => `'${s}'`,
).join(', ')})`;

/** Maps a GoCardless subscription status onto the row status it implies. */
export function subscriptionStatusToPaymentStatus(
  gcStatus: string,
): 'completed' | 'active' {
  // 'finished' means the plan collected every payment it was created with.
  return gcStatus === 'finished' ? 'completed' : 'active';
}

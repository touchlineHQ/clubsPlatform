/**
 * The two forms of a payment reference, kept side by side deliberately.
 *
 * The *logical* reference identifies the payment plan (`EASTLEAKE-1234-SUBS`)
 * and is what goes into GoCardless subscription metadata. The *DB* reference
 * appends the last 8 characters of the billing request id so each payment
 * attempt gets its own player_payment row:
 *
 *   logical: EASTLEAKE-1234-SUBS
 *   db:      EASTLEAKE-1234-SUBS-a1b2c3d4
 *
 * The admin retry handler once assumed these were interchangeable and compared
 * one against the other, a test that could never pass. Changing one format
 * without the other is what breaks that comparison, so they live together.
 */

const SUFFIX_LEN = 8;

/**
 * Build the logical reference identifying a payment plan.
 *
 * `teamName` is always the *billing* registration's — a merged group's primary —
 * so the reference stays stable for the life of the group. confirm.ts matches an
 * existing subscription on it, and one that moved would collect twice.
 */
export function buildLogicalReference(
  teamName: string,
  fanId: string,
  paymentType: string,
): string {
  return `${teamName.replace(/\s+/g, '').toUpperCase()}-${fanId}-${paymentType}`;
}

/** The type trailing a reference (`EASTLEAKE-1234-SUBS` → `SUBS`); `SUBS` when malformed. */
export function paymentTypeFromReference(reference: string): string {
  const tail = reference.split('-').pop()?.trim();
  return tail ? tail.toUpperCase() : 'SUBS';
}

/** Build the player_payment.reference stored against a payment attempt. */
export function buildDbReference(reference: string, billingRequestId: string): string {
  return `${reference}-${billingRequestId.slice(-SUFFIX_LEN)}`;
}

/**
 * Best-effort inverse of buildDbReference. Logical references contain internal
 * hyphens, so this strips by shape and can over-strip one whose final segment
 * is itself 8 alphanumerics. Callers must match against both this and the
 * original string; since the result is only ever compared for exact equality,
 * a bad strip fails to match rather than matching the wrong thing.
 */
export function stripReferenceSuffix(dbReference: string): string {
  return dbReference.replace(/-[0-9A-Za-z]{8}$/, '');
}

/**
 * Ownership of the `player_payment.reference` format.
 *
 * A *logical* reference identifies the payment plan (`TEAMNAME-1234-SUBS`) and is
 * what we write into GoCardless subscription metadata. The *DB* reference appends
 * the last 8 characters of the billing request id so that each distinct payment
 * attempt gets its own row rather than overwriting the previous one:
 *
 *   logical: EASTLEAKE-1234-SUBS
 *   db:      EASTLEAKE-1234-SUBS-a1b2c3d4
 *
 * The two forms were previously built inline in confirm.ts and assumed
 * interchangeable in the admin retry handler, which is how the retry's
 * "subscription already exists" check ended up comparing a DB reference against
 * GoCardless metadata holding a logical one — a comparison that can never match.
 */

/** Characters of the billing request id appended to form the DB reference. */
const SUFFIX_LEN = 8;

/**
 * SQL LIKE fragment matching the suffix, for use as:
 *   `reference LIKE ? || REFERENCE_SUFFIX_LIKE`
 * Kept beside SUFFIX_LEN so the two can't drift.
 */
export const REFERENCE_SUFFIX_LIKE = '-________';

/** Build the `player_payment.reference` stored against a payment attempt. */
export function buildDbReference(reference: string, billingRequestId: string): string {
  return `${reference}-${billingRequestId.slice(-SUFFIX_LEN)}`;
}

/**
 * Best-effort inverse of buildDbReference.
 *
 * Logical references contain internal hyphens, so this can only strip by shape:
 * a logical reference whose own final segment happens to be 8 alphanumerics
 * would be over-stripped. Callers must therefore treat the result as a
 * *candidate* and match against both this and the original string. Because the
 * result is only ever used in exact-equality comparisons, an incorrect strip
 * simply fails to match — it can never produce a false positive. Never use it to
 * build a DB key.
 */
export function stripReferenceSuffix(dbReference: string): string {
  return dbReference.replace(/-[0-9A-Za-z]{8}$/, '');
}

/**
 * The one place a GoCardless metadata object is built.
 *
 * GoCardless caps resource metadata at THREE key-value pairs (keys ≤50 chars,
 * values ≤500). Exceed it and the POST comes back 422 — which, for a billing
 * request, means the payer never reaches the hosted mandate page at all.
 *
 * That has now shipped twice. 813ded0 cut the billing request back from 5 keys
 * to 3 with a commit message spelling the cap out; bfb4be9 then added a 4th
 * (payment_type) and 280f698 a 5th (registration_generation), killing every
 * public payment link for two days. Both times the keys were added to a bare
 * object literal, and nothing failed until a fan hit the error page.
 *
 * So the cap lives in a type: `gcMetadata` takes at most three pairs, and a
 * fourth is an arity error under `npm run typecheck`, which CI gates deploy on.
 * Adding a key means repacking or dropping one — never widening this signature.
 */

export const GC_METADATA_MAX_KEYS = 3;

/** A single metadata entry. An empty, null or undefined value is dropped. */
export type GCMetadataPair = readonly [key: string, value: string | number | null | undefined];

const MAX_KEY_LENGTH = 50;
const MAX_VALUE_LENGTH = 500;

export function gcMetadata(
  ...pairs:
    | readonly []
    | readonly [GCMetadataPair]
    | readonly [GCMetadataPair, GCMetadataPair]
    | readonly [GCMetadataPair, GCMetadataPair, GCMetadataPair]
): Record<string, string> {
  // Unreachable through the signature above. It is here so that widening the
  // signature fails loudly in the unit tests rather than quietly in production.
  if (pairs.length > GC_METADATA_MAX_KEYS) {
    throw new RangeError(
      `GoCardless allows at most ${GC_METADATA_MAX_KEYS} metadata properties; ${pairs.length} were supplied`,
    );
  }

  const metadata: Record<string, string> = {};

  for (const [key, value] of pairs) {
    if (value === null || value === undefined || value === '') continue;
    if (key.length > MAX_KEY_LENGTH) {
      throw new RangeError(`GoCardless metadata key "${key}" exceeds ${MAX_KEY_LENGTH} characters`);
    }
    // Truncate rather than throw: a long value is a cosmetic problem, and a
    // payer being turned away at the mandate page is not.
    metadata[key] = String(value).slice(0, MAX_VALUE_LENGTH);
  }

  return metadata;
}

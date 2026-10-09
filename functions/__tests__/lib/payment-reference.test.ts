import { describe, it, expect } from 'vitest';
import {
  buildLogicalReference,
  paymentTypeFromReference,
  buildDbReference,
  stripReferenceSuffix,
} from '../../lib/payment-reference';
import { PAYMENT_TYPES } from '../../../website/src/pages/admin-payments/types';

// The billing request has room for three metadata keys and payment_type is not
// one of them, so confirm.ts recovers the type from the reference instead.
// These tests are what make that safe.
describe('payment type round trip', () => {
  const types = PAYMENT_TYPES.map(t => t.value);

  it.each(types)('recovers %s from the reference it was built into', (type) => {
    expect(paymentTypeFromReference(buildLogicalReference('U11 A', 'FAN001', type))).toBe(type);
  });

  it('is unaffected by a hyphen in the team name', () => {
    // Only the last segment is read, so hyphens earlier in the reference are
    // harmless. A hyphen in the *type* is not, which is why
    // createGoCardlessLink rejects one.
    const reference = buildLogicalReference('U11-A Blue', 'FAN001', 'SUBS');
    expect(paymentTypeFromReference(reference)).toBe('SUBS');
  });

  it('falls back to SUBS for a reference with no type segment', () => {
    expect(paymentTypeFromReference('')).toBe('SUBS');
  });

  it('keeps every admin-selectable payment type parseable', () => {
    // Mirrors the pattern createGoCardlessLink enforces. Adding a hyphenated or
    // lowercase type to the admin dropdown would mint references whose rebuilt
    // form differs from the minted one — the subscription match would miss and
    // the player would be collected from twice. Fail here, not in production.
    for (const { value } of PAYMENT_TYPES) {
      expect(value).toMatch(/^[A-Z0-9]{1,20}$/);
    }
  });
});

describe('db reference', () => {
  it('round trips through the billing request suffix', () => {
    const logical = buildLogicalReference('U11 A', 'FAN001', 'SUBS');
    const db = buildDbReference(logical, 'BRQ0000012345678');
    expect(db).toBe('U11A-FAN001-SUBS-12345678');
    expect(stripReferenceSuffix(db)).toBe(logical);
  });
});

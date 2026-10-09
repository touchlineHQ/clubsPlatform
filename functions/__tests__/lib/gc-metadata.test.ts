import { describe, it, expect } from 'vitest';
import { gcMetadata, GC_METADATA_MAX_KEYS, type GCMetadataPair } from '../../lib/gc-metadata';

describe('gcMetadata', () => {
  it('builds a plain object from the pairs it is given', () => {
    expect(gcMetadata(['reference', 'U11S-FAN001-SUBS'], ['registration_id', 'reg_1'])).toEqual({
      reference: 'U11S-FAN001-SUBS',
      registration_id: 'reg_1',
    });
  });

  it('drops pairs with no value rather than sending an empty string', () => {
    // A key spent on an empty value is a third of the budget wasted.
    expect(gcMetadata(['a', null], ['b', undefined], ['c', ''])).toEqual({});
  });

  it('coerces a number to the string GoCardless expects', () => {
    expect(gcMetadata(['registration_generation', 3])).toEqual({ registration_generation: '3' });
    expect(gcMetadata(['registration_generation', 0])).toEqual({ registration_generation: '0' });
  });

  it('truncates an over-long value instead of letting GoCardless reject it', () => {
    const result = gcMetadata(['tracking', 'x'.repeat(600)]);
    expect(result.tracking).toHaveLength(500);
  });

  it('throws for a key over the 50-character limit', () => {
    expect(() => gcMetadata([`${'k'.repeat(51)}`, 'v'])).toThrow(/50 characters/);
  });

  it('throws if the arity guard is ever widened past three pairs', () => {
    // The signature already makes this a compile error, and functions/tsconfig
    // excludes __tests__ so a @ts-expect-error here would prove nothing. The
    // cast reaches the one case types cannot cover: someone widening gcMetadata
    // itself. That must fail here rather than 422 in front of a paying fan.
    const widened = gcMetadata as unknown as (...pairs: GCMetadataPair[]) => unknown;
    expect(() => widened(['a', '1'], ['b', '2'], ['c', '3'], ['d', '4'])).toThrow(RangeError);
  });

  it('pins the documented GoCardless cap', () => {
    expect(GC_METADATA_MAX_KEYS).toBe(3);
  });
});

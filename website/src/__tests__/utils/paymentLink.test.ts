import { describe, it, expect } from 'vitest';
import { buildPaymentLink } from '../../utils/paymentLink';

describe('buildPaymentLink', () => {
  it('joins the origin, club slug and FAN ID', () => {
    expect(buildPaymentLink('https://example.com', 'east-leake', 'FAN001'))
      .toBe('https://example.com/east-leake/payments/SUBS/FAN001');
  });

  it('URI-encodes the FAN ID', () => {
    expect(buildPaymentLink('https://example.com', 'east-leake', 'FAN 001/A'))
      .toBe('https://example.com/east-leake/payments/SUBS/FAN%20001%2FA');
  });

  it('still produces a relative path when there is no origin', () => {
    expect(buildPaymentLink('', 'east-leake', 'FAN001'))
      .toBe('/east-leake/payments/SUBS/FAN001');
  });
});

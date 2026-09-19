import { describe, it, expect } from 'vitest';
import { getSubscriptionStatus } from '../../utils/subscriptionStatus';

describe('getSubscriptionStatus', () => {
  it.each([
    ['completed', 'paid', 'Paid in full', 'green'],
    ['manual', 'paid', 'Paid in full', 'green'],
    ['active', 'paying', 'Paying', 'blue'],
    ['pending', 'setup', 'Mandate set up', 'cyan'],
    ['inactive', 'cancelled', 'Cancelled', 'red'],
  ])('maps %s to %s', (paymentStatus, status, label, color) => {
    expect(getSubscriptionStatus({ paymentStatus })).toEqual({ status, label, color });
  });

  it.each([[null], [undefined], ['refunded']])(
    'treats %s as outstanding — an unrecognised token must not read as paid',
    (paymentStatus) => {
      expect(getSubscriptionStatus({ paymentStatus })).toEqual({
        status: 'outstanding',
        label: 'Outstanding',
        color: 'orange',
      });
    },
  );

  it('gives a manual override the same badge as a completed plan', () => {
    // Filtering, sorting and the export all lean on these being identical.
    expect(getSubscriptionStatus({ paymentStatus: 'manual' }))
      .toEqual(getSubscriptionStatus({ paymentStatus: 'completed' }));
  });
});

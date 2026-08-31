import { describe, it, expect } from 'vitest';
import {
  PAID_IN_FULL_STATUSES,
  LIVE_GC_STATUSES,
  SETTLED_STATUSES,
  GC_BLOCKING_STATUSES,
  NOT_PAID_IN_FULL_SQL,
  subscriptionStatusToPaymentStatus,
} from '../../lib/payment-status';

describe('subscriptionStatusToPaymentStatus', () => {
  it('maps a finished plan to completed — every payment was collected', () => {
    expect(subscriptionStatusToPaymentStatus('finished')).toBe('completed');
  });

  it.each(['active', 'pending_customer_approval', 'paused', ''])(
    'maps %s to active',
    (gcStatus) => {
      expect(subscriptionStatusToPaymentStatus(gcStatus)).toBe('active');
    },
  );
});

describe('status sets', () => {
  it('treats a finished plan and an admin override as paid in full', () => {
    expect([...PAID_IN_FULL_STATUSES]).toEqual(['completed', 'manual']);
  });

  it('keeps mandate_only out of the settled set, so those players can retry', () => {
    expect([...LIVE_GC_STATUSES]).toContain('mandate_only');
    expect([...SETTLED_STATUSES]).not.toContain('mandate_only');
    expect([...SETTLED_STATUSES]).toEqual(['active', 'completed', 'manual']);
  });

  it('blocks a manual override on anything live or already paid through GC', () => {
    expect([...GC_BLOCKING_STATUSES]).toEqual(['active', 'mandate_only', 'completed']);
  });
});

describe('NOT_PAID_IN_FULL_SQL', () => {
  it('quotes every paid-in-full status as a SQL literal', () => {
    expect(NOT_PAID_IN_FULL_SQL).toBe(`status NOT IN ('completed', 'manual')`);
  });

  it('leaves inactive out — GoCardless does not order its events, so a row it ' +
     'flipped early must still be able to reach completed', () => {
    expect(NOT_PAID_IN_FULL_SQL).not.toContain('inactive');
  });
});

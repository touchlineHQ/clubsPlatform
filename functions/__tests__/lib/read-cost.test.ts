import { describe, it, expect, vi, beforeEach } from 'vitest';

const captureImmediate = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const getPostHog = vi.hoisted(() => vi.fn(() => ({ captureImmediate })));
vi.mock('../../lib/posthog', () => ({
  getPostHog,
  clubGroups: (slug?: string | null) => (slug ? { groups: { club: slug } } : {}),
}));

import {
  ROWS_READ_SAMPLE,
  SLOW_READ_MS,
  readMeta,
  reportReadCost,
  shouldSample,
} from '../../lib/read-cost';

/**
 * The sampler behind the registrations read telemetry.
 *
 * The thresholds are asserted rather than described because the whole point of
 * this module is that a healthy read costs nothing: a capture is CPU and a
 * subrequest, on endpoints measured against a 10ms CPU budget. A sampler that
 * quietly fired on everything would push the requests being diagnosed closer to
 * the limit they are being watched for.
 */

const ctx = () => ({ env: {}, waitUntil: vi.fn((p: Promise<unknown>) => p) });

describe('shouldSample', () => {
  it('ignores a read that is fast and small', () => {
    expect(shouldSample({ endpoint: 'x', ms: 10, rowsRead: 102 })).toBe(false);
  });

  it('samples a slow read even when it touched almost nothing', () => {
    // A slow read over few rows is a different problem — contention, a cold
    // isolate — and still worth seeing.
    expect(shouldSample({ endpoint: 'x', ms: SLOW_READ_MS, rowsRead: 1 })).toBe(true);
  });

  it('samples a read that touched a lot of rows even when it was fast', () => {
    // The club scan this work removed read 7,495 rows in 23ms. On duration
    // alone it would never have been recorded.
    expect(shouldSample({ endpoint: 'x', ms: 5, rowsRead: ROWS_READ_SAMPLE })).toBe(true);
  });

  it('treats a missing rows_read as zero rather than as a reason to fire', () => {
    // D1 does not always populate meta, and a driver that omits it must not
    // turn every read into a capture.
    expect(shouldSample({ endpoint: 'x', ms: 5 })).toBe(false);
  });

  it('holds a read with its own threshold to that threshold, not the global one', () => {
    // The merge-suggestions read groups the club by design and sits above
    // ROWS_READ_SAMPLE from its first request. Without a per-endpoint figure it
    // would capture on every call, which is not sampling.
    const sample = { endpoint: 'merge_suggestions', ms: 14, rowsReadSample: 5000 };

    expect(shouldSample({ ...sample, rowsRead: ROWS_READ_SAMPLE })).toBe(false);
    expect(shouldSample({ ...sample, rowsRead: 3238 })).toBe(false);
    expect(shouldSample({ ...sample, rowsRead: 5000 })).toBe(true);
  });

  it('still samples a read with its own threshold when it is slow', () => {
    // A raised rows figure must not buy silence on duration too.
    expect(
      shouldSample({ endpoint: 'merge_suggestions', ms: SLOW_READ_MS, rowsRead: 1, rowsReadSample: 5000 }),
    ).toBe(true);
  });

  it('falls back to the global threshold when a read names none', () => {
    expect(shouldSample({ endpoint: 'x', ms: 5, rowsRead: ROWS_READ_SAMPLE - 1 })).toBe(false);
    expect(shouldSample({ endpoint: 'x', ms: 5, rowsRead: ROWS_READ_SAMPLE })).toBe(true);
  });
});

describe('readMeta', () => {
  it('survives a result with no meta at all', () => {
    expect(readMeta(null)).toEqual({});
    expect(readMeta({})).toEqual({});
    expect(readMeta({ meta: { rows_read: 9 } })).toEqual({ rows_read: 9 });
  });
});

describe('reportReadCost', () => {
  beforeEach(() => {
    captureImmediate.mockClear();
    getPostHog.mockClear();
    getPostHog.mockReturnValue({ captureImmediate });
  });

  it('sends nothing for a healthy read', () => {
    reportReadCost(ctx() as never, 'user_1', 'club', { endpoint: 'registrations_page', ms: 3 });
    expect(captureImmediate).not.toHaveBeenCalled();
    // Not even a client: constructing one is work a healthy request should not do.
    expect(getPostHog).not.toHaveBeenCalled();
  });

  it('reports counts and durations, grouped by club, and never an identifier', () => {
    const context = ctx();
    reportReadCost(context as never, 'user_1', 'east-leake-fc', {
      endpoint: 'registrations_summary',
      ms: 400,
      rowsRead: 7495,
      rowsReturned: 1,
      extra: { filtered: true },
    });

    expect(context.waitUntil).toHaveBeenCalled();
    const [payload] = captureImmediate.mock.calls[0] as unknown as [Record<string, never>];
    expect(payload).toMatchObject({
      distinctId: 'user_1',
      event: 'registrations read',
      groups: { club: 'east-leake-fc' },
      properties: {
        club_slug: 'east-leake-fc',
        endpoint: 'registrations_summary',
        total_ms: 400,
        rows_read: 7495,
        rows_returned: 1,
        filtered: true,
      },
    });
    // #94's constraint, asserted rather than trusted: nothing about a person.
    expect(JSON.stringify(payload)).not.toMatch(/fanId|FAN|email|teamName/i);
  });

  it('omits row counts it was not given rather than sending zeroes', () => {
    // A zero would read as "this read touched nothing", which is a claim.
    reportReadCost(ctx() as never, 'user_1', 'club', { endpoint: 'x', ms: 900 });
    const [payload] = captureImmediate.mock.calls[0] as unknown as [{ properties: object }];
    expect(payload.properties).not.toHaveProperty('rows_read');
    expect(payload.properties).not.toHaveProperty('rows_returned');
  });

  it('stays silent when PostHog is not configured', () => {
    getPostHog.mockReturnValue(null as never);
    const context = ctx();
    reportReadCost(context as never, 'user_1', 'club', { endpoint: 'x', ms: 900 });
    expect(context.waitUntil).not.toHaveBeenCalled();
  });

  it('never lets a failed capture reach the caller', () => {
    // Telemetry must not turn a working read into a failed request.
    captureImmediate.mockReturnValueOnce(Promise.reject(new Error('posthog down')));
    const context = ctx();
    expect(() =>
      reportReadCost(context as never, 'user_1', 'club', { endpoint: 'x', ms: 900 }),
    ).not.toThrow();
    return expect(context.waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { isTransientD1Error, retryTransientD1 } from '../../lib/d1-retry';

const noSleep = { sleep: vi.fn(async () => {}), random: () => 0 };

describe('isTransientD1Error (#251)', () => {
  it('matches the error PostHog reported', () => {
    expect(isTransientD1Error(new Error('D1_ERROR: Network connection lost.'))).toBe(true);
  });

  it.each([
    'D1_ERROR: Replica disconnected from primary.',
    'D1_ERROR: Internal error in D1 DB storage caused object to be reset.',
    'D1_ERROR: D1 DB reset because its code was updated.',
    'D1_ERROR: Cannot resolve D1 DB due to transient issue on remote node.',
    'D1_ERROR: Internal error while starting up D1 DB storage caused object to be reset.',
  ])('matches Cloudflare retryable error: %s', (msg) => {
    expect(isTransientD1Error(new Error(msg))).toBe(true);
  });

  it('looks at the cause too', () => {
    expect(isTransientD1Error(new Error('D1_ERROR', { cause: new Error('Network connection lost.') }))).toBe(true);
  });

  it.each([
    'D1_ERROR: no such table: player',
    'D1_ERROR: D1 DB is overloaded. Too many requests queued.',
    'D1_ERROR: D1 DB exceeded its CPU time limit and was reset.',
    'D1_ERROR: UNIQUE constraint failed: user.email',
  ])('does not retry: %s', (msg) => {
    expect(isTransientD1Error(new Error(msg))).toBe(false);
  });

  it('handles non-Error values', () => {
    expect(isTransientD1Error('Network connection lost')).toBe(true);
    expect(isTransientD1Error(undefined)).toBe(false);
    expect(isTransientD1Error(null)).toBe(false);
  });
});

describe('retryTransientD1', () => {
  it('returns the first success without sleeping', async () => {
    const sleep = vi.fn(async () => {});
    await expect(retryTransientD1(async () => 42, { sleep })).resolves.toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure and returns the later success', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('D1_ERROR: Network connection lost.'))
      .mockResolvedValueOnce('ok');
    await expect(retryTransientD1(fn, noSleep)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt budget and rethrows the original error', async () => {
    const err = new Error('D1_ERROR: Network connection lost.');
    const fn = vi.fn(async () => { throw err; });
    await expect(retryTransientD1(fn, { ...noSleep, attempts: 3 })).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-transient errors', async () => {
    const fn = vi.fn(async () => { throw new Error('D1_ERROR: no such column: x'); });
    await expect(retryTransientD1(fn, noSleep)).rejects.toThrow('no such column');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially with bounded jitter', async () => {
    const sleep = vi.fn(async (_ms: number) => {});
    const fn = vi.fn(async () => { throw new Error('Network connection lost'); });
    await expect(retryTransientD1(fn, { sleep, random: () => 0.999, baseDelayMs: 100, attempts: 3 })).rejects.toThrow();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([150, 300]);
  });
});

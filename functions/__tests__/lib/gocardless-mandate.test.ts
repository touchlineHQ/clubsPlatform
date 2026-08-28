import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { gcApiBase, gcApiHeaders, fetchMandate, resolveStartDateForMandate } from '../../lib/gocardless-mandate';

const GC_BASE = 'https://api-sandbox.gocardless.com';
const HEADERS = gcApiHeaders('test-token');

function mandateResponse(next_possible_charge_date: string | null, status = 'pending_submission') {
  return new Response(
    JSON.stringify({ mandates: { id: 'MND-1', status, next_possible_charge_date } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('gcApiBase', () => {
  it('uses the live host only for the live environment', () => {
    expect(gcApiBase({ GC_ENVIRONMENT: 'live' } as never)).toBe('https://api.gocardless.com');
    expect(gcApiBase({ GC_ENVIRONMENT: 'sandbox' } as never)).toBe(GC_BASE);
    expect(gcApiBase({ GC_ENVIRONMENT: undefined } as never)).toBe(GC_BASE);
  });
});

describe('gcApiHeaders', () => {
  it('sets the bearer token and pinned API version', () => {
    expect(gcApiHeaders('tok')).toMatchObject({
      Authorization: 'Bearer tok',
      'GoCardless-Version': '2015-07-06',
    });
  });
});

describe('fetchMandate', () => {
  it('returns the mandate on success', async () => {
    mockFetch.mockResolvedValueOnce(mandateResponse('2024-09-04'));

    const mandate = await fetchMandate(GC_BASE, HEADERS, 'MND-1');

    expect(mandate).toMatchObject({ id: 'MND-1', next_possible_charge_date: '2024-09-04' });
    expect(mockFetch).toHaveBeenCalledWith(`${GC_BASE}/mandates/MND-1`, { headers: HEADERS });
  });

  it('returns null on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('boom', { status: 500 }));
    expect(await fetchMandate(GC_BASE, HEADERS, 'MND-1')).toBeNull();
  });

  it('returns null without throwing when the request itself fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await expect(fetchMandate(GC_BASE, HEADERS, 'MND-1')).resolves.toBeNull();
  });
});

describe('resolveStartDateForMandate', () => {
  const base = { mandateId: 'MND-1', gcBase: GC_BASE, gcHeaders: HEADERS };

  it('omits the start date and skips the mandate lookup when none is configured', async () => {
    const res = await resolveStartDateForMandate({ ...base, configuredStartDate: null });

    expect(res).toMatchObject({ startDate: null, clamped: false, lookupFailed: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clamps forward when the mandate cannot be charged until later', async () => {
    mockFetch.mockResolvedValueOnce(mandateResponse('2099-09-04'));

    const res = await resolveStartDateForMandate({ ...base, configuredStartDate: '2099-09-01' });

    expect(res).toMatchObject({
      startDate: '2099-09-04',
      resolved: '2099-09-01',
      nextPossibleChargeDate: '2099-09-04',
      clamped: true,
      lookupFailed: false,
    });
  });

  it('keeps the configured date when the mandate is chargeable earlier', async () => {
    mockFetch.mockResolvedValueOnce(mandateResponse('2099-08-01'));

    const res = await resolveStartDateForMandate({ ...base, configuredStartDate: '2099-09-01' });

    expect(res).toMatchObject({ startDate: '2099-09-01', clamped: false });
  });

  it('keeps the configured date when the mandate has no next_possible_charge_date', async () => {
    mockFetch.mockResolvedValueOnce(mandateResponse(null, 'cancelled'));

    const res = await resolveStartDateForMandate({ ...base, configuredStartDate: '2099-09-01' });

    expect(res).toMatchObject({ startDate: '2099-09-01', clamped: false, lookupFailed: false });
  });

  it('proceeds unclamped and flags the failure when the mandate lookup fails', async () => {
    mockFetch.mockResolvedValueOnce(new Response('nope', { status: 500 }));

    const res = await resolveStartDateForMandate({ ...base, configuredStartDate: '2099-09-01' });

    expect(res).toMatchObject({
      startDate: '2099-09-01',
      clamped: false,
      lookupFailed: true,
      nextPossibleChargeDate: null,
    });
  });

  it('clamps the past-date fallback too, which is otherwise only a day away', async () => {
    // Configured date has passed, so resolveSubscriptionStartDate falls back to
    // the first of next month — one calendar day out, and unchargeable.
    mockFetch.mockResolvedValueOnce(mandateResponse('2025-06-05'));

    const res = await resolveStartDateForMandate({
      ...base,
      configuredStartDate: '2025-05-01',
      today: new Date('2025-05-30T12:00:00Z'),
    });

    expect(res).toMatchObject({ resolved: '2025-06-01', startDate: '2025-06-05', clamped: true });
  });
});

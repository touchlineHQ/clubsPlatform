import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, managerSession, getReq, postReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/gocardless-link', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/gocardless-link')>();
  return {
    ...actual,
    createGoCardlessLink: vi.fn(async () => ({
      ok: true,
      authorisationUrl: 'https://gocardless.com/auth/123',
      reference: 'REF-1',
      billingRequestId: 'BRQ-1',
    })),
  };
});

vi.mock('../../lib/secrets', () => ({
  getSecret: vi.fn(async () => 'live-token'),
}));

import { onRequestPost } from '../../api/gocardless/create-link';
import { onRequestGet as confirmOnRequestGet } from '../../api/gocardless/confirm';
// The [clubSlug]/payments/[paymentType]/[fanId].ts handler uses bracket-named paths
import { onRequestGet as paymentRedirectOnRequestGet } from '../../[clubSlug]/payments/[paymentType]/[fanId]';
import {
  onRequestGet as fanEntryOnRequestGet,
  onRequestPost as fanEntryOnRequestPost,
} from '../../[clubSlug]/payments/index';
import { createGoCardlessLink } from '../../lib/gocardless-link';

const mockCreateGoCardlessLink = vi.mocked(createGoCardlessLink);

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default mock return value after clearAllMocks
  mockCreateGoCardlessLink.mockResolvedValue({
    ok: true,
    authorisationUrl: 'https://gocardless.com/auth/123',
    reference: 'REF-1',
    billingRequestId: 'BRQ-1',
  });
});

// ─── POST /api/gocardless/create-link ────────────────────────────────────────

describe('POST /api/gocardless/create-link', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const ctx = makeContext(
      postReq('/api/gocardless/create-link', {
        registrationId: 'reg_1',
        paymentType: 'SUBS',
        amountInPence: 5000,
      }, { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is a member (not manager or admin)', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user_1', name: 'Test', email: 'test@example.com', role: 'member', clubSlug: 'test-club' },
      session: { id: 'sess_1', userId: 'user_1', expiresAt: new Date(Date.now() + 86400_000) },
    });
    const ctx = makeContext(
      postReq('/api/gocardless/create-link', {
        registrationId: 'reg_1',
        paymentType: 'SUBS',
        amountInPence: 5000,
      }, { 'X-Club-Slug': 'test-club' }),
    );
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(403);
  });

  it('returns 200 with authorisation_url when manager calls create-link', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/gocardless/create-link', {
        registrationId: 'reg_1',
        paymentType: 'SUBS',
        amountInPence: 5000,
      }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.authorisation_url).toBe('https://gocardless.com/auth/123');
    expect(body.reference).toBe('REF-1');
    expect(body.billing_request_id).toBe('BRQ-1');
  });

  it('passes the correct fields to createGoCardlessLink', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/gocardless/create-link', {
        registrationId: 'reg_1',
        paymentType: 'SUBS',
        amountInPence: 5000,
      }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    await onRequestPost(ctx as any);
    expect(mockCreateGoCardlessLink).toHaveBeenCalledOnce();
    const callArg = mockCreateGoCardlessLink.mock.calls[0][0];
    expect(callArg.registrationId).toBe('reg_1');
    expect(callArg.paymentType).toBe('SUBS');
    expect(callArg.amountInPence).toBe(5000);
    expect(callArg.intervalUnit).toBe('monthly');
  });

  it('returns 400 for invalid JSON body', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    const req = new Request('https://example.com/api/gocardless/create-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Club-Slug': 'test-club' },
      body: 'not-json',
    });
    const ctx = makeContext(req);
    const res = await onRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });

  it('forwards error response from createGoCardlessLink', async () => {
    mockGetSession.mockResolvedValue(managerSession);
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'GoCardless API token not configured',
    });
    const db = makeDb();
    const ctx = makeContext(
      postReq('/api/gocardless/create-link', {
        registrationId: 'reg_1',
        paymentType: 'SUBS',
        amountInPence: 5000,
      }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
    const res = await onRequestPost(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(503);
    expect(body.error).toBeTruthy();
  });
});

// ─── GET /api/gocardless/confirm ─────────────────────────────────────────────

describe('GET /api/gocardless/confirm', () => {
  function makeConfirmUrl(params: Record<string, string> = {}): string {
    const defaults = {
      billing_request_id: 'BRQ-1',
      reference: 'REF-1',
      amount: '5000',
      interval_unit: 'monthly',
      description: 'Subs',
      registration_id: 'reg_1',
    };
    const merged = { ...defaults, ...params };
    const qs = new URLSearchParams(merged).toString();
    return `https://example.com/api/gocardless/confirm?${qs}`;
  }

  // Default pricing row returned by the DB pricing query in confirm.ts:
  // £100/year over 12 monthly payments → £10/month per payment.
  const defaultPricingRow = {
    clubSlug: 'test-club',
    yearlyPriceInPence: 12000,
    intervalCount: 12,
    intervalUnit: 'monthly' as const,
  };

  function makeFetchMock(overrides: {
    brStatus?: string;
    mandateId?: string;
    existingSubscriptions?: any[];
    newSubscription?: any;
    /** Metadata returned on the billing-request GET. Defaults bind to the URL defaults. */
    brMetadata?: Record<string, string>;
    /** Captures the body of the POST /subscriptions call for assertions. */
    capturedSubscriptionBody?: { value: any };
    /** Mandate returned by GET /mandates/{id}. */
    mandate?: Record<string, any>;
    /** Non-200 status for GET /mandates/{id}, to exercise the fail-soft path. */
    mandateStatus?: number;
  } = {}) {
    const {
      brStatus = 'fulfilled',
      mandateId = 'MND-1',
      existingSubscriptions = [],
      newSubscription = { id: 'SUB-1', status: 'active' },
      brMetadata = { registration_id: 'reg_1', reference: 'REF-1' },
      capturedSubscriptionBody,
      mandate,
      mandateStatus,
    } = overrides;

    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);

      // First call: GET billing request
      if (urlStr.includes('/billing_requests/BRQ-1') && (!init || !init.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            billing_requests: {
              id: 'BRQ-1',
              status: brStatus,
              metadata: brMetadata,
              links: { mandate_request_mandate: mandateId },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Fulfil action (only called if status !== 'fulfilled')
      if (urlStr.includes('/billing_requests/BRQ-1/actions/fulfil')) {
        return new Response(
          JSON.stringify({
            billing_requests: {
              id: 'BRQ-1',
              status: 'fulfilled',
              metadata: brMetadata,
              links: { mandate_request_mandate: mandateId },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Mandate lookup for start_date clamping. Must not intercept the
      // POST /mandates/{id}/actions/cancel call made by the duplicate-mandate path.
      if (
        urlStr.includes('/mandates/') &&
        !urlStr.includes('/actions/') &&
        (!init || !init.method || init.method === 'GET')
      ) {
        if (mandateStatus && mandateStatus !== 200) {
          return new Response('mandate error', { status: mandateStatus });
        }
        return new Response(
          JSON.stringify({
            mandates: {
              id: mandateId,
              status: 'pending_submission',
              next_possible_charge_date: null,
              ...mandate,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // List subscriptions for idempotency check
      if (urlStr.includes('/subscriptions?mandate=')) {
        return new Response(
          JSON.stringify({ subscriptions: existingSubscriptions }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Create subscription — capture body so price-tampering tests can assert on it
      if (urlStr.includes('/subscriptions') && init?.method === 'POST') {
        if (capturedSubscriptionBody && typeof init.body === 'string') {
          capturedSubscriptionBody.value = JSON.parse(init.body).subscriptions;
        }
        return new Response(
          JSON.stringify({ subscriptions: newSubscription }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });
  }

  it('redirects to payment-success after fulfilling a billing request and creating a subscription', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(
      new Request(makeConfirmUrl()),
      { env },
    );

    const res = await confirmOnRequestGet(ctx as any);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');

    vi.unstubAllGlobals();
  });

  it('redirects to payment-success when billing request is already fulfilled', async () => {
    const fetchMock = makeFetchMock({ brStatus: 'fulfilled' });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');

    vi.unstubAllGlobals();
  });

  it('reuses an existing active subscription with the same reference', async () => {
    const existingSub = {
      id: 'SUB-EXISTING',
      status: 'active',
      metadata: { reference: 'REF-1' },
      links: { mandate: 'MND-1' },
    };
    const fetchMock = makeFetchMock({ existingSubscriptions: [existingSub] });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');
    expect(location).toContain('existing=1');

    vi.unstubAllGlobals();
  });

  it('redirects to payment-cancelled when required params are missing', async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(
      new Request('https://example.com/api/gocardless/confirm?billing_request_id=BRQ-1'),
      { env },
    );

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('missing_params');
  });

  it('redirects to payment-cancelled when GC_ACCESS_TOKEN secret is missing', async () => {
    const { getSecret } = await import('../../lib/secrets');
    vi.mocked(getSecret).mockResolvedValueOnce(null);

    const db = makeDb();
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('token_missing');
  });

  // --- P0#3 regression: price-tampering -------------------------------------

  it('ignores tampered URL amount/interval/count and uses DB-derived pricing for the subscription', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    // DB says: £100/year over 12 monthly payments → £10 (1000p) per payment
    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });

    // Attacker tampers: tries to pay 1p once a year instead
    const tamperedUrl = makeConfirmUrl({
      amount: '1',
      interval_unit: 'yearly',
      count: '1',
    });
    const ctx = makeContext(new Request(tamperedUrl), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');

    // The GoCardless subscription was created with the DB-derived values,
    // not the URL-supplied ones.
    expect(captured.value).toBeDefined();
    expect(captured.value.amount).toBe(1000);
    expect(captured.value.interval_unit).toBe('monthly');
    expect(captured.value.count).toBe(12);

    vi.unstubAllGlobals();
  });

  it('rejects legacy links without registration_id in billing-request metadata', async () => {
    // Billing request created before PR 2's metadata stamping
    const fetchMock = makeFetchMock({ brMetadata: { reference: 'REF-1' } });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('legacy_link');

    vi.unstubAllGlobals();
  });

  it('redirects to payment-cancelled when the registration has no subscription level', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // No pricing for this registration in the DB
    const db = makeDb({ first: null });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('no_level');

    vi.unstubAllGlobals();
  });

  // --- start_date must respect the mandate's Bacs lead time -----------------

  it('clamps start_date forward to the mandate next_possible_charge_date', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({
      capturedSubscriptionBody: captured,
      mandate: { next_possible_charge_date: '2099-09-04' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({
      first: { ...defaultPricingRow, startDate: '2099-09-01' },
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');
    expect(captured.value.start_date).toBe('2099-09-04');

    vi.unstubAllGlobals();
  });

  it('keeps the configured start_date when the mandate is chargeable earlier', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({
      capturedSubscriptionBody: captured,
      mandate: { next_possible_charge_date: '2099-08-01' },
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({
      first: { ...defaultPricingRow, startDate: '2099-09-01' },
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    await confirmOnRequestGet(ctx as any);

    expect(captured.value.start_date).toBe('2099-09-01');

    vi.unstubAllGlobals();
  });

  it('still creates the subscription when the mandate lookup fails', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured, mandateStatus: 500 });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({
      first: { ...defaultPricingRow, startDate: '2099-09-01' },
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);

    // Fail-soft: proceed with the unclamped date rather than aborting the payer's flow.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');
    expect(captured.value.start_date).toBe('2099-09-01');

    vi.unstubAllGlobals();
  });

  it('skips the mandate lookup entirely when no start date is configured', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    await confirmOnRequestGet(ctx as any);

    expect(captured.value.start_date).toBeUndefined();
    const mandateGets = fetchMock.mock.calls.filter(([url]: any[]) =>
      String(url).includes('/mandates/'),
    );
    expect(mandateGets).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('caps the subscription at the configured number of payments', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: defaultPricingRow, run: { meta: { changes: 1 } } });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    await confirmOnRequestGet(ctx as any);

    expect(captured.value.count).toBe(12);

    vi.unstubAllGlobals();
  });

  it('forwards a future startDate as the GoCardless subscription start_date', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    // A start date far in the future so resolveSubscriptionStartDate keeps it.
    const futureDate = `${new Date().getUTCFullYear() + 5}-09-01`;
    const db = makeDb({
      first: { ...defaultPricingRow, startDate: futureDate },
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(captured.value.start_date).toBe(futureDate);

    vi.unstubAllGlobals();
  });

  it('cancels duplicate new mandate and reuses prior subscription when a prior payment row exists for a different mandate', async () => {
    const cancelCalls: string[] = [];
    const subscriptionPosts: number[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);
      if (urlStr.includes('/billing_requests/BRQ-1') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(JSON.stringify({
          billing_requests: {
            id: 'BRQ-1',
            status: 'fulfilled',
            metadata: { registration_id: 'reg_1', reference: 'REF-1' },
            // NEW mandate from second billing request
            links: { mandate_request_mandate: 'MND-NEW' },
          },
        }), { status: 200 });
      }
      if (urlStr.includes('/mandates/MND-NEW/actions/cancel')) {
        cancelCalls.push(urlStr);
        return new Response(JSON.stringify({ mandates: { id: 'MND-NEW', status: 'cancelled' } }), { status: 200 });
      }
      if (urlStr.includes('/subscriptions') && init?.method === 'POST') {
        subscriptionPosts.push(1);
        return new Response(JSON.stringify({ subscriptions: { id: 'SUB-SHOULD-NOT-BE-CREATED' } }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    // 1st .first() = pricing lookup; 2nd .first() = prior payment lookup
    const db = makeDb({
      first: [
        defaultPricingRow,
        { mandateId: 'MND-OLD', subscriptionId: 'SUB-OLD', status: 'active' },
      ],
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);

    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');
    expect(location).toContain('existing=1');
    expect(location).toContain('mandate=MND-OLD');
    expect(location).toContain('subscription=SUB-OLD');
    // The new mandate from the duplicate billing request was cancelled.
    expect(cancelCalls.length).toBe(1);
    // No new GC subscription was created.
    expect(subscriptionPosts.length).toBe(0);

    vi.unstubAllGlobals();
  });

  it('does NOT dedupe when the prior payment row uses the same mandate (replayed billing request)', async () => {
    const fetchMock = makeFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    // Prior payment matches the SAME mandate the new billing request resolves
    // to — confirm.ts should fall through to the GC-side per-mandate idempotency.
    const db = makeDb({
      first: [
        defaultPricingRow,
        { mandateId: 'MND-1', subscriptionId: 'SUB-OLD', status: 'active' },
      ],
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');

    vi.unstubAllGlobals();
  });

  it('does NOT dedupe when prior payment is mandate_only (no subscription yet) — falls through to retry', async () => {
    const subscriptionPosts: number[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);
      if (urlStr.includes('/billing_requests/BRQ-1') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(JSON.stringify({
          billing_requests: {
            id: 'BRQ-1',
            status: 'fulfilled',
            metadata: { registration_id: 'reg_1', reference: 'REF-1' },
            links: { mandate_request_mandate: 'MND-NEW' },
          },
        }), { status: 200 });
      }
      if (urlStr.includes('/subscriptions?mandate=')) {
        return new Response(JSON.stringify({ subscriptions: [] }), { status: 200 });
      }
      if (urlStr.includes('/subscriptions') && init?.method === 'POST') {
        subscriptionPosts.push(1);
        return new Response(JSON.stringify({ subscriptions: { id: 'SUB-NEW', status: 'active' } }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({
      first: [
        defaultPricingRow,
        { mandateId: 'MND-OLD', subscriptionId: null, status: 'mandate_only' },
      ],
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-success');
    // A new subscription IS created when no prior subscription exists.
    expect(subscriptionPosts.length).toBe(1);

    vi.unstubAllGlobals();
  });

  it('omits start_date when the subscription level has no configured startDate', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeFetchMock({ capturedSubscriptionBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({
      first: { ...defaultPricingRow, startDate: null },
      run: { meta: { changes: 1 } },
    });
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(new Request(makeConfirmUrl()), { env });

    await confirmOnRequestGet(ctx as any);
    expect(captured.value.start_date).toBeUndefined();

    vi.unstubAllGlobals();
  });
});

// ─── GET /[clubSlug]/payments/[paymentType]/[fanId] ──────────────────────────

describe('GET /[clubSlug]/payments/[paymentType]/[fanId]', () => {
  const sampleRegistration = {
    registrationId: 'reg_1',
    fanId: 'FAN001',
    teamName: 'U11s',
    levelId: 'level_1',
    yearlyPriceInPence: 12000,
    intervalCount: 12,
    intervalUnit: 'monthly' as const,
  };

  it('redirects to payment-cancelled when fanId is missing from params', async () => {
    const db = makeDb({ first: { slug: 'test-club' } });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: '' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('invalid_url');
  });

  it('redirects to payment-success without amount when active payment exists, regardless of registration pricing', async () => {
    const unpricedRegistration = {
      ...sampleRegistration,
      levelId: null,
      yearlyPriceInPence: null,
      intervalCount: null,
      intervalUnit: null,
    };
    const db = makeDb({
      first: [{ slug: 'test-club' }, { reference: 'REF-SUB-NOPRICE' }],
      all: [[unpricedRegistration]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');
    expect(location).toContain('existing=1');
    expect(location).not.toContain('amount=');
    expect(location).not.toContain('interval_unit=');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });

  it('redirects to GoCardless authorisation URL for a valid player', async () => {
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: true,
      authorisationUrl: 'https://gc.com/auth/1',
      reference: 'R1',
      billingRequestId: 'B1',
    });

    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://gc.com/auth/1');
  });

  it('calls createGoCardlessLink with correct amount derived from subscription level', async () => {
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: true,
      authorisationUrl: 'https://gc.com/auth/1',
      reference: 'R1',
      billingRequestId: 'B1',
    });

    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    await paymentRedirectOnRequestGet(ctx as any);

    expect(mockCreateGoCardlessLink).toHaveBeenCalledOnce();
    const callArg = mockCreateGoCardlessLink.mock.calls[0][0];
    // 12000p / 12 payments = 1000p per payment
    expect(callArg.amountInPence).toBe(1000);
    expect(callArg.registrationId).toBe('reg_1');
    expect(callArg.paymentType).toBe('SUBS');
    expect(callArg.intervalUnit).toBe('monthly');
    expect(callArg.count).toBe(12);
  });

  it('forwards startDate from the registration row into createGoCardlessLink', async () => {
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: true,
      authorisationUrl: 'https://gc.com/auth/1',
      reference: 'R1',
      billingRequestId: 'B1',
    });

    const regWithStartDate = { ...sampleRegistration, startDate: '2030-09-01' };
    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[regWithStartDate]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    await paymentRedirectOnRequestGet(ctx as any);

    const callArg = mockCreateGoCardlessLink.mock.calls[0][0];
    expect(callArg.startDate).toBe('2030-09-01');
  });

  it('redirects to payment-cancelled when club is not found', async () => {
    const db = makeDb({ first: null });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/unknown-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'unknown-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('unknown_club');
  });

  it('redirects to payment-cancelled when player is not found', async () => {
    const db = makeDb({ first: { slug: 'test-club' }, all: [[]] });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/UNKNOWN'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'UNKNOWN' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('player_not_found');
  });

  it('redirects to payment-cancelled when player has no subscription level assigned', async () => {
    const regWithoutLevel = { ...sampleRegistration, levelId: null, yearlyPriceInPence: null, intervalCount: null, intervalUnit: null };
    const db = makeDb({ first: { slug: 'test-club' }, all: [[regWithoutLevel]] });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('no_level');
  });

  it('redirects to payment-cancelled for unsupported payment type', async () => {
    const db = makeDb({ first: { slug: 'test-club' } });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/MATCH_FEE/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'MATCH_FEE', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('unsupported_type');
  });

  it('redirects to payment-cancelled when createGoCardlessLink fails', async () => {
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'GoCardless API token not configured',
    });

    const db = makeDb({ first: { slug: 'test-club' }, all: [[sampleRegistration]] });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('token_missing');
    expect(res.headers.get('location')).toContain('code=503');
  });

  // ── Multi-team cases ──────────────────────────────────────────────────────

  const reg2 = {
    registrationId: 'reg_2',
    fanId: 'FAN001',
    teamName: 'Sunday Vets',
    levelId: 'level_2',
    yearlyPriceInPence: 6000,
    intervalCount: 6,
    intervalUnit: 'monthly' as const,
  };

  it('returns 200 HTML selection page when player has multiple registrations', async () => {
    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration, reg2], []],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('U11s');
    expect(html).toContain('Sunday Vets');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });

  it('redirects to GoCardless when ?reg= targets a valid registration among multiple', async () => {
    mockCreateGoCardlessLink.mockResolvedValue({
      ok: true,
      authorisationUrl: 'https://gc.com/auth/2',
      reference: 'R2',
      billingRequestId: 'B2',
    });

    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration, reg2]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001?reg=reg_2'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://gc.com/auth/2');
    expect(mockCreateGoCardlessLink).toHaveBeenCalledOnce();
    expect(mockCreateGoCardlessLink.mock.calls[0][0].registrationId).toBe('reg_2');
  });

  it('redirects to payment-cancelled when ?reg= does not belong to this player', async () => {
    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration, reg2]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001?reg=reg_999'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('invalid_reg');
  });

  it('returns 200 HTML with disabled cards when all registrations have no subscription level', async () => {
    const noLevel1 = { ...sampleRegistration, levelId: null, yearlyPriceInPence: null, intervalCount: null, intervalUnit: null };
    const noLevel2 = { ...reg2, levelId: null, yearlyPriceInPence: null, intervalCount: null, intervalUnit: null };
    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[noLevel1, noLevel2], []],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('card--disabled');
    expect(html).toContain('No subscription level assigned');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });

  it('redirects to payment-success with existing=1 when single-team player already has active payment', async () => {
    const db = makeDb({
      first: [{ slug: 'test-club' }, { reference: 'REF-SUB-ABCD1234' }],
      all: [[sampleRegistration]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');
    expect(location).toContain('existing=1');
    expect(location).toContain('ref=REF-SUB-ABCD1234');
    expect(location).not.toContain('mandate=');
    expect(location).not.toContain('subscription=');
    expect(location).not.toContain('amount=');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });

  it('redirects to payment-success with existing=1 when ?reg= targets an already-active registration', async () => {
    const db = makeDb({
      first: [{ slug: 'test-club' }, { reference: 'REF-SUB-XY789012' }],
      all: [[sampleRegistration, reg2]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001?reg=reg_2'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/payment-success');
    expect(location).toContain('existing=1');
    expect(location).not.toContain('mandate=');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });

  it('returns selection page with disabled card and "Already set up" button for active-payment registration', async () => {
    const db = makeDb({
      first: { slug: 'test-club' },
      all: [[sampleRegistration, reg2], [{ registrationId: 'reg_1', status: 'active' }]],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments/SUBS/FAN001'),
      { env, params: { clubSlug: 'test-club', paymentType: 'SUBS', fanId: 'FAN001' } },
    );

    const res = await paymentRedirectOnRequestGet(ctx as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Already set up');
    expect(html).toContain('Subscription active');
    expect(html).toContain('href=');
    expect(html).toContain('Set up payment');
    expect(mockCreateGoCardlessLink).not.toHaveBeenCalled();
  });
});

// ─── GET/POST /[clubSlug]/payments (FAN entry) ───────────────────────────────

describe('GET /[clubSlug]/payments', () => {
  it('returns HTML form with the club name when club exists', async () => {
    const db = makeDb({ first: { slug: 'test-club', name: 'Test Club FC' } });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments'),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestGet(ctx as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('Test Club FC');
    expect(html).toContain('name="fanId"');
    expect(html).toContain('action="/test-club/payments"');
    expect(html).toContain('method="POST"');
  });

  it('redirects to payment-cancelled when club is unknown', async () => {
    const db = makeDb({ first: null });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/unknown/payments'),
      { env, params: { clubSlug: 'unknown' } },
    );

    const res = await fanEntryOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('unknown_club');
  });

  it('renders the not_found error message and prefills the FAN', async () => {
    const db = makeDb({ first: { slug: 'test-club', name: 'Test Club FC' } });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      new Request('https://example.com/test-club/payments?error=not_found&fan=BADFAN'),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestGet(ctx as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("couldn&#x27;t find a registration".replace('&#x27;', "'"));
    expect(html).toContain('BADFAN');
    expect(html).toContain('value="BADFAN"');
  });
});

describe('POST /[clubSlug]/payments', () => {
  function fanForm(fanId: string): Request {
    const body = new URLSearchParams({ fanId });
    return new Request('https://example.com/test-club/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }

  it('redirects to /<clubSlug>/payments/SUBS/<fanId> when the FAN exists', async () => {
    const db = makeDb({
      first: [{ slug: 'test-club' }, { fanId: 'FAN001' }],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      fanForm('FAN001'),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestPost(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://example.com/test-club/payments/SUBS/FAN001');
  });

  it('redirects back to the form with error=not_found when the FAN is unknown', async () => {
    const db = makeDb({
      first: [{ slug: 'test-club' }, null],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      fanForm('NOPE'),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestPost(ctx as any);
    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/test-club/payments');
    expect(location).toContain('error=not_found');
    expect(location).toContain('fan=NOPE');
  });

  it('redirects back with error=empty when FAN is blank', async () => {
    const db = makeDb({ first: { slug: 'test-club' } });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      fanForm('   '),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestPost(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('error=empty');
  });

  it('redirects to payment-cancelled when club is unknown', async () => {
    const db = makeDb({ first: null });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      fanForm('FAN001'),
      { env, params: { clubSlug: 'unknown' } },
    );

    const res = await fanEntryOnRequestPost(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('unknown_club');
  });

  it('trims whitespace around the submitted FAN', async () => {
    const db = makeDb({
      first: [{ slug: 'test-club' }, { fanId: 'FAN001' }],
    });
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(
      fanForm('  FAN001  '),
      { env, params: { clubSlug: 'test-club' } },
    );

    const res = await fanEntryOnRequestPost(ctx as any);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('https://example.com/test-club/payments/SUBS/FAN001');
  });
});

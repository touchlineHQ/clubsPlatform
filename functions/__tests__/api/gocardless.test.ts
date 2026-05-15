import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, managerSession, getReq, postReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/gocardless-link', () => ({
  createGoCardlessLink: vi.fn(async () => ({
    ok: true,
    authorisationUrl: 'https://gocardless.com/auth/123',
    reference: 'REF-1',
    billingRequestId: 'BRQ-1',
  })),
}));

vi.mock('../../lib/secrets', () => ({
  getSecret: vi.fn(async () => 'live-token'),
}));

import { onRequestPost } from '../../api/gocardless/create-link';
import { onRequestGet as confirmOnRequestGet } from '../../api/gocardless/confirm';
// The [clubSlug]/payments/[paymentType]/[fanId].ts handler uses bracket-named paths
import { onRequestGet as paymentRedirectOnRequestGet } from '../../[clubSlug]/payments/[paymentType]/[fanId]';
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

  function makeFetchMock(overrides: {
    brStatus?: string;
    mandateId?: string;
    existingSubscriptions?: any[];
    newSubscription?: any;
  } = {}) {
    const {
      brStatus = 'fulfilled',
      mandateId = 'MND-1',
      existingSubscriptions = [],
      newSubscription = { id: 'SUB-1', status: 'active' },
    } = overrides;

    let callIndex = 0;
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);
      callIndex++;

      // First call: GET billing request
      if (urlStr.includes('/billing_requests/BRQ-1') && (!init || !init.method || init.method === 'GET')) {
        return new Response(
          JSON.stringify({
            billing_requests: {
              id: 'BRQ-1',
              status: brStatus,
              metadata: {},
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
              metadata: {},
              links: { mandate_request_mandate: mandateId },
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

      // Create subscription
      if (urlStr.includes('/subscriptions') && init?.method === 'POST') {
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

    const db = makeDb({ first: null, run: { meta: { changes: 1 } } });
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

    const db = makeDb({ first: null, run: { meta: { changes: 1 } } });
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

    const db = makeDb({ first: null, run: { meta: { changes: 1 } } });
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

  it('redirects to payment-cancelled when amount is invalid', async () => {
    const db = makeDb();
    const env = makeEnv({ DB: db as any, GC_ENVIRONMENT: 'sandbox' });
    const ctx = makeContext(
      new Request(makeConfirmUrl({ amount: 'not-a-number' })),
      { env },
    );

    const res = await confirmOnRequestGet(ctx as any);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('/payment-cancelled');
    expect(res.headers.get('location')).toContain('invalid_amount');
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
    expect(res.headers.get('location')).toContain('link_failed');
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

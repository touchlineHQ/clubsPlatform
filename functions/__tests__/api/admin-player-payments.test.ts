import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv, adminSession, memberSession, postReq, patchReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

vi.mock('../../lib/secrets', () => ({ getSecret: vi.fn(async () => 'live-token') }));
vi.mock('../../lib/audit-log', () => ({ writeAuditLog: vi.fn(async () => {}) }));

import { onRequestPost, onRequestPatch } from '../../api/admin/player-payments';
import { getSecret } from '../../lib/secrets';
import { writeAuditLog } from '../../lib/audit-log';

// player_payment.reference carries the 8-char billing-request suffix;
// confirm.ts writes the logical form into subscription metadata.
const DB_REFERENCE = 'EASTLEAKE-1234-SUBS-a1b2c3d4';
const LOGICAL_REFERENCE = 'EASTLEAKE-1234-SUBS';

/** A mandate_only row joined to a £120/yr level billed over 12 monthly payments. */
function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pay_1',
    registrationId: 'reg_1',
    mandateId: 'MND-1',
    reference: DB_REFERENCE,
    status: 'mandate_only',
    yearlyPriceInPence: 12000,
    intervalCount: 12,
    intervalUnit: 'monthly',
    startDate: null,
    ...overrides,
  };
}

function makeGcFetchMock(opts: {
  subscriptions?: any[];
  mandate?: Record<string, any>;
  mandateStatus?: number;
  createStatus?: number;
  capturedBody?: { value: any };
} = {}) {
  const {
    subscriptions = [],
    mandate,
    mandateStatus,
    createStatus = 200,
    capturedBody,
  } = opts;

  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(typeof url === 'object' && 'url' in url ? (url as Request).url : url);

    if (urlStr.includes('/mandates/') && !urlStr.includes('/actions/')) {
      if (mandateStatus && mandateStatus !== 200) {
        return new Response('mandate error', { status: mandateStatus });
      }
      return new Response(
        JSON.stringify({
          mandates: {
            id: 'MND-1',
            status: 'pending_submission',
            next_possible_charge_date: null,
            ...mandate,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (urlStr.includes('/subscriptions?mandate=')) {
      return new Response(JSON.stringify({ subscriptions }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (urlStr.includes('/subscriptions') && init?.method === 'POST') {
      if (capturedBody && typeof init.body === 'string') {
        capturedBody.value = JSON.parse(init.body).subscriptions;
      }
      if (createStatus !== 200) {
        return new Response(
          JSON.stringify({ error: { message: 'Validation failed' } }),
          { status: createStatus },
        );
      }
      return new Response(
        JSON.stringify({ subscriptions: { id: 'SUB-NEW', status: 'active' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('Not found', { status: 404 });
  });
}

/** Pass id: null to omit it from the body entirely. */
function retryCtx(db: unknown, id: string | null = 'pay_1') {
  const env = makeEnv({ DB: db as never, GC_ENVIRONMENT: 'sandbox' } as never);
  const body = id === null ? {} : { id };
  return makeContext(postReq('/api/admin/player-payments', body, { 'X-Club-Slug': 'test-club' }), {
    env,
  });
}

function countCreateCalls(fetchMock: ReturnType<typeof makeGcFetchMock>) {
  return fetchMock.mock.calls.filter(
    ([url, init]: any[]) =>
      String(url).includes('/subscriptions') &&
      !String(url).includes('?mandate=') &&
      init?.method === 'POST',
  ).length;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(adminSession);
  vi.mocked(getSecret).mockResolvedValue('live-token');
});

describe('POST /api/admin/player-payments — guards', () => {
  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await onRequestPost(retryCtx(makeDb()) as never);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a non-admin', async () => {
    mockGetSession.mockResolvedValue(memberSession);
    const res = await onRequestPost(retryCtx(makeDb()) as never);
    expect(res.status).toBe(403);
  });

  it('returns 400 when id is missing', async () => {
    const res = await onRequestPost(retryCtx(makeDb(), null) as never);
    expect(res.status).toBe(400);
  });

  it('returns 404 when the payment does not exist', async () => {
    const res = await onRequestPost(retryCtx(makeDb({ first: null })) as never);
    expect(res.status).toBe(404);
  });

  it('returns 409 for a payment that is not mandate_only', async () => {
    const db = makeDb({ first: paymentRow({ status: 'active' }) });
    const res = await onRequestPost(retryCtx(db) as never);
    expect(res.status).toBe(409);
  });

  it('returns 422 when no subscription level is configured', async () => {
    const db = makeDb({ first: paymentRow({ yearlyPriceInPence: null }) });
    const res = await onRequestPost(retryCtx(db) as never);
    expect(res.status).toBe(422);
  });

  it('returns 503 when the GoCardless token is not configured', async () => {
    vi.mocked(getSecret).mockResolvedValue(null);
    const db = makeDb({ first: paymentRow() });
    const res = await onRequestPost(retryCtx(db) as never);
    expect(res.status).toBe(503);
  });
});

describe('POST /api/admin/player-payments — number of payments', () => {
  it('caps a single yearly payment at count 1 instead of collecting forever', async () => {
    const captured = { value: undefined as any };
    vi.stubGlobal('fetch', makeGcFetchMock({ capturedBody: captured }));

    const db = makeDb({
      first: paymentRow({ intervalCount: 1, intervalUnit: 'yearly', yearlyPriceInPence: 5000 }),
      run: { meta: { changes: 1 } },
    });
    const res = await onRequestPost(retryCtx(db) as never);

    expect(res.status).toBe(200);
    expect(captured.value.count).toBe(1);
    expect(captured.value.interval_unit).toBe('yearly');
    expect(captured.value.amount).toBe(5000);

    vi.unstubAllGlobals();
  });

  it('caps a monthly plan at the configured number of payments', async () => {
    const captured = { value: undefined as any };
    vi.stubGlobal('fetch', makeGcFetchMock({ capturedBody: captured }));

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    await onRequestPost(retryCtx(db) as never);

    expect(captured.value.count).toBe(12);
    expect(captured.value.amount).toBe(1000);

    vi.unstubAllGlobals();
  });

  it('writes the logical reference into subscription metadata, matching confirm.ts', async () => {
    const captured = { value: undefined as any };
    vi.stubGlobal('fetch', makeGcFetchMock({ capturedBody: captured }));

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    await onRequestPost(retryCtx(db) as never);

    expect(captured.value.metadata.reference).toBe(LOGICAL_REFERENCE);
    expect(captured.value.metadata.customer_ref).toBe(LOGICAL_REFERENCE);
    expect(captured.value.name).toBe(LOGICAL_REFERENCE);

    vi.unstubAllGlobals();
  });
});

describe('POST /api/admin/player-payments — duplicate protection', () => {
  it('reconciles against a subscription created by the payer flow rather than duplicating it', async () => {
    const fetchMock = makeGcFetchMock({
      subscriptions: [
        { id: 'SUB-EXISTING', status: 'active', metadata: { reference: LOGICAL_REFERENCE } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const res = await onRequestPost(retryCtx(db) as never);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      subscriptionId: 'SUB-EXISTING',
      reconciled: true,
      matchedByReference: true,
    });
    expect(countCreateCalls(fetchMock)).toBe(0);

    vi.unstubAllGlobals();
  });

  it('reconciles against a subscription created by an earlier retry (suffixed reference)', async () => {
    const fetchMock = makeGcFetchMock({
      subscriptions: [
        { id: 'SUB-OLD-RETRY', status: 'active', metadata: { reference: DB_REFERENCE } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const body = (await (await onRequestPost(retryCtx(db) as never)).json()) as any;

    expect(body).toMatchObject({ subscriptionId: 'SUB-OLD-RETRY', matchedByReference: true });
    expect(countCreateCalls(fetchMock)).toBe(0);

    vi.unstubAllGlobals();
  });

  it('reconciles against any live subscription on the mandate, whatever its reference', async () => {
    const fetchMock = makeGcFetchMock({
      subscriptions: [{ id: 'SUB-UNKNOWN', status: 'active', metadata: { reference: 'SOMETHING-ELSE' } }],
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const body = (await (await onRequestPost(retryCtx(db) as never)).json()) as any;

    expect(body).toMatchObject({
      subscriptionId: 'SUB-UNKNOWN',
      reconciled: true,
      matchedByReference: false,
    });
    expect(countCreateCalls(fetchMock)).toBe(0);
    // The fallback match is recorded so the mismatch is visible in the audit trail.
    expect(vi.mocked(writeAuditLog).mock.calls[0][1].note).toContain('SOMETHING-ELSE');

    vi.unstubAllGlobals();
  });

  it('reconciles a finished subscription as paid in full without re-charging the player', async () => {
    const fetchMock = makeGcFetchMock({
      subscriptions: [
        { id: 'SUB-DONE', status: 'finished', metadata: { reference: LOGICAL_REFERENCE } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const body = (await (await onRequestPost(retryCtx(db) as never)).json()) as any;

    // The plan was collected in full, so a replacement would charge it all again.
    expect(countCreateCalls(fetchMock)).toBe(0);
    expect(body).toMatchObject({ subscriptionId: 'SUB-DONE', reconciled: true, status: 'completed' });

    vi.unstubAllGlobals();
  });

  it('creates a subscription when the only one on the mandate is cancelled', async () => {
    const fetchMock = makeGcFetchMock({
      subscriptions: [
        { id: 'SUB-DEAD', status: 'cancelled', metadata: { reference: LOGICAL_REFERENCE } },
      ],
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const body = (await (await onRequestPost(retryCtx(db) as never)).json()) as any;

    expect(body.subscriptionId).toBe('SUB-NEW');
    expect(countCreateCalls(fetchMock)).toBe(1);

    vi.unstubAllGlobals();
  });
});

describe('POST /api/admin/player-payments — start date', () => {
  it('clamps the start date to the mandate next_possible_charge_date', async () => {
    const captured = { value: undefined as any };
    vi.stubGlobal(
      'fetch',
      makeGcFetchMock({
        capturedBody: captured,
        mandate: { next_possible_charge_date: '2099-09-04' },
      }),
    );

    const db = makeDb({
      first: paymentRow({ startDate: '2099-09-01' }),
      run: { meta: { changes: 1 } },
    });
    const res = await onRequestPost(retryCtx(db) as never);
    const body = (await res.json()) as any;

    expect(captured.value.start_date).toBe('2099-09-04');
    expect(body.startDate).toBe('2099-09-04');

    vi.unstubAllGlobals();
  });

  it('proceeds with the configured date when the mandate lookup fails', async () => {
    const captured = { value: undefined as any };
    vi.stubGlobal('fetch', makeGcFetchMock({ capturedBody: captured, mandateStatus: 500 }));

    const db = makeDb({
      first: paymentRow({ startDate: '2099-09-01' }),
      run: { meta: { changes: 1 } },
    });
    const res = await onRequestPost(retryCtx(db) as never);
    const body = (await res.json()) as any;

    expect(res.status).toBe(200);
    expect(captured.value.start_date).toBe('2099-09-01');
    expect(body.startDate).toBe('2099-09-01');

    vi.unstubAllGlobals();
  });

  it('omits start_date and skips the mandate lookup when none is configured', async () => {
    const captured = { value: undefined as any };
    const fetchMock = makeGcFetchMock({ capturedBody: captured });
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    await onRequestPost(retryCtx(db) as never);

    expect(captured.value.start_date).toBeUndefined();
    expect(
      fetchMock.mock.calls.filter(([url]: any[]) => String(url).includes('/mandates/')),
    ).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});

describe('POST /api/admin/player-payments — GoCardless rejection', () => {
  it('returns 502 with the GoCardless detail when the subscription is rejected', async () => {
    vi.stubGlobal('fetch', makeGcFetchMock({ createStatus: 422 }));

    const db = makeDb({ first: paymentRow(), run: { meta: { changes: 1 } } });
    const res = await onRequestPost(retryCtx(db) as never);
    const body = (await res.json()) as any;

    expect(res.status).toBe(502);
    expect(body.detail).toContain('Validation failed');

    vi.unstubAllGlobals();
  });
});

describe('PATCH /api/admin/player-payments — deactivate', () => {
  beforeEach(() => mockGetSession.mockResolvedValue(adminSession));

  function patchCtx(db: any) {
    return makeContext(
      patchReq('/api/admin/player-payments', { id: 'pay_1' }, { 'X-Club-Slug': 'test-club' }),
      { env: { DB: db as any } },
    );
  }

  it('deactivates a live subscription row', async () => {
    const db = makeDb({ first: { id: 'pay_1', status: 'active' }, run: { meta: { changes: 1 } } });
    const res = await onRequestPatch(patchCtx(db) as never);

    expect(res.status).toBe(200);
    const updateSql = (db.prepare as Mock).mock.calls
      .map(([sql]) => sql as string)
      .find(sql => sql.includes(`SET status = 'inactive'`));
    expect(updateSql).toContain(`status != 'completed'`);
    expect(writeAuditLog).toHaveBeenCalled();
  });

  it('returns 409 when the row becomes completed before the update', async () => {
    const db = makeDb({ first: { id: 'pay_1', status: 'active' }, run: { meta: { changes: 0 } } });
    const res = await onRequestPatch(patchCtx(db) as never);

    expect(res.status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('refuses to deactivate a plan that collected in full', async () => {
    // Deactivating only updates our DB — it cancels nothing at GoCardless — so
    // dropping the marker would put a paid-up player back in the mandate flow.
    const db = makeDb({ first: { id: 'pay_1', status: 'completed' }, run: { meta: { changes: 1 } } });
    const res = await onRequestPatch(patchCtx(db) as never);
    const body = (await res.json()) as any;

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/paid in full/);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });

  it('refuses to deactivate an already-inactive row', async () => {
    const db = makeDb({ first: { id: 'pay_1', status: 'inactive' }, run: { meta: { changes: 1 } } });
    const res = await onRequestPatch(patchCtx(db) as never);

    expect(res.status).toBe(409);
    expect(writeAuditLog).not.toHaveBeenCalled();
  });
});

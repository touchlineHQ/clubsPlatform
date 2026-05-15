import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from '../test-utils';
import type { D1Database } from '@cloudflare/workers-types';

const mockGetSecret = vi.hoisted(() => vi.fn());
vi.mock('../../lib/secrets', () => ({ getSecret: mockGetSecret }));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import { createGoCardlessLink } from '../../lib/gocardless-link';

const baseEnv = {
  DB: {} as D1Database,
  SECRETS_ENCRYPTION_KEY: 'a'.repeat(64),
  SECRETS_TRANSPORT_PRIVATE_KEY: '',
  SECRETS_TRANSPORT_PUBLIC_KEY: '',
  GC_ENVIRONMENT: 'sandbox',
} as never;

const baseInput = {
  env: baseEnv,
  db: {} as D1Database,
  clubSlug: 'test-club',
  registrationId: 'reg_1',
  paymentType: 'SUBSCRIPTION',
  amountInPence: 1000,
  intervalUnit: 'monthly' as const,
  origin: 'https://example.com',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

describe('createGoCardlessLink', () => {
  it('returns 400 when required fields are missing', async () => {
    const db = makeDb() as unknown as D1Database;
    const result = await createGoCardlessLink({ ...baseInput, db, registrationId: '' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 when amountInPence is 0 or negative', async () => {
    const db = makeDb() as unknown as D1Database;
    const result = await createGoCardlessLink({ ...baseInput, db, amountInPence: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 400 when count is invalid (e.g. 0)', async () => {
    const db = makeDb() as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');
    const result = await createGoCardlessLink({ ...baseInput, db, count: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('returns 503 when GC_ACCESS_TOKEN secret is not configured', async () => {
    const db = makeDb() as unknown as D1Database;
    mockGetSecret.mockResolvedValue(null);
    const result = await createGoCardlessLink({ ...baseInput, db });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it('returns 404 when registration is not found in DB', async () => {
    const db = makeDb({ first: null }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');
    const result = await createGoCardlessLink({ ...baseInput, db });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });

  it('returns 502 when billing request creation fails', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');
    mockFetch.mockResolvedValue({ ok: false, text: async () => 'GoCardless error' });

    const result = await createGoCardlessLink({ ...baseInput, db });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toMatch(/billing request/i);
    }
  });

  it('returns 502 when billing request flow creation fails', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ billing_requests: { id: 'br_001' } }),
      })
      .mockResolvedValueOnce({ ok: false, text: async () => 'Flow error' });

    const result = await createGoCardlessLink({ ...baseInput, db });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(502);
  });

  it('returns authorisationUrl on success', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ billing_requests: { id: 'br_001' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ billing_request_flows: { authorisation_url: 'https://pay.gocardless.com/billing/auth/br_001' } }),
      });

    const result = await createGoCardlessLink({ ...baseInput, db });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.authorisationUrl).toContain('gocardless.com');
      expect(result.reference).toContain('FAN001');
      expect(result.billingRequestId).toBe('br_001');
    }
  });

  it('sets redirect URI using sandbox URL when GC_ENVIRONMENT is not live', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_requests: { id: 'br_001' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_request_flows: { authorisation_url: 'https://pay.gocardless.com' } }) });

    await createGoCardlessLink({ ...baseInput, db });

    const firstCallUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstCallUrl).toContain('sandbox');
  });

  it('includes count in metadata when count is specified', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_requests: { id: 'br_001' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_request_flows: { authorisation_url: 'https://pay.gocardless.com' } }) });

    await createGoCardlessLink({ ...baseInput, db, count: 10 });

    const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(firstCallBody.billing_requests.metadata.billing_details).toContain('x10');
  });
});

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeDb } from '../test-utils';
import type { D1Database } from '@cloudflare/workers-types';

const mockGetSecret = vi.hoisted(() => vi.fn());
vi.mock('../../lib/secrets', () => ({ getSecret: mockGetSecret }));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

import {
  createGoCardlessLink,
  resolveSubscriptionStartDate,
  clampStartDateToMandate,
} from '../../lib/gocardless-link';

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
    expect(firstCallBody.billing_requests.metadata.tracking_info).toContain('x10');
  });

  it('forwards startDate via the confirm redirect URL', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_requests: { id: 'br_001' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_request_flows: { authorisation_url: 'https://pay.gocardless.com' } }) });

    await createGoCardlessLink({ ...baseInput, db, startDate: '2030-01-15' });

    const flowBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    const redirectUri: string = flowBody.billing_request_flows.redirect_uri;
    expect(redirectUri).toContain('start_date=2030-01-15');
  });

  it('omits start_date from the confirm redirect URL when startDate is not provided', async () => {
    const db = makeDb({ first: { id: 'reg_1', teamName: 'First XI', fanId: 'FAN001' } }) as unknown as D1Database;
    mockGetSecret.mockResolvedValue('gc_token_123');

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_requests: { id: 'br_001' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ billing_request_flows: { authorisation_url: 'https://pay.gocardless.com' } }) });

    await createGoCardlessLink({ ...baseInput, db });

    const flowBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    const redirectUri: string = flowBody.billing_request_flows.redirect_uri;
    expect(redirectUri).not.toContain('start_date');
  });
});

describe('resolveSubscriptionStartDate', () => {
  it('returns null when no date is configured', () => {
    expect(resolveSubscriptionStartDate(null)).toBeNull();
    expect(resolveSubscriptionStartDate(undefined)).toBeNull();
    expect(resolveSubscriptionStartDate('')).toBeNull();
  });

  it('returns null for malformed date strings', () => {
    expect(resolveSubscriptionStartDate('not-a-date')).toBeNull();
    expect(resolveSubscriptionStartDate('2024/01/01')).toBeNull();
    expect(resolveSubscriptionStartDate('24-01-01')).toBeNull();
  });

  it('returns the configured date when today is before it', () => {
    const today = new Date('2024-05-10T12:00:00Z');
    expect(resolveSubscriptionStartDate('2024-09-01', today)).toBe('2024-09-01');
  });

  it('returns the configured date when today is the same day', () => {
    const today = new Date('2024-05-10T23:00:00Z');
    expect(resolveSubscriptionStartDate('2024-05-10', today)).toBe('2024-05-10');
  });

  it('returns the first of next month when today is past the configured date', () => {
    const today = new Date('2024-05-15T12:00:00Z');
    expect(resolveSubscriptionStartDate('2024-05-01', today)).toBe('2024-06-01');
  });

  it('rolls into the next year when today is in December', () => {
    const today = new Date('2024-12-20T12:00:00Z');
    expect(resolveSubscriptionStartDate('2024-12-01', today)).toBe('2025-01-01');
  });
});

describe('clampStartDateToMandate', () => {
  it('returns null when there is no resolved date, so start_date stays omitted', () => {
    expect(clampStartDateToMandate(null, '2024-09-04')).toBeNull();
  });

  it('returns the resolved date when the mandate has no next_possible_charge_date', () => {
    expect(clampStartDateToMandate('2024-09-01', null)).toBe('2024-09-01');
    expect(clampStartDateToMandate('2024-09-01', undefined)).toBe('2024-09-01');
  });

  it('returns the resolved date when next_possible_charge_date is malformed', () => {
    expect(clampStartDateToMandate('2024-09-01', 'not-a-date')).toBe('2024-09-01');
    expect(clampStartDateToMandate('2024-09-01', '2024/09/04')).toBe('2024-09-01');
  });

  it('clamps forward when the mandate cannot be charged until later', () => {
    expect(clampStartDateToMandate('2024-09-01', '2024-09-04')).toBe('2024-09-04');
  });

  it('keeps the resolved date when the mandate is chargeable earlier', () => {
    expect(clampStartDateToMandate('2024-09-01', '2024-08-01')).toBe('2024-09-01');
  });

  it('keeps the resolved date when the two are equal', () => {
    expect(clampStartDateToMandate('2024-09-04', '2024-09-04')).toBe('2024-09-04');
  });

  it('compares correctly across a year boundary', () => {
    expect(clampStartDateToMandate('2024-12-31', '2025-01-05')).toBe('2025-01-05');
    expect(clampStartDateToMandate('2025-01-05', '2024-12-31')).toBe('2025-01-05');
  });
});

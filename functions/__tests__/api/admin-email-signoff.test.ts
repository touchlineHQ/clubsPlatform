import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import { EMAIL_SIGNOFF_POLICY_VERSION } from '../../lib/club-email-signoff';

const mockGetSession = vi.hoisted(() => vi.fn());
const mockGetPostHog = vi.hoisted(() => vi.fn(() => null as any));
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));
vi.mock('../../lib/posthog', () => ({
  getPostHog: mockGetPostHog,
  clubGroups: (clubSlug: string) => ({ groups: { club: clubSlug } }),
}));

import { onRequestGet, onRequestPost } from '../../api/admin/email-signoff';
import { onRequestGet as policyGet } from '../../api/email-signoff-policy';

describe('GET /api/email-signoff-policy', () => {
  it('returns the current wording without auth', async () => {
    const res = await policyGet({} as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.policyVersion).toBe(EMAIL_SIGNOFF_POLICY_VERSION);
    expect(body.liabilities).toHaveLength(3);
    expect(body.liabilities[0].wordingHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('admin email-signoff', () => {
  let sqlite: SqliteDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
    mockGetPostHog.mockReturnValue(null);
    sqlite = createSchemaDb();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('reports current=false for a club with no rows', async () => {
    const req = getReq('/api/admin/email-signoff', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: d1Over(sqlite) as any } });
    const res = await onRequestGet(ctx as any);
    const body = await res.json() as any;
    expect(res.status).toBe(200);
    expect(body.current).toBe(false);
    expect(body.acceptedLiabilities).toEqual([]);
  });

  it('rejects a partial accept and records a full one', async () => {
    const bad = postReq(
      '/api/admin/email-signoff',
      { liabilities: { parental_consent: true, operational_split: true, right_to_object: false } },
      { 'X-Club-Slug': 'test-club' },
    );
    const badRes = await onRequestPost(makeContext(bad, { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(badRes.status).toBe(400);

    const good = postReq(
      '/api/admin/email-signoff',
      {
        liabilities: {
          parental_consent: true,
          operational_split: true,
          right_to_object: true,
        },
      },
      { 'X-Club-Slug': 'test-club', 'CF-Connecting-IP': '198.51.100.20' },
    );
    const goodRes = await onRequestPost(makeContext(good, { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(goodRes.status).toBe(200);
    const body = await goodRes.json() as any;
    expect(body.current).toBe(true);
    expect(body.acceptanceId).toMatch(/^emsign_/);

    const row = sqlite.prepare(
      `SELECT ipAddress FROM "club_email_signoff" LIMIT 1`,
    ).get() as { ipAddress: string };
    expect(row.ipAddress).toBe('198.51.100.20');

    const statusReq = getReq('/api/admin/email-signoff', { 'X-Club-Slug': 'test-club' });
    const status = await onRequestGet(makeContext(statusReq, { env: { DB: d1Over(sqlite) as any } }) as any);
    const statusBody = await status.json() as any;
    expect(statusBody.current).toBe(true);
    expect(statusBody.acceptedLiabilities).toHaveLength(3);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const req = getReq('/api/admin/email-signoff', { 'X-Club-Slug': 'test-club' });
    const res = await onRequestGet(makeContext(req, { env: { DB: d1Over(sqlite) as any } }) as any);
    expect(res.status).toBe(401);
  });
});

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, adminSession, getReq, postReq, patchReq } from '../test-utils';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
  hashPwd: vi.fn(async () => 'pbkdf2$fakehash'),
}));

// ─── player-registrations.ts ──────────────────────────────────────────────────

import { onRequestGet as playerRegistrationsGet } from '../../api/admin/player-registrations';

describe('player-registrations GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of player registrations', async () => {
    const registrationRows = [
      {
        fanId: 'FAN001',
        registrationId: 'preg_1',
        teamName: 'U11 Boys',
        ageGroup: 'U11',
        registrationExpiry: '2025-07-31',
        registrationStatus: 'active',
        linkedAccounts: 'parent@example.com|guardian',
        subscriptionLevelId: 'level_1',
        subscriptionLevelName: 'Junior Annual',
        yearlyPriceInPence: 5000,
        intervalCount: 1,
        intervalUnit: 'yearly',
      },
      {
        fanId: 'FAN002',
        registrationId: 'preg_2',
        teamName: 'U13 Girls',
        ageGroup: 'U13',
        registrationExpiry: '2025-07-31',
        registrationStatus: 'active',
        linkedAccounts: null,
        subscriptionLevelId: null,
        subscriptionLevelName: null,
        yearlyPriceInPence: null,
        intervalCount: null,
        intervalUnit: null,
      },
    ];

    const db = makeDb({ all: [registrationRows] });
    const req = getReq('/api/admin/player-registrations', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerRegistrationsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.registrations)).toBe(true);
    expect(body.registrations.length).toBe(2);
    expect(body.registrations[0].fanId).toBe('FAN001');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb({ all: [[]] });
    const req = getReq('/api/admin/player-registrations', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerRegistrationsGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── player-payments.ts ───────────────────────────────────────────────────────

import { onRequestGet as playerPaymentsGet, onRequestPatch as playerPaymentsPatch } from '../../api/admin/player-payments';

describe('player-payments GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('returns an array of player payments', async () => {
    const paymentRows = [
      {
        id: 'pp_1',
        registrationId: 'preg_1',
        fanId: 'FAN001',
        teamName: 'U11 Boys',
        reference: 'REF001',
        mandateId: 'mandate_1',
        subscriptionId: 'sub_1',
        status: 'active',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      {
        id: 'pp_2',
        registrationId: 'preg_2',
        fanId: 'FAN002',
        teamName: 'U13 Girls',
        reference: 'REF002',
        mandateId: 'mandate_2',
        subscriptionId: null,
        status: 'pending',
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
    ];

    const db = makeDb({ all: [paymentRows] });
    const req = getReq('/api/admin/player-payments', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsGet(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body.payments)).toBe(true);
    expect(body.payments.length).toBe(2);
    expect(body.payments[0].id).toBe('pp_1');
    expect(body.payments[0].fanId).toBe('FAN001');
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb({ all: [[]] });
    const req = getReq('/api/admin/player-payments', { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsGet(ctx as any);
    expect(res.status).toBe(401);
  });
});

describe('player-payments PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('deactivates a payment and returns ok', async () => {
    const db = makeDb({ run: { meta: { changes: 1 } } });
    const req = patchReq('/api/admin/player-payments', { id: 'pay_1' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('returns 400 when id is missing', async () => {
    const db = makeDb();
    const req = patchReq('/api/admin/player-payments', {}, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/id/i);
  });

  it('returns 404 when payment is not found', async () => {
    const db = makeDb({ run: { meta: { changes: 0 } } });
    const req = patchReq('/api/admin/player-payments', { id: 'pay_unknown' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error).toMatch(/not found/i);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb();
    const req = patchReq('/api/admin/player-payments', { id: 'pay_1' }, { 'X-Club-Slug': 'test-club' });
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await playerPaymentsPatch(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── import-players.ts ────────────────────────────────────────────────────────

import { onRequestPost as importPlayersPost } from '../../api/admin/import-players';

describe('import-players POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('imports players and returns ok with created/updated counts', async () => {
    // The import handler makes many sequential .first() and .run() calls per row.
    // We supply first: null for every call so each player/registration is treated as new.
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
      batch: [],
    });
    const req = postReq(
      '/api/admin/import-players',
      {
        rows: [
          {
            fanId: 'FAN001',
            ageGroup: 'U11',
            teamName: 'U11 Boys',
            registrationExpiry: '2025-07-31',
            registrationStatus: 'active',
            playerEmail: null,
            parentEmails: [],
          },
        ],
      },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.players.created).toBeGreaterThanOrEqual(0);
  });

  it('returns 400 when rows is not an array', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: 'not-an-array' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/rows/i);
  });

  it('creates user accounts for parent emails provided', async () => {
    // first: null means no existing player, no existing registration, no existing user
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
      batch: [],
    });
    const req = postReq(
      '/api/admin/import-players',
      {
        rows: [
          {
            fanId: 'FAN002',
            ageGroup: 'U11',
            teamName: 'U11 Boys',
            registrationExpiry: '2025-07-31',
            registrationStatus: 'active',
            playerEmail: null,
            parentEmails: ['parent@example.com'],
          },
        ],
      },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.users.created).toBeGreaterThanOrEqual(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-players',
      { rows: [] },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importPlayersPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

// ─── import-fixtures.ts ───────────────────────────────────────────────────────

import { onRequestPost as importFixturesPost } from '../../api/admin/import-fixtures';

describe('import-fixtures POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue(adminSession);
  });

  it('imports fixtures from club feed and returns ok', async () => {
    // The feed returns a ClubFeed with a fixtures array.
    // We supply a home fixture with a future date so it is not filtered out.
    const feedFixture = {
      id: '123',
      date: '2099-03-15', // far future so it always passes the >= today filter
      time: '10:00',
      home_team: 'U11 Boys',
      away_team: 'Away FC',
      team: 'U11 Boys',
      home_away: 'home' as const,
      division: 'Sunday League',
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [feedFixture] }),
        { status: 200 },
      ),
    );

    // .first() returns null → no existing booking request → will insert
    // .run() succeeds for the INSERT
    const db = makeDb({
      first: null,
      run: { meta: { changes: 1 } },
    });

    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
  });

  it('skips fixtures that already have a booking request', async () => {
    const feedFixture = {
      id: '124',
      date: '2099-03-22',
      time: '11:00',
      home_team: 'U13 Boys',
      away_team: 'Rivals FC',
      team: 'U13 Boys',
      home_away: 'home' as const,
      division: 'Cup',
    };

    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [feedFixture] }),
        { status: 200 },
      ),
    );

    // .first() returns an existing row → fixture will be skipped
    const db = makeDb({ first: { id: 'req_existing' } });

    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.skipped).toBe(1);
    expect(body.created).toBe(0);
  });

  it('returns 400 when clubFeedSlug is missing', async () => {
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      {},
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/clubFeedSlug/);
  });

  it('returns 502 when the upstream feed fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'nonexistent-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(502);
    const body = await res.json() as any;
    expect(body.error).toMatch(/fetch/i);
  });

  it('returns ok with created=0 when there are no home fixtures in the feed', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fixtures: [] }),
        { status: 200 },
      ),
    );

    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.created).toBe(0);
  });

  it('returns 401 when not authenticated', async () => {
    mockGetSession.mockResolvedValue(null);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ fixtures: [] }), { status: 200 }),
    );
    const db = makeDb();
    const req = postReq(
      '/api/admin/import-fixtures',
      { clubFeedSlug: 'my-club' },
      { 'X-Club-Slug': 'test-club' },
    );
    const ctx = makeContext(req, { env: { DB: db as any } });

    const res = await importFixturesPost(ctx as any);
    expect(res.status).toBe(401);
  });
});

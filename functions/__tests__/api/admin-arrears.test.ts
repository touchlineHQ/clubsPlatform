import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, treasurerSession, secretarySession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestGet as arrearsGet } from '../../api/admin/arrears';
import { onRequestPost as remindPost, onRequestGet as historyGet } from '../../api/admin/arrears-reminders';
import { recordPaymentOutcome } from '../../lib/payment-failure';

const NOW = Date.now();
const DAY = 86_400_000;
const CLUB = 'test-club';
const H = { 'X-Club-Slug': CLUB };

type ArrearsRow = {
  registrationId: string;
  reason: string;
  reachableContacts: number;
  objectedContacts: number;
  pendingContacts: number;
  chaseCount: number;
  lastChasedAt: number | null;
  failureCause: string | null;
};

describe('arrears view and reminders (#77)', () => {
  let sqlite: SqliteDb;

  const reg = (id: string, player: string, team: string, opts: { status?: string; ageDays?: number } = {}) => {
    sqlite.exec(`INSERT OR IGNORE INTO "player" VALUES ('${player}','FAN_${player}',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration"
      (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
      VALUES ('${id}','${CLUB}','${player}','${team}',NULL,NULL,'${opts.status ?? 'Active'}',${NOW - (opts.ageDays ?? 0) * DAY},${NOW})`);
  };
  const contact = (id: string, player: string, state: string, op: number) =>
    sqlite.exec(`INSERT INTO "player_contact"
      (id, clubSlug, playerId, email, relationship, state, operationalOptIn, marketingOptIn, sourcedBy, sourcedAt)
      VALUES ('${id}','${CLUB}','${player}','${id}@example.com','guardian','${state}',${op},0,NULL,${NOW})`);
  const payment = (id: string, regId: string, status: string, mandate = `MD_${id}`) =>
    sqlite.exec(`INSERT INTO "player_payment" (id, clubSlug, registrationId, reference, mandateId, subscriptionId, status, createdAt, updatedAt)
      VALUES ('${id}','${CLUB}','${regId}','REF_${id}','${mandate}',NULL,'${status}',${NOW},${NOW})`);

  beforeEach(() => {
    sqlite = createSchemaDb();
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, createdAt) VALUES ('c1','${CLUB}','Test FC',1,${NOW})`);
    reg('r_unpaid', 'p1', 'U12 Blues', { ageDays: 40 });
    reg('r_paying', 'p2', 'U12 Blues');
    payment('pp2', 'r_paying', 'active');
    reg('r_failed', 'p3', 'U12 Blues');
    payment('pp3', 'r_failed', 'active', 'MD_FAIL');
    reg('r_other_team', 'p4', 'U14 Reds');
    reg('r_lapsed', 'p5', 'U12 Blues', { status: 'Cancelled' });
    contact('c_ok', 'p1', 'confirmed', 1);
    contact('c_objected', 'p1', 'confirmed', 0);
    contact('c_pending', 'p1', 'pending', 1);
    contact('c3', 'p3', 'confirmed', 1);
    mockGetSession.mockResolvedValue(treasurerSession);
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  const env = (extra: Record<string, unknown> = {}) => ({ DB: d1Over(sqlite) as any, ...extra });
  const list = async (qs = '') => {
    const res = await arrearsGet(makeContext(getReq(`/api/admin/arrears${qs}`, H), { env: env() }) as any);
    return { res, body: (await res.clone().json()) as { rows: ArrearsRow[]; truncated: boolean } };
  };

  it('lists outstanding live registrations for a team, and never paying or lapsed ones', async () => {
    const { res, body } = await list('?team=U12%20Blues');
    expect(res.status).toBe(200);
    expect(body.rows.map((r) => r.registrationId)).toEqual(['r_unpaid']);
    expect(body.rows[0]).toMatchObject({ reason: 'no_payment', reachableContacts: 1, objectedContacts: 1, pendingContacts: 1 });
  });

  it('distinguishes a failed Direct Debit from no mandate, and clears it when a payment succeeds', async () => {
    await recordPaymentOutcome(d1Over(sqlite) as any, 'failed', 'PM1', 'MD_FAIL', 'insufficient_funds', NOW);
    let { body } = await list('?team=U12%20Blues');
    expect(body.rows.find((r) => r.registrationId === 'r_failed')).toMatchObject({
      reason: 'failed_payment', failureCause: 'insufficient_funds',
    });
    expect(body.rows.find((r) => r.registrationId === 'r_unpaid')?.reason).toBe('no_payment');

    await recordPaymentOutcome(d1Over(sqlite) as any, 'confirmed', 'PM2', 'MD_FAIL', null, NOW + 1);
    ({ body } = await list('?team=U12%20Blues'));
    expect(body.rows.map((r) => r.registrationId)).toEqual(['r_unpaid']);
  });

  it('ignores a failure on a mandate it does not know', async () => {
    await recordPaymentOutcome(d1Over(sqlite) as any, 'failed', 'PMX', 'MD_UNKNOWN', null, NOW);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM payment_failure').get()).toEqual({ n: 0 });
  });

  it('filters by how overdue', async () => {
    const { body } = await list('?minDays=30');
    expect(body.rows.map((r) => r.registrationId)).toEqual(['r_unpaid']);
    expect((await list('?minDays=-1')).res.status).toBe(400);
  });

  it('needs the payments permission', async () => {
    mockGetSession.mockResolvedValue(secretarySession);
    expect((await list()).res.status).toBe(403);
  });

  it('sends a reminder only to reachable contacts, shows the exclusions, and records the chase', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await remindPost(makeContext(
      postReq('/api/admin/arrears-reminders', { registrationIds: ['r_unpaid', 'r_elsewhere'], template: 'outstanding' }, H),
      { env: env({ RESEND_API_KEY: 'k', FROM_EMAIL: 'noreply@example.com' }) },
    ) as any);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      results: Array<{ registrationId: string; sent: number; dropped: Array<{ contactId: string; dropReason: string }> }>;
      notFound: string[];
    };
    expect(body.notFound).toEqual(['r_elsewhere']);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].sent).toBe(1);
    expect(body.results[0].dropped).toEqual(expect.arrayContaining([
      { contactId: 'c_objected', dropReason: 'no_operational_opt_in' },
      { contactId: 'c_pending', dropReason: 'pending' },
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
    expect(sentBody).toContain('c_ok@example.com');
    expect(sentBody).not.toContain('c_objected@example.com');

    const { body: after } = await list('?team=U12%20Blues');
    expect(after.rows[0]).toMatchObject({ chaseCount: 1 });
    expect(after.rows[0].lastChasedAt).not.toBeNull();

    const hist = await historyGet(makeContext(getReq('/api/admin/arrears-reminders?registrationId=r_unpaid', H), { env: env() }) as any);
    const h = await hist.json() as { history: Array<{ template: string; sent: number; dropped: number; reasons: string[] }> };
    expect(h.history).toHaveLength(1);
    expect(h.history[0]).toMatchObject({ template: 'outstanding', sent: 1, dropped: 2 });
    expect(h.history[0].reasons).toEqual(expect.arrayContaining(['no_operational_opt_in', 'pending']));
  });

  it('skips a failed_payment reminder for a registration with no open failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'm1' }), { status: 200 })));
    await recordPaymentOutcome(d1Over(sqlite) as any, 'failed', 'PM1', 'MD_FAIL', 'insufficient_funds', NOW);
    const res = await remindPost(makeContext(
      postReq('/api/admin/arrears-reminders', { registrationIds: ['r_unpaid', 'r_failed'], template: 'failed_payment' }, H),
      { env: env({ RESEND_API_KEY: 'k', FROM_EMAIL: 'noreply@example.com' }) },
    ) as any);
    const body = await res.json() as { results: Array<{ registrationId: string }>; skipped: Array<{ registrationId: string; reason: string }> };
    expect(body.results.map((r) => r.registrationId)).toEqual(['r_failed']);
    expect(body.skipped).toEqual([{ registrationId: 'r_unpaid', reason: 'no_failed_payment' }]);
  });

  it('validates the template and batch', async () => {
    mockGetSession.mockResolvedValue(adminSession);
    const post = (b: unknown) => remindPost(makeContext(postReq('/api/admin/arrears-reminders', b, H), { env: env() }) as any);
    expect((await post({ registrationIds: ['r_unpaid'], template: 'shouty' })).status).toBe(400);
    expect((await post({ registrationIds: [], template: 'outstanding' })).status).toBe(400);
    expect((await post({ registrationIds: Array.from({ length: 100 }, (_, i) => `r${i}`), template: 'outstanding' })).status).toBe(400);
    mockGetSession.mockResolvedValue(secretarySession);
    expect((await post({ registrationIds: ['r_unpaid'], template: 'outstanding' })).status).toBe(403);
  });
});

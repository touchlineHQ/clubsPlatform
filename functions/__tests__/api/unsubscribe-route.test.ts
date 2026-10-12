import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeContext } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  currentMarketingConsentPolicy,
  hashToken,
  latestConsentRecord,
  recordMarketingConsentGrant,
} from '../../lib/consent';
import { sendClubEmail } from '../../lib/send-guard';
import {
  applyDeliveryFeedback,
  mintUnsubscribeToken,
  UNSUBSCRIBE_SESSION_GRACE_MS,
  UNSUBSCRIBE_TOKEN_TTL_MS,
} from '../../lib/unsubscribe';
import { signSvixPayload, verifySvixSignature } from '../../lib/webhook-signature';
import { onRequestGet, onRequestPost } from '../../api/unsubscribe';
import { onRequestPost as webhookPost } from '../../api/webhooks/resend';
import type { OutboundMessage } from '../../lib/email';

const CLUB = 'test-club';
const NOW = Date.now();
const SECRET = `whsec_${btoa('test-webhook-secret-bytes')}`;

let sqlite: SqliteDb;
let d1: any;

function seed(id = 'pc1', over: { marketing?: number; state?: string } = {}) {
  sqlite.exec(`INSERT OR IGNORE INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
  sqlite.exec(`INSERT OR IGNORE INTO "player_registration"
    (id, clubSlug, playerId, teamName, ageGroup, registrationExpiry, registrationStatus, createdAt, updatedAt)
    VALUES ('r1','${CLUB}','p1','U12 Blues','U12',NULL,'Active',${NOW},${NOW})`);
  sqlite.exec(`INSERT INTO "player_contact"
    (id, clubSlug, playerId, email, relationship, state, operationalOptIn, marketingOptIn, sourcedAt)
    VALUES ('${id}','${CLUB}','p1','${id}@example.com','guardian','${over.state ?? 'confirmed'}',1,${over.marketing ?? 0},${NOW})`);
}

async function grantMarketing(id = 'pc1') {
  const policy = await currentMarketingConsentPolicy();
  await recordMarketingConsentGrant(d1, {
    clubSlug: CLUB, subjectType: 'player_contact', subjectId: id, ipAddress: null,
    policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
  });
}

function contact(id = 'pc1') {
  return sqlite.prepare(`SELECT * FROM "player_contact" WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
}
function withdrawals() {
  return sqlite.prepare(`SELECT * FROM "contact_withdrawal" ORDER BY createdAt`).all() as Array<Record<string, unknown>>;
}

const get = (token: string) =>
  onRequestGet(makeContext(new Request(`https://club.example/api/unsubscribe?token=${token}`), { env: { DB: d1 } }) as any);
const post = (token: string, body: Record<string, string>) =>
  onRequestPost(makeContext(new Request(`https://club.example/api/unsubscribe?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  }), { env: { DB: d1 } }) as any);

beforeEach(() => {
  sqlite = createSchemaDb();
  d1 = d1Over(sqlite);
  sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, createdAt) VALUES ('c1','${CLUB}','Test FC',1,${NOW})`);
});
afterEach(() => sqlite.close());

describe('sendClubEmail mints a per-recipient unsubscribe link (#135)', () => {
  it('footer carries a token URL with no address; only the hash is stored', async () => {
    seed();
    const sent: OutboundMessage[] = [];
    await sendClubEmail({}, d1, {
      clubSlug: CLUB, purpose: 'operational', audience: { type: 'club' },
      subject: 'Pitch change', html: '<p>Moved</p>', text: 'Moved',
      clubName: 'Test FC', origin: 'https://club.example/',
      mailer: { send: async (m) => { sent.push(m); return { id: 'msg_1' }; } },
    });
    expect(sent).toHaveLength(1);
    const footer = sent[0].footer;
    expect(footer.kind).toBe('operational');
    if (footer.kind === 'transactional') throw new Error('unexpected');
    expect(footer.clubName).toBe('Test FC');
    const url = new URL(footer.unsubscribeUrl);
    expect(url.origin + url.pathname).toBe('https://club.example/api/unsubscribe');
    expect(footer.unsubscribeUrl).not.toContain('example.com');
    expect(footer.unsubscribeUrl).not.toContain('pc1');
    const token = url.searchParams.get('token')!;
    const row = sqlite.prepare(`SELECT * FROM "unsubscribe_token"`).get() as Record<string, unknown>;
    expect(row.tokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.purpose).toBe('operational');
  });

  it('transactional sends through the guard link to preferences, not an unsubscribe', async () => {
    seed();
    const sent: OutboundMessage[] = [];
    await sendClubEmail({}, d1, {
      clubSlug: CLUB, purpose: 'transactional', audience: { type: 'contact', contactId: 'pc1' },
      subject: 'S', html: 'h', text: 't', clubName: 'Test FC', origin: 'https://club.example',
      mailer: { send: async (m) => { sent.push(m); return {}; } },
    });
    expect(sent[0].footer.kind).toBe('transactional');
    expect(sent[0].footer).toHaveProperty('preferencesUrl');
  });
});

describe('/api/unsubscribe', () => {
  it('GET shows the choices and changes nothing', async () => {
    seed('pc1', { marketing: 1 });
    await grantMarketing();
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'marketing', batchId: 'b1' });
    const res = await get(token);
    const html = await res.text();
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(html).toContain('Test FC');
    expect(html).toContain('club news and offers (marketing)');
    expect(html).toContain('value="marketing"');
    expect(html).toContain('value="all"');
    expect(html).toContain('value="purge"');
    expect(html).not.toContain('pc1@example.com');
    expect(contact()!.marketingOptIn).toBe(1);
    expect(withdrawals()).toHaveLength(0);
  });

  it('RFC 8058 one-click on marketing mail withdraws marketing only, effective on the next send', async () => {
    seed('pc1', { marketing: 1 });
    await grantMarketing();
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'marketing', batchId: 'b1' });
    const res = await post(token, { 'List-Unsubscribe': 'One-Click' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Unsubscribed');
    expect(contact()!.marketingOptIn).toBe(0);
    expect(contact()!.state).toBe('confirmed');
    expect((await latestConsentRecord(d1, { clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc1' }))!.state).toBe('withdrawn');
    const audit = withdrawals();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ scope: 'marketing', source: 'one_click', purpose: 'marketing', batchId: 'b1', contactId: 'pc1' });
    expect(JSON.stringify(audit)).not.toContain('@');

    const next = await sendClubEmail({}, d1, {
      clubSlug: CLUB, purpose: 'marketing', audience: { type: 'club' },
      subject: 'Shop', html: 'h', text: 't', clubName: 'Test FC', origin: 'https://club.example',
      mailer: { send: vi.fn(async () => ({})) },
    });
    expect(next.dropped[0]?.dropReason).toBe('missing_marketing_consent');
  });

  it('one-click on operational mail stops all club mail', async () => {
    seed();
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'operational', batchId: 'b2' });
    await post(token, { 'List-Unsubscribe': 'One-Click' });
    expect(contact()).toMatchObject({ state: 'withdrawn', operationalOptIn: 0, marketingOptIn: 0 });
    const op = await latestConsentRecord(d1, { clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc1', purpose: 'operational' });
    expect(op?.state).toBe('withdrawn');
    const next = await sendClubEmail({}, d1, {
      clubSlug: CLUB, purpose: 'operational', audience: { type: 'club' },
      subject: 'S', html: 'h', text: 't', clubName: 'Test FC', origin: 'https://club.example',
      mailer: { send: vi.fn(async () => ({})) },
    });
    expect(next.dropped[0]?.dropReason).toBe('withdrawn');
  });

  it('form action "all" from the page, then the page reflects it', async () => {
    seed('pc1', { marketing: 1 });
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'marketing', batchId: null });
    const html = await (await post(token, { action: 'all' })).text();
    expect(html).toContain("won't get any more email");
    expect(contact()!.state).toBe('withdrawn');
    expect(withdrawals()[0]).toMatchObject({ scope: 'all', source: 'link' });
  });

  it('purge removes the address via #134 and leaves an address-free audit row', async () => {
    seed();
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'operational', batchId: 'b3' });
    const html = await (await post(token, { action: 'purge' })).text();
    expect(html).toContain('has been removed');
    expect(contact()).toBeUndefined();
    const sup = sqlite.prepare(`SELECT COUNT(*) AS n FROM "contact_email_suppression"`).get() as { n: number };
    expect(sup.n).toBe(1);
    expect(withdrawals()[0]).toMatchObject({ scope: 'purge', batchId: 'b3' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM "unsubscribe_token"`).get()).toEqual({ n: 0 });
    // A second visit with the same link still lands on a working page.
    expect((await get(token)).status).toBe(200);
  });

  it('an expired link still opens the page and can withdraw, but cannot purge', async () => {
    seed('pc1', { marketing: 1 });
    const token = await mintUnsubscribeToken(d1, {
      clubSlug: CLUB, contactId: 'pc1', purpose: 'marketing', batchId: null,
      now: NOW - UNSUBSCRIBE_TOKEN_TTL_MS - 1000,
    });
    const page = await (await get(token)).text();
    expect(page).toContain('value="marketing"');
    expect(page).not.toContain('value="purge"');
    expect(page).toContain('more recent email');
    const refused = await (await post(token, { action: 'purge' })).text();
    expect(refused).toContain('too old');
    expect(contact()).toBeDefined();
    await post(token, { action: 'marketing' });
    expect(contact()!.marketingOptIn).toBe(0);
  });

  it('a used link allows purge in the same visit, then is spent for purge', async () => {
    seed('pc1', { marketing: 1 });
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'marketing', batchId: null });
    const after = await (await post(token, { action: 'marketing' })).text();
    expect(after).toContain('value="purge"');
    sqlite.exec(`UPDATE "unsubscribe_token" SET usedAt = ${NOW - UNSUBSCRIBE_SESSION_GRACE_MS - 1}`);
    expect(await (await get(token)).text()).not.toContain('value="purge"');
  });

  it('unknown tokens get the generic page and a quiet POST', async () => {
    const res = await get('f'.repeat(64));
    expect(await res.text()).toContain('Unsubscribe from marketing emails');
    const p = await post('f'.repeat(64), {});
    expect(await p.json()).toEqual({ ok: true, withdrawn: false });
    expect((await get('')).status).toBe(400);
    expect((await post('', {})).status).toBe(400);
  });

  it('a POST with no action just re-renders the page', async () => {
    seed();
    const token = await mintUnsubscribeToken(d1, { clubSlug: CLUB, contactId: 'pc1', purpose: 'operational', batchId: null });
    expect(await (await post(token, { action: 'bogus' })).text()).toContain('value="all"');
    expect(withdrawals()).toHaveLength(0);
  });

  it('legacy consent-record tokens still withdraw marketing', async () => {
    seed('pc1', { marketing: 1 });
    const policy = await currentMarketingConsentPolicy();
    const { withdrawToken } = await recordMarketingConsentGrant(d1, {
      clubSlug: CLUB, subjectType: 'player_contact', subjectId: 'pc1', ipAddress: null,
      policy: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
    });
    expect(await (await post(withdrawToken, {})).json()).toEqual({ ok: true, withdrawn: true });
    expect(contact()!.marketingOptIn).toBe(0);
  });
});

describe('Resend webhook: bounces and complaints', () => {
  async function signed(body: unknown, ts = Math.floor(Date.now() / 1000)) {
    const raw = JSON.stringify(body);
    const sig = await signSvixPayload(SECRET, 'msg_x', String(ts), raw);
    return new Request('https://club.example/api/webhooks/resend', {
      method: 'POST',
      headers: { 'svix-id': 'msg_x', 'svix-timestamp': String(ts), 'svix-signature': `v1,${sig}` },
      body: raw,
    });
  }
  const call = (req: Request, env: Record<string, unknown> = { RESEND_WEBHOOK_SECRET: SECRET }) =>
    webhookPost(makeContext(req, { env: { DB: d1, ...env } }) as any);

  function seedSent(providerId = 'em_1') {
    seed();
    sqlite.exec(`INSERT INTO "email_send_event"
      (id, clubSlug, batchId, purpose, contactId, outcome, audienceType, providerMessageId, createdAt)
      VALUES ('e1','${CLUB}','b9','operational','pc1','sent','club','${providerId}',${NOW})`);
  }

  it('rejects unsigned, stale or unconfigured requests', async () => {
    seedSent();
    const body = { type: 'email.bounced', data: { email_id: 'em_1' } };
    expect((await call(await signed(body), {})).status).toBe(503);
    const bad = await signed(body);
    bad.headers.set('svix-signature', 'v1,AAAA');
    expect((await call(bad)).status).toBe(401);
    expect((await call(await signed(body, Math.floor(Date.now() / 1000) - 3600))).status).toBe(401);
    expect(contact()!.state).toBe('confirmed');
  });

  it('a hard bounce marks the contact bounced', async () => {
    seedSent();
    const res = await call(await signed({ type: 'email.bounced', data: { email_id: 'em_1', bounce: { type: 'Permanent' } } }));
    expect(res.status).toBe(200);
    expect(contact()!.state).toBe('bounced');
    expect(withdrawals()[0]).toMatchObject({ scope: 'bounce', source: 'bounce', batchId: 'b9' });
  });

  it('a transient bounce is ignored', async () => {
    seedSent();
    await call(await signed({ type: 'email.bounced', data: { email_id: 'em_1', bounce: { type: 'Transient' } } }));
    expect(contact()!.state).toBe('confirmed');
  });

  it('a spam complaint is recorded as a withdrawal of all club mail', async () => {
    seedSent();
    await call(await signed({ type: 'email.complained', data: { email_id: 'em_1' } }));
    expect(contact()!.state).toBe('withdrawn');
    expect(withdrawals()[0]).toMatchObject({ scope: 'all', source: 'complaint' });
  });

  it('unknown message ids, other events and bad JSON are handled quietly', async () => {
    expect((await call(await signed({ type: 'email.bounced', data: { email_id: 'nope' } }))).status).toBe(200);
    expect((await call(await signed({ type: 'email.delivered', data: { email_id: 'x' } }))).status).toBe(200);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = await signSvixPayload(SECRET, 'i', ts, '{oops');
    const req = new Request('https://club.example/api/webhooks/resend', {
      method: 'POST', headers: { 'svix-id': 'i', 'svix-timestamp': ts, 'svix-signature': `v1,${sig}` }, body: '{oops',
    });
    expect((await call(req)).status).toBe(400);
    expect(await applyDeliveryFeedback(d1, { providerMessageId: 'none', kind: 'bounce' })).toBeNull();
  });

  it('verifySvixSignature rejects missing headers', async () => {
    expect(await verifySvixSignature(SECRET, new Headers(), '{}')).toBe(false);
  });
});

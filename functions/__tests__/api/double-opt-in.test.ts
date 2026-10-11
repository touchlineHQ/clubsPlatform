import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeContext, adminSession, getReq, postReq } from '../test-utils';
import { createSchemaDb, d1Over, type SqliteDb } from '../sqlite-harness';
import {
  EMAIL_SIGNOFF_LIABILITIES,
  EMAIL_SIGNOFF_POLICY_VERSION,
  hashWording,
} from '../../lib/club-email-signoff';
import { hashToken } from '../../lib/consent';
import { askParentForContactConsent } from '../../lib/parent-consent';

const mockGetSession = vi.hoisted(() => vi.fn());
vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession: mockGetSession } })),
}));

import { onRequestPost as adminContactsPost } from '../../api/admin/player-contacts';
import { onRequestPost as activationMailPost } from '../../api/admin/activation-mail';
import { onRequestGet as listRegistrations } from '../../api/admin/registrations';
import {
  onRequestGet as formGet,
  onRequestPost as formPost,
} from '../../api/consent/form';
import { onRequestPost as resendPost } from '../../api/consent/resend';
import {
  ACTIVATION_BATCH_LIMIT,
  ACTIVATION_REMINDER_AFTER_MS,
  RESEND_COOLDOWN_MS,
} from '../../lib/activation-mail';
import { PENDING_RETENTION_MS } from '../../lib/contact-purge';

const NOW = Date.now();
const CLUB = 'test-club';
const DAY = 24 * 60 * 60 * 1000;
const MAIL_ENV = { RESEND_API_KEY: 'k', FROM_EMAIL: 'club@mail.example' };

async function seedSignoff(db: SqliteDb) {
  for (const liability of Object.values(EMAIL_SIGNOFF_LIABILITIES)) {
    const hash = await hashWording(liability.wording);
    db.exec(`INSERT INTO "club_email_signoff"
      (id, acceptanceId, clubSlug, liability, userId, acceptedAt, ipAddress, policyVersion, wordingHash)
      VALUES ('${liability.id}_r','emsign_1','${CLUB}','${liability.id}','admin_1',${NOW},NULL,
              '${EMAIL_SIGNOFF_POLICY_VERSION}','${hash}')`);
  }
}

/** Insert a pending contact the way the import does: no token, no mail yet. */
function importContact(db: SqliteDb, n: number, extra: Record<string, unknown> = {}) {
  const fan = `FAN${String(n).padStart(3, '0')}`;
  db.exec(`INSERT OR IGNORE INTO "player" VALUES ('p${n}','${fan}',${NOW},${NOW})`);
  db.exec(`INSERT OR IGNORE INTO "player_registration" VALUES
    ('r${n}','${CLUB}','p${n}','Under 12s','U12','2027-07-31','Active',${NOW},${NOW})`);
  db.exec(`INSERT INTO "player_contact"
    (id, clubSlug, playerId, email, relationship, state, sourcedAt, activationSentAt, reminderSentAt, activationTokenHash, activationExpiresAt)
    VALUES ('pc${n}','${CLUB}','p${n}','parent${n}@example.com','guardian','${extra.state ?? 'pending'}',
            ${extra.sourcedAt ?? NOW},${extra.activationSentAt ?? 'NULL'},${extra.reminderSentAt ?? 'NULL'},
            ${extra.hash ? `'${extra.hash}'` : 'NULL'},${extra.expiresAt ?? 'NULL'})`);
  return fan;
}

describe('double opt-in (#132)', () => {
  let sqlite: SqliteDb;
  let d1: any;
  let sent: Array<{ to: string[]; subject: string; html: string; text: string }>;
  let failMail: boolean;

  beforeEach(async () => {
    sqlite = createSchemaDb();
    d1 = d1Over(sqlite);
    sqlite.exec(`INSERT INTO "club_config" (id, slug, name, active, published, createdAt, data)
      VALUES ('club_1','${CLUB}','Test FC',1,1,${NOW},'{"email":"sec@test.example"}')`);
    await seedSignoff(sqlite);
    mockGetSession.mockResolvedValue(adminSession);
    sent = [];
    failMail = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      if (failMail) return new Response('boom', { status: 500 });
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'm1' }), { status: 200 });
    }));
  });

  afterEach(() => {
    sqlite.close();
    vi.unstubAllGlobals();
  });

  const sendBatch = (env: Record<string, unknown> = MAIL_ENV) =>
    activationMailPost(makeContext(
      postReq('/api/admin/activation-mail', { action: 'send' }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1, ...env } },
    ) as any);
  const sweep = () =>
    activationMailPost(makeContext(
      postReq('/api/admin/activation-mail', { action: 'sweep' }, { 'X-Club-Slug': CLUB }),
      { env: { DB: d1, ...MAIL_ENV } },
    ) as any);
  const tokenOf = (body: string) => /consent\/([0-9a-f]{64})/.exec(body)![1];

  // ─── Activation mail ──────────────────────────────────────────────────────

  describe('activation mail', () => {
    it('sends one activation mail per pending contact with a hashed single token, once', async () => {
      importContact(sqlite, 1);
      importContact(sqlite, 2);

      const res = await sendBatch();
      expect(await res.json()).toEqual({ configured: true, sent: 2, failed: 0, remaining: 0 });
      expect(sent.map((m) => m.to[0]).sort()).toEqual(['parent1@example.com', 'parent2@example.com']);
      expect(sent[0].subject).toMatch(/Activate your contact details for Test FC/);
      expect(sent[0].text).toMatch(/FAN FAN00[12] \(Under 12s\)/);
      expect(sent[0].text).toContain('/decline');
      expect(sent[0].text).not.toMatch(/Dear|name/i);

      // Token hashed at rest; the plaintext only exists in the mail.
      const token = tokenOf(sent.find((m) => m.to[0] === 'parent1@example.com')!.text);
      const row = sqlite.prepare(`SELECT * FROM "player_contact" WHERE id='pc1'`).get() as any;
      expect(row.activationTokenHash).toBe(await hashToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
      expect(row.state).toBe('pending');
      expect(row.activationSentAt).toBeGreaterThan(0);
      expect(row.activationExpiresAt).toBeGreaterThan(Date.now());
      expect(row.operationalOptIn).toBe(0);

      // Nothing else is sent: a second batch has nothing to do.
      sent.length = 0;
      expect(await (await sendBatch()).json()).toEqual({ configured: true, sent: 0, failed: 0, remaining: 0 });
      expect(sent).toHaveLength(0);
    });

    it('two overlapping batches mail a contact once and leave its link intact', async () => {
      importContact(sqlite, 1);
      await Promise.all([sendBatch(), sendBatch()]);
      expect(sent).toHaveLength(1);
      const token = tokenOf(sent[0].text);
      const row = sqlite.prepare(`SELECT activationTokenHash AS h FROM "player_contact"`).get() as any;
      expect(row.h).toBe(await hashToken(token));
    });

    it('never mails confirmed, withdrawn or bounced contacts', async () => {
      importContact(sqlite, 1, { state: 'confirmed' });
      importContact(sqlite, 2, { state: 'withdrawn' });
      importContact(sqlite, 3, { state: 'bounced' });
      expect(await (await sendBatch()).json()).toMatchObject({ sent: 0 });
      expect(sent).toHaveLength(0);
    });

    it('caps a batch so it stays under the D1 query limit and reports what remains', async () => {
      const total = ACTIVATION_BATCH_LIMIT + 3;
      for (let i = 1; i <= total; i++) importContact(sqlite, i);
      const first = await (await sendBatch()).json() as any;
      expect(first.sent).toBe(ACTIVATION_BATCH_LIMIT);
      expect(first.remaining).toBe(3);
      const second = await (await sendBatch()).json() as any;
      expect(second).toMatchObject({ sent: 3, remaining: 0 });
    });

    it('counts a provider failure, does not 500, and retries those contacts next time', async () => {
      importContact(sqlite, 1);
      failMail = true;
      const res = await sendBatch();
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ sent: 0, failed: 1 });
      expect((sqlite.prepare(`SELECT activationSentAt AS s FROM "player_contact"`).get() as any).s).toBeNull();

      failMail = false;
      expect(await (await sendBatch()).json()).toMatchObject({ sent: 1, failed: 0 });
    });

    it('does nothing and stamps nothing when no provider is configured', async () => {
      importContact(sqlite, 1);
      const res = await sendBatch({});
      expect(await res.json()).toEqual({ configured: false, sent: 0, failed: 0, remaining: 0 });
      expect((sqlite.prepare(`SELECT activationSentAt AS s FROM "player_contact"`).get() as any).s).toBeNull();
    });

    it('records an address-free audit row', async () => {
      importContact(sqlite, 1);
      await sendBatch();
      const audit = sqlite.prepare(`SELECT * FROM "admin_audit_log" WHERE action='activation_mail_sent'`).all();
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain('parent1@example.com');
    });

    it('requires an admin and a valid action', async () => {
      mockGetSession.mockResolvedValue(null);
      expect((await sendBatch()).status).toBe(401);
      mockGetSession.mockResolvedValue(adminSession);
      const bad = await activationMailPost(makeContext(
        postReq('/api/admin/activation-mail', { action: 'nuke' }, { 'X-Club-Slug': CLUB }),
        { env: { DB: d1, ...MAIL_ENV } },
      ) as any);
      expect(bad.status).toBe(400);
    });

    it('admin "create link" also mails the parent, and a failure still returns the link', async () => {
      sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
      const post = (email: string) => adminContactsPost(makeContext(
        postReq('/api/admin/player-contacts', { fanId: 'FAN001', email }, { 'X-Club-Slug': CLUB }),
        { env: { DB: d1, ...MAIL_ENV } },
      ) as any);

      const ok = await post('a@example.com');
      expect(ok.status).toBe(201);
      expect(await ok.json()).toMatchObject({ emailed: 'sent' });
      expect(sent).toHaveLength(1);
      expect(tokenOf(sent[0].text)).toBeTruthy();
      expect((sqlite.prepare(`SELECT activationSentAt AS s FROM "player_contact"`).get() as any).s).toBeGreaterThan(0);

      failMail = true;
      const bad = await post('b@example.com');
      expect(bad.status).toBe(201);
      const body = await bad.json() as any;
      expect(body.emailed).toBe('failed');
      expect(body.token).toBeTruthy();
    });
  });

  // ─── Activation page + tokens ─────────────────────────────────────────────

  describe('activation links', () => {
    async function mailedToken(n = 1) {
      importContact(sqlite, n);
      await sendBatch();
      return tokenOf(sent.find((m) => m.to[0] === `parent${n}@example.com`)!.text);
    }
    const get = (token: string) => formGet(makeContext(
      getReq(`/api/consent/form?token=${token}`), { env: { DB: d1 } }) as any);
    const post = (body: unknown) => formPost(makeContext(
      postReq('/api/consent/form', body), { env: { DB: d1 } }) as any);

    it('shows club, FAN and team (not a name) for a live token', async () => {
      const token = await mailedToken();
      const res = await get(token);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.contact).toMatchObject({ fanId: 'FAN001', teamName: 'Under 12s', state: 'pending' });
      expect(body.club.name).toBe('Test FC');
    });

    it('answers unknown, expired, spent and declined tokens identically', async () => {
      const spent = await mailedToken(1);
      const declined = await mailedToken(2);
      const expired = await mailedToken(3);
      sqlite.exec(`UPDATE "player_contact" SET activationExpiresAt = ${Date.now() - 1000} WHERE id='pc3'`);

      // Activate #1 (spent), decline #2.
      const policyBody = await (await get(spent)).json() as any;
      const act = await post({
        action: 'submit', token: spent, email: 'parent1@example.com', operationalAgreed: true,
        operational: { policyVersion: policyBody.operational.policyVersion, wordingHash: policyBody.operational.wordingHash },
        marketingOptIn: false,
      });
      expect(act.status).toBe(200);
      expect((await post({ action: 'decline', token: declined })).status).toBe(200);

      const unknown = 'f'.repeat(64);
      const responses = [];
      for (const t of [unknown, expired, spent, declined]) {
        const g = await get(t);
        const p = await post({ action: 'submit', token: t, email: 'x@example.com', operationalAgreed: true,
          operational: { policyVersion: '1', wordingHash: 'x' }, marketingOptIn: false });
        // An expired-but-unspent link can still be declined: honouring an
        // objection never depends on the link being fresh.
        responses.push(t === expired ? [g, p] : [g, p, await post({ action: 'decline', token: t })]);
      }
      const shape = async (r: Response) => [r.status, await r.text()];
      const reference = await Promise.all(responses[0].map(shape));
      for (const set of responses.slice(1)) {
        expect(await Promise.all(set.map(shape))).toEqual(reference.slice(0, set.length));
      }
      expect(reference.every(([status]) => status === 404)).toBe(true);
    });

    it('activation records timestamp, IP, policy version and wording hash; marketing stays off unless ticked', async () => {
      const token = await mailedToken();
      const policy = (await (await get(token)).json() as any).operational;
      const res = await formPost(makeContext(
        new Request('http://localhost/api/consent/form', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9' },
          body: JSON.stringify({
            action: 'submit', token, email: 'parent1@example.com', operationalAgreed: true,
            operational: { policyVersion: policy.policyVersion, wordingHash: policy.wordingHash },
            marketingOptIn: false,
          }),
        }),
        { env: { DB: d1 } },
      ) as any);
      expect(res.status).toBe(200);
      const contact = sqlite.prepare(`SELECT state, operationalOptIn, marketingOptIn, confirmedAt FROM "player_contact"`).get() as any;
      expect(contact).toMatchObject({ state: 'confirmed', operationalOptIn: 1, marketingOptIn: 0 });
      expect(contact.confirmedAt).toBeGreaterThan(0);
      const records = sqlite.prepare(`SELECT purpose, ipAddress, policyVersion, wordingHash FROM "consent_record"`).all() as any[];
      expect(records).toEqual([{
        purpose: 'operational', ipAddress: '203.0.113.9',
        policyVersion: policy.policyVersion, wordingHash: policy.wordingHash,
      }]);
    });

    it('a parent can decline from the email: withdrawn, token dropped, club-visible, no address in audit', async () => {
      const token = await mailedToken();
      const res = await post({ action: 'decline', token });
      expect(res.status).toBe(200);
      const row = sqlite.prepare(`SELECT state, operationalOptIn, marketingOptIn, activationTokenHash FROM "player_contact"`).get() as any;
      expect(row).toEqual({ state: 'withdrawn', operationalOptIn: 0, marketingOptIn: 0, activationTokenHash: null });
      const audit = sqlite.prepare(`SELECT * FROM "admin_audit_log" WHERE action='contact_declined_by_parent'`).all();
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain('parent1@example.com');
      // And the declined state is what the admin sees.
      const reg = await listRegistrations(makeContext(
        getReq('/api/admin/registrations', { 'X-Club-Slug': CLUB }), { env: { DB: d1 } }) as any);
      expect((await reg.json() as any).rows[0].contactState).toBe('withdrawn');
    });
  });

  // ─── Fresh link ───────────────────────────────────────────────────────────

  describe('fresh link request', () => {
    it('lets an expired but unspent link still be declined', async () => {
      importContact(sqlite, 1, { hash: await hashToken('old'), expiresAt: Date.now() - 1000, activationSentAt: NOW - 40 * DAY });
      const res = await formPost(makeContext(
        postReq('/api/consent/form', { action: 'decline', token: 'old' }), { env: { DB: d1 } }) as any);
      expect(res.status).toBe(200);
    });

    async function resend(token: string) {
      const pending: Promise<unknown>[] = [];
      const started = Date.now();
      const res = await resendPost(makeContext(
        postReq('/api/consent/resend', { token }),
        { env: { DB: d1, ...MAIL_ENV }, waitUntil: (p) => { pending.push(p); } },
      ) as any);
      const elapsed = Date.now() - started;
      await Promise.all(pending);
      return { res, body: await res.text(), elapsed };
    }

    it('gives the same 202 for unknown, spent and live tokens, and mails only for a live one', async () => {
      importContact(sqlite, 1, { hash: await hashToken('live'), expiresAt: Date.now() - 1000, activationSentAt: NOW - 10 * DAY });
      importContact(sqlite, 2, { state: 'confirmed', hash: await hashToken('spent'), activationSentAt: NOW - 10 * DAY });

      const unknown = await resend('nope');
      const spent = await resend('spent');
      expect(sent).toHaveLength(0);
      const live = await resend('live');

      for (const r of [unknown, spent, live]) expect(r.res.status).toBe(202);
      expect(spent.body).toBe(unknown.body);
      expect(live.body).toBe(unknown.body);
      expect(sent).toHaveLength(1);
      expect(sent[0].to[0]).toBe('parent1@example.com');

      // The new link works; the lost one no longer does.
      const fresh = tokenOf(sent[0].text);
      expect((await formGet(makeContext(getReq(`/api/consent/form?token=${fresh}`), { env: { DB: d1 } }) as any)).status).toBe(200);
      expect((await formGet(makeContext(getReq('/api/consent/form?token=live'), { env: { DB: d1 } }) as any)).status).toBe(404);
    });

    it('a failed resend or reminder leaves the link the parent already holds working', async () => {
      importContact(sqlite, 1, { hash: await hashToken('held'), expiresAt: NOW + DAY, activationSentAt: NOW - 20 * DAY });
      failMail = true;
      await resend('held');
      await sweep(); // 20 days after the mail: a reminder is due, and fails too
      const row = sqlite.prepare(`SELECT activationTokenHash AS h, activationSentAt AS s, reminderSentAt AS r FROM "player_contact"`).get() as any;
      expect(row.h).toBe(await hashToken('held'));
      expect(row.s).toBe(NOW - 20 * DAY);
      expect(row.r).toBeNull();
      expect((await formGet(makeContext(getReq('/api/consent/form?token=held'), { env: { DB: d1 } }) as any)).status).toBe(200);
    });

    it('the decline page can open an expired link; activation cannot', async () => {
      importContact(sqlite, 1, { hash: await hashToken('old'), expiresAt: NOW - 1000, activationSentAt: NOW - 40 * DAY });
      const get = (q: string) => formGet(makeContext(getReq(`/api/consent/form?token=old${q}`), { env: { DB: d1 } }) as any);
      expect((await get('')).status).toBe(404);
      expect((await get('&mode=decline')).status).toBe(200);
    });

    it('rate-limits repeated requests per contact', async () => {
      importContact(sqlite, 1, { hash: await hashToken('live'), activationSentAt: Date.now() - RESEND_COOLDOWN_MS - 1000 });
      expect((await resend('live')).res.status).toBe(202);
      expect(sent).toHaveLength(1);
      // The token was rotated and just stamped, so a replay of either does nothing.
      await resend('live');
      await resend(tokenOf(sent[0].text));
      expect(sent).toHaveLength(1);
    });

    it('is a 202 even for a malformed body', async () => {
      const res = await resendPost(makeContext(
        new Request('http://localhost/api/consent/resend', { method: 'POST', body: 'not json' }),
        { env: { DB: d1, ...MAIL_ENV } },
      ) as any);
      expect(res.status).toBe(202);
    });
  });

  // ─── Reminder + expiry ────────────────────────────────────────────────────

  describe('unactivated contacts', () => {
    it('sends exactly one reminder after 14 days, then none', async () => {
      importContact(sqlite, 1, { activationSentAt: NOW - ACTIVATION_REMINDER_AFTER_MS - 1000 });
      importContact(sqlite, 2, { activationSentAt: NOW - DAY });

      const first = await (await sweep()).json() as any;
      expect(first.reminders).toMatchObject({ sent: 1, failed: 0 });
      expect(sent).toHaveLength(1);
      expect(sent[0].subject).toMatch(/^Reminder:/);
      expect(sent[0].to[0]).toBe('parent1@example.com');

      sent.length = 0;
      const second = await (await sweep()).json() as any;
      expect(second.reminders.sent).toBe(0);
      expect(sent).toHaveLength(0);
    });

    it('deletes pending contacts after the retention period, without suppressing, and tells the club how many', async () => {
      importContact(sqlite, 1, { activationSentAt: NOW - PENDING_RETENTION_MS - DAY, reminderSentAt: NOW - 16 * DAY });
      importContact(sqlite, 2, { activationSentAt: NOW - PENDING_RETENTION_MS - DAY, reminderSentAt: NOW - 16 * DAY });
      importContact(sqlite, 3, { activationSentAt: NOW - 5 * DAY });
      importContact(sqlite, 4, { state: 'confirmed', activationSentAt: NOW - PENDING_RETENTION_MS - DAY });

      const body = await (await sweep()).json() as any;
      expect(body.lapsed).toBe(2);
      const left = sqlite.prepare(`SELECT id FROM "player_contact" ORDER BY id`).all() as any[];
      expect(left.map((r) => r.id)).toEqual(['pc3', 'pc4']);
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM "contact_email_suppression"`).get()).toEqual({ n: 0 });
      const audit = sqlite.prepare(`SELECT * FROM "admin_audit_log" WHERE action='contact_lapsed_unactivated'`).all();
      expect(audit).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain('@example.com');
      // The player and registration survive.
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_registration"`).get()).toEqual({ n: 4 });
    });

    it('does not delete a contact that was never mailed (the clock starts when the parent is asked)', async () => {
      importContact(sqlite, 1, { sourcedAt: NOW - 90 * DAY });
      expect((await (await sweep()).json() as any).lapsed).toBe(0);
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM "player_contact"`).get()).toEqual({ n: 1 });
    });
  });

  // ─── Admin view ───────────────────────────────────────────────────────────

  it('registrations show the best contact state per player, and null when none is held', async () => {
    importContact(sqlite, 1, { state: 'pending' });
    importContact(sqlite, 2, { state: 'confirmed' });
    sqlite.exec(`INSERT INTO "player" VALUES ('p3','FAN003',${NOW},${NOW})`);
    sqlite.exec(`INSERT INTO "player_registration" VALUES ('r3','${CLUB}','p3','Under 12s','U12','2027-07-31','Active',${NOW},${NOW})`);
    // A second, withdrawn address must not mask the confirmed one.
    sqlite.exec(`INSERT INTO "player_contact" (id, clubSlug, playerId, email, relationship, state, sourcedAt)
      VALUES ('pcx','${CLUB}','p2','other@example.com','guardian','withdrawn',${NOW})`);

    const res = await listRegistrations(makeContext(
      getReq('/api/admin/registrations', { 'X-Club-Slug': CLUB }), { env: { DB: d1 } }) as any);
    const rows = (await res.json() as any).rows as Array<{ fanId: string; contactState: string | null }>;
    const byFan = Object.fromEntries(rows.map((r) => [r.fanId, r.contactState]));
    expect(byFan).toEqual({ FAN001: 'pending', FAN002: 'confirmed', FAN003: null });
    expect(JSON.stringify(rows)).not.toContain('@example.com');
  });

  it('askParentForContactConsent still refuses without sign-off (activation never bypasses #130)', async () => {
    sqlite.exec(`DELETE FROM "club_email_signoff"`);
    sqlite.exec(`INSERT INTO "player" VALUES ('p1','FAN001',${NOW},${NOW})`);
    await expect(askParentForContactConsent(d1, {
      clubSlug: CLUB, fanId: 'FAN001', email: 'a@example.com', sourcedBy: 'admin_1',
    })).rejects.toMatchObject({ code: 'no_signoff' });
  });
});

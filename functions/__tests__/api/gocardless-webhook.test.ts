import { vi, describe, it, expect, beforeEach } from 'vitest';
import { makeContext, makeDb, makeEnv } from '../test-utils';

vi.mock('../../lib/secrets', () => ({
  decryptSecret: vi.fn(async (_env: unknown, encryptedValue: string) => encryptedValue),
}));

vi.mock('../../lib/posthog', () => ({
  getPostHog: vi.fn(() => null),
}));

import { onRequestPost as webhookOnRequestPost } from '../../api/gocardless/webhook';

const TEST_SECRET = 'whsec_test_value';

async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const bytes = new Uint8Array(sig);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

function makeWebhookReq(body: string, signature: string | null): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (signature !== null) headers['Webhook-Signature'] = signature;
  return new Request('https://example.com/api/gocardless/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function makeWebhookDb(opts: {
  secretRows?: Array<{ encryptedValue: string; iv: string }>;
  existingEventIds?: string[];
} = {}) {
  const secretRows = opts.secretRows ?? [{ encryptedValue: TEST_SECRET, iv: 'iv1' }];
  const existingEventIds = new Set(opts.existingEventIds ?? []);
  const updateCalls: Array<{ sql: string; binds: unknown[] }> = [];
  const insertCalls: Array<{ binds: unknown[] }> = [];

  const db = {
    exec: vi.fn(async () => ({ results: [], count: 0, duration: 0 })),
    prepare: vi.fn((sql: string) => {
      const handlers = {
        all: async () => ({ results: secretRows, success: true, meta: {} }),
        first: async (binds: unknown[] = []) => {
          if (sql.includes('FROM "gc_webhook_event"')) {
            const id = String(binds[0] ?? '');
            return existingEventIds.has(id) ? { id } : null;
          }
          return null;
        },
        run: async (binds: unknown[] = []) => {
          if (sql.startsWith('UPDATE "player_payment"')) {
            updateCalls.push({ sql, binds });
          }
          if (sql.startsWith('INSERT OR IGNORE INTO "gc_webhook_event"')) {
            insertCalls.push({ binds });
            existingEventIds.add(String(binds[0] ?? ''));
          }
          return { results: [], success: true, meta: { changes: 1 } };
        },
      };
      return {
        all: handlers.all,
        first: handlers.first,
        run: handlers.run,
        bind: (...binds: unknown[]) => ({
          all: handlers.all,
          first: () => handlers.first(binds),
          run: () => handlers.run(binds),
        }),
      };
    }),
  };

  return { db, updateCalls, insertCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/gocardless/webhook', () => {
  it('returns 401 when Webhook-Signature header is missing', async () => {
    const body = JSON.stringify({ events: [] });
    const { db } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(makeWebhookReq(body, null), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature does not match', async () => {
    const body = JSON.stringify({ events: [] });
    const { db } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const ctx = makeContext(makeWebhookReq(body, 'deadbeef'.repeat(8)), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 401 when no GC_WEBHOOK_SECRET is configured', async () => {
    const body = JSON.stringify({ events: [] });
    const { db } = makeWebhookDb({ secretRows: [] });
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(401);
  });

  it('returns 204 and ignores empty events list when signature is valid', async () => {
    const body = JSON.stringify({ events: [] });
    const { db } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
  });

  it('marks player_payment inactive when a mandates.cancelled event arrives', async () => {
    const body = JSON.stringify({
      events: [
        {
          id: 'EV-mandate-1',
          resource_type: 'mandates',
          action: 'cancelled',
          links: { mandate: 'MND-1' },
        },
      ],
    });
    const { db, updateCalls, insertCalls } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
    // UPDATE player_payment SET status = 'inactive' WHERE mandateId = 'MND-1'
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].binds).toEqual(expect.arrayContaining(['inactive', 'MND-1']));
    // event id recorded for idempotency
    expect(insertCalls.length).toBe(1);
    expect(insertCalls[0].binds[0]).toBe('EV-mandate-1');
  });

  it('marks player_payment inactive when a subscriptions.cancelled event arrives', async () => {
    const body = JSON.stringify({
      events: [
        {
          id: 'EV-sub-1',
          resource_type: 'subscriptions',
          action: 'cancelled',
          links: { subscription: 'SUB-1' },
        },
      ],
    });
    const { db, updateCalls } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].binds).toEqual(expect.arrayContaining(['SUB-1']));
  });

  it('marks player_payment completed when a subscriptions.finished event arrives', async () => {
    // 'finished' is GoCardless saying the count-limited plan collected every
    // payment it was created with, i.e. the player has paid in full. Sharing
    // 'inactive' with a genuine cancellation is what badged them "Cancelled".
    const body = JSON.stringify({
      events: [
        {
          id: 'EV-sub-done',
          resource_type: 'subscriptions',
          action: 'finished',
          links: { subscription: 'SUB-DONE' },
        },
      ],
    });
    const { db, updateCalls } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].binds).toEqual(expect.arrayContaining(['completed', 'SUB-DONE']));
    expect(updateCalls[0].binds).not.toContain('inactive');
  });

  it.each([
    ['mandates', 'cancelled', { mandate: 'MND-1' }],
    ['mandates', 'expired', { mandate: 'MND-1' }],
    ['mandates', 'consumed', { mandate: 'MND-1' }],
    ['subscriptions', 'cancelled', { subscription: 'SUB-1' }],
  ])('guards a paid-in-full row against %s.%s', async (resourceType, action, links) => {
    // A payer who has finished their plan normally cancels the Direct Debit
    // afterwards. That must not undo "paid in full".
    const body = JSON.stringify({
      events: [{ id: `EV-${resourceType}-${action}`, resource_type: resourceType, action, links }],
    });
    const { db, updateCalls } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    await webhookOnRequestPost(ctx as any);
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].sql).toContain(`status NOT IN ('completed', 'manual')`);
    // 'inactive' stays reachable: GoCardless does not order its events, so a
    // mandates.consumed landing first must still be able to reach 'completed'.
    expect(updateCalls[0].sql).not.toContain(`'inactive'`);
  });

  it.each(['created', 'customer_approval_granted', 'payment_created'])(
    'does not reactivate a row on subscriptions.%s',
    async (action) => {
      const body = JSON.stringify({
        events: [
          {
            id: `EV-sub-${action}`,
            resource_type: 'subscriptions',
            action,
            links: { subscription: 'SUB-1' },
          },
        ],
      });
      const { db, updateCalls, insertCalls } = makeWebhookDb();
      const env = makeEnv({ DB: db as any });
      const sig = await hmacHex(TEST_SECRET, body);
      const ctx = makeContext(makeWebhookReq(body, sig), { env });

      const res = await webhookOnRequestPost(ctx as any);
      expect(res.status).toBe(204);
      // These arrive throughout the life of a subscription — writing 'active'
      // would resurrect a row an admin had just deactivated.
      expect(updateCalls.length).toBe(0);
      expect(insertCalls.length).toBe(1);
    },
  );

  it('is idempotent — does not re-apply effects when the same event id is received twice', async () => {
    const body = JSON.stringify({
      events: [
        {
          id: 'EV-replayed',
          resource_type: 'mandates',
          action: 'cancelled',
          links: { mandate: 'MND-1' },
        },
      ],
    });
    const { db, updateCalls } = makeWebhookDb({ existingEventIds: ['EV-replayed'] });
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
    // No UPDATE issued because event was already processed.
    expect(updateCalls.length).toBe(0);
  });

  it('does not change status for payments.failed (single payment, mandate stays active)', async () => {
    const body = JSON.stringify({
      events: [
        {
          id: 'EV-pay-1',
          resource_type: 'payments',
          action: 'failed',
          links: { payment: 'PM-1', mandate: 'MND-1' },
        },
      ],
    });
    const { db, updateCalls } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(204);
    expect(updateCalls.length).toBe(0);
  });

  it('returns 400 on malformed JSON body (after passing signature)', async () => {
    const body = 'not-json';
    const { db } = makeWebhookDb();
    const env = makeEnv({ DB: db as any });
    const sig = await hmacHex(TEST_SECRET, body);
    const ctx = makeContext(makeWebhookReq(body, sig), { env });

    const res = await webhookOnRequestPost(ctx as any);
    expect(res.status).toBe(400);
  });
});

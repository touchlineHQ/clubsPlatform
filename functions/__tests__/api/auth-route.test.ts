import { describe, it, expect, vi } from 'vitest';
import { makeContext, makeEnv, getReq } from '../test-utils';

vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    handler: async () => new Response(JSON.stringify({ token: 'abc' }), { status: 200 }),
    api: { getSession: vi.fn().mockResolvedValue(null) },
  })),
}));

import { onRequest } from '../../api/auth/[[route]]';

describe('onRequest /api/auth/*', () => {
  it('returns 500 when DB is not bound', async () => {
    const env = { ...makeEnv(), DB: undefined as never };
    const ctx = makeContext(getReq('/api/auth/sign-in', {}), { env });
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/D1/i);
  });

  it('returns 500 when BETTER_AUTH_SECRET is missing', async () => {
    const env = { ...makeEnv(), BETTER_AUTH_SECRET: '' };
    const ctx = makeContext(getReq('/api/auth/sign-in', {}), { env });
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/BETTER_AUTH_SECRET/i);
  });

  it('delegates to auth handler when env is valid', async () => {
    const ctx = makeContext(getReq('/api/auth/sign-in', {}));
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(200);
  });
});

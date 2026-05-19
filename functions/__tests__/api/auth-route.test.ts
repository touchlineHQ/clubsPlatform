import { describe, it, expect, vi } from 'vitest';
import { makeContext, makeEnv, getReq, postReq } from '../test-utils';

const authHandler = vi.fn(async () =>
  new Response(JSON.stringify({ token: 'abc' }), { status: 200 }),
);

vi.mock('../../lib/auth', () => ({
  createAuth: vi.fn(() => ({
    handler: authHandler,
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

  it('rejects a signup with a short password before calling the auth handler', async () => {
    authHandler.mockClear();
    const ctx = makeContext(
      postReq('/api/auth/sign-up/email', { email: 'a@b.co', password: 'short', name: 'A' }),
    );
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(400);
    expect(authHandler).not.toHaveBeenCalled();
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/password/i);
  });

  it('rejects a signup with a malformed email before calling the auth handler', async () => {
    authHandler.mockClear();
    const ctx = makeContext(
      postReq('/api/auth/sign-up/email', { email: 'not-an-email', password: 'longenough!', name: 'A' }),
    );
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(400);
    expect(authHandler).not.toHaveBeenCalled();
  });

  it('forwards a valid signup body to the auth handler intact', async () => {
    authHandler.mockClear();
    const body = { email: 'a@b.co', password: 'longenough!', name: 'Alice' };
    const ctx = makeContext(postReq('/api/auth/sign-up/email', body));
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(200);
    expect(authHandler).toHaveBeenCalledTimes(1);
    const forwarded = authHandler.mock.calls[0][0] as Request;
    const forwardedBody = await forwarded.json();
    expect(forwardedBody).toEqual(body);
  });

  it('does not validate non-signup auth routes', async () => {
    authHandler.mockClear();
    const ctx = makeContext(
      postReq('/api/auth/sign-in/email', { email: 'x', password: 'short' }),
    );
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(200);
    expect(authHandler).toHaveBeenCalledTimes(1);
  });

  // P0#5: the catch branch must not leak exception details (SQL errors, stack
  // frames, library internals) to the client.
  it('does not leak exception details in the 500 response when createAuth throws', async () => {
    const { createAuth } = await import('../../lib/auth');
    vi.mocked(createAuth).mockImplementationOnce(() => {
      throw new Error('SQL: relation "user" does not exist');
    });

    const ctx = makeContext(getReq('/api/auth/sign-in', {}));
    const res = await onRequest(ctx as never);
    expect(res.status).toBe(500);
    const body = await res.json() as Record<string, unknown>;
    expect(body.error).toBe('Auth error');
    expect(body).not.toHaveProperty('details');
    // Belt-and-braces: nothing in the body should mention the underlying error.
    expect(JSON.stringify(body)).not.toContain('SQL');
    expect(JSON.stringify(body)).not.toContain('relation');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeContext, makeEnv, getReq } from './test-utils';

const captureExceptionImmediate = vi.fn(async () => {});
const getPostHog = vi.fn();

vi.mock('../lib/posthog', () => ({
  getPostHog: (...args: unknown[]) => getPostHog(...args),
}));

const getSession = vi.fn();
vi.mock('../lib/auth', () => ({
  createAuth: vi.fn(() => ({ api: { getSession } })),
}));

import { onRequest } from '../_middleware';

const posthogEnv = { POSTHOG_API_KEY: 'phc_test', POSTHOG_HOST: 'https://ph.example.com' };

beforeEach(() => {
  vi.clearAllMocks();
  getPostHog.mockReturnValue({ captureExceptionImmediate });
  getSession.mockResolvedValue({ user: { id: 'user_123' } });
});

/** A context whose next() throws the given error. */
function throwingContext(err: unknown, path = '/api/club', headers: Record<string, string> = {}) {
  const ctx = makeContext(getReq(path, headers), { env: { ...makeEnv(), ...posthogEnv } as never });
  ctx.next = async () => { throw err; };
  return ctx;
}

describe('functions/_middleware', () => {
  it('passes the response through untouched when nothing throws', async () => {
    const expected = new Response('ok', { status: 201 });
    const ctx = makeContext(getReq('/api/club'), { env: { ...makeEnv(), ...posthogEnv } as never });
    ctx.next = async () => expected;

    const res = await onRequest(ctx as never);

    expect(res).toBe(expected);
    expect(captureExceptionImmediate).not.toHaveBeenCalled();
  });

  it('does not resolve a session on the happy path', async () => {
    const ctx = makeContext(getReq('/api/club'), { env: { ...makeEnv(), ...posthogEnv } as never });
    ctx.next = async () => new Response('ok');

    await onRequest(ctx as never);

    // The error path is the only place that should pay for a session lookup.
    expect(getSession).not.toHaveBeenCalled();
  });

  it('captures a thrown error and re-throws it unchanged', async () => {
    const err = new Error('boom');

    await expect(onRequest(throwingContext(err) as never)).rejects.toBe(err);

    expect(captureExceptionImmediate).toHaveBeenCalledTimes(1);
    expect(captureExceptionImmediate.mock.calls[0][0]).toBe(err);
  });

  it('attributes the exception to the signed-in user', async () => {
    await expect(onRequest(throwingContext(new Error('boom')) as never)).rejects.toThrow();

    expect(captureExceptionImmediate.mock.calls[0][1]).toBe('user_123');
  });

  it('records the request path, method and club slug', async () => {
    const ctx = throwingContext(new Error('boom'), '/api/registration', { 'X-Club-Slug': 'east-leake' });

    await expect(onRequest(ctx as never)).rejects.toThrow();

    expect(captureExceptionImmediate.mock.calls[0][2]).toMatchObject({
      path: '/api/registration',
      method: 'GET',
      club_slug: 'east-leake',
      source: 'pages-function',
    });
  });

  it('leaves the distinct id undefined when there is no session', async () => {
    getSession.mockResolvedValue(null);

    await expect(onRequest(throwingContext(new Error('boom')) as never)).rejects.toThrow();

    expect(captureExceptionImmediate.mock.calls[0][1]).toBeUndefined();
  });

  it('still re-throws the original error when session lookup fails', async () => {
    getSession.mockRejectedValue(new Error('session store down'));
    const err = new Error('boom');

    await expect(onRequest(throwingContext(err) as never)).rejects.toBe(err);

    expect(captureExceptionImmediate).toHaveBeenCalledTimes(1);
    expect(captureExceptionImmediate.mock.calls[0][1]).toBeUndefined();
  });

  it('still re-throws the original error when reporting itself fails', async () => {
    captureExceptionImmediate.mockRejectedValue(new Error('posthog unreachable'));
    const err = new Error('boom');

    // Reporting must never replace the route's error with its own.
    await expect(onRequest(throwingContext(err) as never)).rejects.toBe(err);
  });

  it('re-throws without capturing when PostHog is not configured', async () => {
    getPostHog.mockReturnValue(null);
    const err = new Error('boom');
    const ctx = makeContext(getReq('/api/club'));
    ctx.next = async () => { throw err; };

    await expect(onRequest(ctx as never)).rejects.toBe(err);

    expect(captureExceptionImmediate).not.toHaveBeenCalled();
  });
});

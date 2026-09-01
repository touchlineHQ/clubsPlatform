import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  sendResetPassword,
  sendVerifyEmail,
  sendImportWelcome,
  reportEmailFailure,
  type AccountEmailEnv,
} from '../../lib/account-email';

const captureExceptionImmediate = vi.hoisted(() => vi.fn());
vi.mock('../../lib/posthog', () => ({
  getPostHog: vi.fn((env: { POSTHOG_API_KEY?: string }) =>
    env.POSTHOG_API_KEY ? { captureExceptionImmediate } : null),
  clubGroups: vi.fn(() => ({})),
}));

/**
 * Answers the user lookup with `clubSlug`, then the club lookup with the club
 * row — in the order account-email issues them.
 */
function makeDb(clubSlug: string | null, club: { name: string; data: string | null } | null): D1Database {
  const queue = [clubSlug === null ? { clubSlug: null } : { clubSlug }, club];
  let i = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => queue[i++] ?? null) })),
    })),
  } as unknown as D1Database;
}

/** sendImportWelcome already knows the club, so it only issues the club lookup. */
function clubOnlyDb(club: { name: string; data: string | null } | null): D1Database {
  const queue = [club];
  let i = 0;
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn(async () => queue[i++] ?? null) })),
    })),
  } as unknown as D1Database;
}

function makeEnv(overrides: Partial<AccountEmailEnv> = {}): AccountEmailEnv {
  return {
    DB: makeDb('east-leake', { name: 'East Leake FC', data: JSON.stringify({ email: 'sec@elfc.com' }) }),
    EMAIL_API_KEY: 'key_test',
    EMAIL_FROM: 'no-reply@example.com',
    EMAIL_API_BASE: 'https://mail.test',
    MULTI_CLUB: 'true',
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  captureExceptionImmediate.mockReset();
});

afterEach(() => vi.unstubAllGlobals());

function sentBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('sendResetPassword', () => {
  it('sends from the club identity, not the platform', async () => {
    const sent = await sendResetPassword(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    });

    expect(sent).toBe(true);
    const body = sentBody();
    expect(body.from).toBe('East Leake FC <no-reply@example.com>');
    expect(body.reply_to).toBe('sec@elfc.com');
    expect(body.subject).toBe('Reset your East Leake FC password');
  });

  it('links into the club\'s own site with the token', async () => {
    await sendResetPassword(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    });
    const body = sentBody();
    expect(body.html).toContain('https://clubs.example/east-leake/#/reset-password?token=tok123');
    expect(body.text).toContain('https://clubs.example/east-leake/#/reset-password?token=tok123');
  });

  it('falls back to the platform identity for a user with no club', async () => {
    const env = makeEnv({ DB: makeDb(null, null) });
    await sendResetPassword(env, {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'admin@example.com',
      token: 'tok123',
    });
    const body = sentBody();
    expect(body.from).toBe('Club Platform <no-reply@example.com>');
    expect(body).not.toHaveProperty('reply_to');
    expect(body.html).toContain('https://clubs.example/#/reset-password?token=tok123');
  });

  it('reports false and sends nothing when email is not configured', async () => {
    const env = makeEnv({ EMAIL_API_KEY: undefined });
    const sent = await sendResetPassword(env, {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    });
    expect(sent).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('propagates a provider failure to the caller', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(sendResetPassword(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    })).rejects.toThrow(/500/);
  });
});

describe('sendVerifyEmail', () => {
  // The link has to hit the auth API — that endpoint is what marks the address
  // verified — and then bounce the recipient back to their own club.
  it('links to the auth endpoint with a club callback', async () => {
    await sendVerifyEmail(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok+123',
    });
    const body = sentBody();
    expect(body.html).toContain('https://clubs.example/api/auth/verify-email?token=tok%2B123');
    expect(body.html).toContain(encodeURIComponent('https://clubs.example/east-leake/#/'));
    expect(body.subject).toBe('Confirm your email for East Leake FC');
  });
});

describe('sendImportWelcome', () => {
  it('addresses the club named by the import, with a set-password link', async () => {
    const env = makeEnv({
      DB: clubOnlyDb({ name: 'East Leake FC', data: null }),
    });
    const sent = await sendImportWelcome(env, {
      origin: 'https://clubs.example',
      clubSlug: 'east-leake',
      email: 'parent@example.com',
      token: 'invite1',
    });

    expect(sent).toBe(true);
    const body = sentBody();
    expect(body.subject).toBe('Set up your East Leake FC account');
    expect(body.html).toContain('https://clubs.example/east-leake/#/reset-password?token=invite1');
    expect(body.text).toContain('7 days');
  });

  it('drops the club prefix in single-club mode', async () => {
    const env = makeEnv({
      MULTI_CLUB: 'false',
      DB: clubOnlyDb({ name: 'East Leake FC', data: null }),
    });
    await sendImportWelcome(env, {
      origin: 'https://clubs.example',
      clubSlug: 'east-leake',
      email: 'parent@example.com',
      token: 'invite1',
    });
    expect(sentBody().html).toContain('https://clubs.example/#/reset-password?token=invite1');
  });
});

describe('reportEmailFailure', () => {
  it('records the failure against error tracking', async () => {
    const env = makeEnv({ POSTHOG_API_KEY: 'phc', POSTHOG_HOST: 'https://ph.test' });
    await reportEmailFailure(env, new Error('boom'), { kind: 'reset-password', userId: 'user_1' });
    expect(captureExceptionImmediate).toHaveBeenCalledWith(
      expect.any(Error),
      'user_1',
      expect.objectContaining({ source: 'transactional-email', email_kind: 'reset-password' }),
    );
  });

  it('is a no-op when analytics is disabled', async () => {
    await reportEmailFailure(makeEnv(), new Error('boom'), { kind: 'reset-password' });
    expect(captureExceptionImmediate).not.toHaveBeenCalled();
  });

  // Never let the reporting of a failure become a second failure.
  it('swallows an analytics error', async () => {
    captureExceptionImmediate.mockRejectedValue(new Error('posthog down'));
    const env = makeEnv({ POSTHOG_API_KEY: 'phc', POSTHOG_HOST: 'https://ph.test' });
    await expect(
      reportEmailFailure(env, new Error('boom'), { kind: 'verify-email' }),
    ).resolves.toBeUndefined();
  });
});

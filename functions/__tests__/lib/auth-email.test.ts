import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import { createAuth } from '../../lib/auth';
import { makeDb } from '../test-utils';

/**
 * Drives the hooks better-auth will call, through the real mailer, so the
 * assertions are about the message that would actually go to Resend.
 */

const CLUB_ROW = {
  slug: 'east-leake',
  name: 'East Leake FC',
  data: JSON.stringify({ email: 'secretary@elfc.example' }),
};

function env(overrides: Record<string, unknown> = {}) {
  return {
    DB: makeDb({ first: CLUB_ROW }) as unknown as D1Database,
    BETTER_AUTH_SECRET: 'test-secret',
    MULTI_CLUB: 'true',
    RESEND_API_KEY: 'test-key',
    FROM_EMAIL: 'noreply@touchlinehq.example',
    ...overrides,
  };
}

const USER = { id: 'user_1', email: 'parent@example.com', clubSlug: 'east-leake' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody() {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

/** The hooks as better-auth sees them. */
function hooks(e = env()) {
  const auth = createAuth(e as never, { baseURL: 'https://clubs.example' });
  const options = (auth as unknown as {
    options: {
      emailAndPassword: {
        sendResetPassword: (d: unknown) => Promise<void>;
        minPasswordLength: number;
        resetPasswordTokenExpiresIn: number;
      };
      emailVerification: {
        sendOnSignUp: boolean;
        sendVerificationEmail: (d: unknown) => Promise<void>;
      };
    };
  }).options;
  return options;
}

describe('sendResetPassword', () => {
  it('links into the club, through the hash router, with the token', async () => {
    await hooks().emailAndPassword.sendResetPassword({ user: USER, token: 'tok123' });

    const body = sentBody();
    expect(body.text).toContain(
      'https://clubs.example/east-leake/#/reset-password?token=tok123',
    );
  });

  it('addresses the message as the club, replying to the club', async () => {
    await hooks().emailAndPassword.sendResetPassword({ user: USER, token: 'tok123' });

    const body = sentBody();
    expect(body.from).toBe('"East Leake FC" <noreply@touchlinehq.example>');
    expect(body.reply_to).toBe('secretary@elfc.example');
    expect(body.subject).toBe('Reset your East Leake FC password');
    expect(body.to).toEqual(['parent@example.com']);
  });

  it('drops the club prefix in single-club mode', async () => {
    await hooks(env({ MULTI_CLUB: 'false' }))
      .emailAndPassword.sendResetPassword({ user: USER, token: 'tok123' });

    expect(sentBody().text).toContain('https://clubs.example/#/reset-password?token=tok123');
  });

  it('still sends for a platform admin, who belongs to no club', async () => {
    await hooks().emailAndPassword.sendResetPassword({
      user: { ...USER, clubSlug: null },
      token: 'tok123',
    });

    const body = sentBody();
    expect(body.text).toContain('https://clubs.example/#/reset-password?token=tok123');
    expect(body).not.toHaveProperty('reply_to');
  });

  it('sends nothing, and does not throw, when mail is unconfigured', async () => {
    await expect(
      hooks(env({ RESEND_API_KEY: undefined }))
        .emailAndPassword.sendResetPassword({ user: USER, token: 'tok123' }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a provider failure rather than revealing the account exists', async () => {
    // This hook only runs once a user has been found. Surfacing the failure
    // would answer "is this parent registered?" for anyone who asks.
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    await expect(
      hooks().emailAndPassword.sendResetPassword({ user: USER, token: 'tok123' }),
    ).resolves.toBeUndefined();
  });

  it('holds the reset to the same password floor as sign-up', async () => {
    // Otherwise a reset could set a password sign-up would have rejected.
    expect(hooks().emailAndPassword.minPasswordLength).toBe(10);
  });

  it('expires the token in an hour', async () => {
    expect(hooks().emailAndPassword.resetPasswordTokenExpiresIn).toBe(3600);
  });
});

describe('sendVerificationEmail', () => {
  it('points at the API, carrying a club callback for afterwards', async () => {
    await hooks().emailVerification.sendVerificationEmail({ user: USER, token: 'vtok' });

    const body = sentBody();
    expect(body.text).toContain('https://clubs.example/api/auth/verify-email?token=vtok');
    expect(body.text).toContain(
      `callbackURL=${encodeURIComponent('/east-leake/#/login?verified=1')}`,
    );
    expect(body.subject).toBe('Confirm your email for East Leake FC');
  });

  it('is sent on sign-up', () => {
    expect(hooks().emailVerification.sendOnSignUp).toBe(true);
  });

  it('does not stop sign-up when the provider is down', async () => {
    fetchMock.mockRejectedValue(new Error('connection reset'));
    await expect(
      hooks().emailVerification.sendVerificationEmail({ user: USER, token: 'vtok' }),
    ).resolves.toBeUndefined();
  });
});

describe('email verification enforcement', () => {
  it('stays off, because every existing account has emailVerified = 0', () => {
    const options = createAuth(env() as never, { baseURL: 'https://clubs.example' })
      .options as { emailAndPassword: { requireEmailVerification?: boolean } };
    expect(options.emailAndPassword.requireEmailVerification).toBeUndefined();
  });
});

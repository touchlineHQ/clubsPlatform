import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { D1Database } from '@cloudflare/workers-types';
import {
  sendResetPassword,
  sendVerifyEmail,
  sendImportWelcome,
  reportEmailFailure,
  type AccountEmailEnv,
} from '../../lib/account-email';
import { SmtpError } from '../../lib/smtp';

const captureExceptionImmediate = vi.hoisted(() => vi.fn());
vi.mock('../../lib/posthog', () => ({
  getPostHog: vi.fn((env: { POSTHOG_API_KEY?: string }) =>
    env.POSTHOG_API_KEY ? { captureExceptionImmediate } : null),
  clubGroups: vi.fn(() => ({})),
}));

/**
 * Stop at the socket, not at the mailer: the real getMailer() and the real MIME
 * builder still run, so these tests see the message a relay would actually be
 * handed. lib/smtp.test.ts covers the protocol below this seam.
 */
const sendSmtpMessage = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/smtp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/smtp')>()),
  sendSmtpMessage,
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
    SMTP_HOST: 'smtp.test',
    SMTP_USER: 'committee@club.test',
    SMTP_PASSWORD: 'hunter2hunter2',
    FROM_EMAIL: 'committee@club.test',
    MULTI_CLUB: 'true',
    ...overrides,
  };
}

beforeEach(() => {
  sendSmtpMessage.mockReset();
  sendSmtpMessage.mockResolvedValue(undefined);
  captureExceptionImmediate.mockReset();
});

/** The RFC 5322 message the mailer handed to the relay. */
function sentMime(): string {
  return (sendSmtpMessage.mock.calls[0] as unknown as [unknown, { content: string }])[1].content;
}

/** Envelope the relay was given, as distinct from the headers. */
function sentEnvelope(): { from: string; to: string } {
  return (sendSmtpMessage.mock.calls[0] as unknown as [unknown, { from: string; to: string }])[1];
}

function header(name: string): string | undefined {
  return sentMime()
    .split('\r\n\r\n')[0]
    .split('\r\n')
    .find((l) => l.toLowerCase().startsWith(`${name.toLowerCase()}: `))
    ?.slice(name.length + 2);
}

/** Decode one alternative part back to text. */
function part(contentType: string): string {
  const section = sentMime().split(/--=_cp_[^\r\n]+/).find((p) => p.includes(contentType))!;
  const body = section.split('\r\n\r\n')[1] ?? '';
  return new TextDecoder().decode(
    Uint8Array.from(atob(body.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)),
  );
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
    expect(header('From')).toBe('East Leake FC <committee@club.test>');
    expect(header('Reply-To')).toBe('sec@elfc.com');
    expect(header('Subject')).toBe('Reset your East Leake FC password');
    // The envelope stays the authenticated mailbox — a relay will not accept
    // a MAIL FROM it has not been told we own.
    expect(sentEnvelope()).toMatchObject({ from: 'committee@club.test', to: 'parent@example.com' });
  });

  it('links into the club\'s own site with the token', async () => {
    await sendResetPassword(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    });
    expect(part('text/html')).toContain('https://clubs.example/east-leake/#/reset-password?token=tok123');
    expect(part('text/plain')).toContain('https://clubs.example/east-leake/#/reset-password?token=tok123');
  });

  it('falls back to the platform identity for a user with no club', async () => {
    const env = makeEnv({ DB: makeDb(null, null) });
    await sendResetPassword(env, {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'admin@example.com',
      token: 'tok123',
    });
    expect(header('From')).toBe('Club Platform <committee@club.test>');
    expect(header('Reply-To')).toBeUndefined();
    expect(part('text/html')).toContain('https://clubs.example/#/reset-password?token=tok123');
  });

  it('reports false and sends nothing when email is not configured', async () => {
    const env = makeEnv({ SMTP_PASSWORD: undefined });
    const sent = await sendResetPassword(env, {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    });
    expect(sent).toBe(false);
    expect(sendSmtpMessage).not.toHaveBeenCalled();
  });

  it('propagates a relay failure to the caller', async () => {
    sendSmtpMessage.mockRejectedValue(new SmtpError(451, 'MAIL FROM', 'try again later'));
    await expect(sendResetPassword(makeEnv(), {
      origin: 'https://clubs.example',
      userId: 'user_1',
      email: 'parent@example.com',
      token: 'tok123',
    })).rejects.toThrow(/451/);
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
    expect(part('text/html')).toContain('https://clubs.example/api/auth/verify-email?token=tok%2B123');
    expect(part('text/html')).toContain(encodeURIComponent('https://clubs.example/east-leake/#/'));
    expect(header('Subject')).toBe('Confirm your email for East Leake FC');
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
    expect(header('Subject')).toBe('Set up your East Leake FC account');
    expect(part('text/html')).toContain('https://clubs.example/east-leake/#/reset-password?token=invite1');
    expect(part('text/plain')).toContain('7 days');
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
    expect(part('text/html')).toContain('https://clubs.example/#/reset-password?token=invite1');
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

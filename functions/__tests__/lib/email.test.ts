import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatFrom, getMailer, sanitizeAddress, sanitizeSubject } from '../../lib/email';

describe('email sanitizers', () => {
  it('strips structural characters from addresses and subjects', () => {
    expect(sanitizeAddress('a@b.com\nCc: x@y.z')).toBe('a@b.comCc:x@y.z');
    expect(sanitizeSubject('Hello\r\nWorld')).toBe('Hello World');
  });

  it('formats From with a cleaned display name', () => {
    expect(formatFrom('East Leake FC', 'noreply@example.com'))
      .toBe('"East Leake FC" <noreply@example.com>');
    expect(formatFrom('Say "hi"', 'noreply@example.com'))
      .toBe('"Say hi" <noreply@example.com>');
  });
});

describe('getMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null unless both RESEND_API_KEY and FROM_EMAIL are set', () => {
    expect(getMailer({})).toBeNull();
    expect(getMailer({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(getMailer({ FROM_EMAIL: 'a@b.c' })).toBeNull();
    expect(getMailer({ RESEND_API_KEY: 'k', FROM_EMAIL: 'a@b.c' })).not.toBeNull();
  });

  it('posts to Resend and returns the provider id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 're_123' }), { status: 200 }),
    );
    const mailer = getMailer(
      { RESEND_API_KEY: 'k', FROM_EMAIL: 'noreply@example.com' },
      { fetch: fetchMock as unknown as typeof fetch },
    );
    const result = await mailer!.send({
      to: 'parent@example.com',
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      fromName: 'Test FC',
    });
    expect(result.id).toBe('re_123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.to).toEqual(['parent@example.com']);
    expect(body.from).toContain('Test FC');
  });
});

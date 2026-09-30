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

  it('returns null unless a provider is configured', () => {
    expect(getMailer({})).toBeNull();
    expect(getMailer({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(getMailer({ FROM_EMAIL: 'a@b.c' })).toBeNull();
    expect(getMailer({ RESEND_API_KEY: 'k', FROM_EMAIL: 'a@b.c' })).not.toBeNull();
  });
});

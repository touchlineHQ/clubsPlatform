import { describe, it, expect, vi, afterEach } from 'vitest';
import { createResendMailer } from '../../../lib/mailers/resend';

describe('createResendMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns null unless both RESEND_API_KEY and FROM_EMAIL are set', () => {
    expect(createResendMailer({})).toBeNull();
    expect(createResendMailer({ RESEND_API_KEY: 'k' })).toBeNull();
    expect(createResendMailer({ FROM_EMAIL: 'a@b.c' })).toBeNull();
    expect(createResendMailer({ RESEND_API_KEY: 'k', FROM_EMAIL: 'a@b.c' })).not.toBeNull();
  });

  it('posts to Resend and returns the provider id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: 're_123' }), { status: 200 }),
    );
    const mailer = createResendMailer(
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
    expect(call[0]).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(call[1].body));
    expect(body.to).toEqual(['parent@example.com']);
    expect(body.from).toContain('Test FC');
  });
});

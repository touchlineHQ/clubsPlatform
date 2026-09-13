import { describe, it, expect, vi } from 'vitest';
import { formatFrom, getMailer, sanitizeAddress, sanitizeSubject } from '../../lib/email';

const CONFIGURED = { RESEND_API_KEY: 'test-key', FROM_EMAIL: 'noreply@club.example' };

function okFetch() {
  return vi.fn(async () => new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 }));
}

/** The body the mailer actually posted, parsed. */
function sentBody(fetchMock: ReturnType<typeof okFetch>) {
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
}

describe('getMailer configuration', () => {
  it('returns null when the API key is missing', () => {
    expect(getMailer({ FROM_EMAIL: 'noreply@club.example' })).toBeNull();
  });

  it('returns null when the from address is missing', () => {
    expect(getMailer({ RESEND_API_KEY: 'test-key' })).toBeNull();
  });

  it('returns null when nothing is configured', () => {
    expect(getMailer({})).toBeNull();
  });

  it('returns a mailer when both are present', () => {
    expect(getMailer(CONFIGURED)).not.toBeNull();
  });
});

describe('sending', () => {
  const message = {
    to: 'parent@example.com',
    subject: 'Reset your password',
    html: '<p>hi</p>',
    text: 'hi',
    fromName: 'East Leake FC',
  };

  it('posts the message to Resend with the API key', async () => {
    const fetchMock = okFetch();
    await getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!.send(message);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key');

    const body = sentBody(fetchMock);
    expect(body.to).toEqual(['parent@example.com']);
    expect(body.subject).toBe('Reset your password');
    expect(body.html).toBe('<p>hi</p>');
    expect(body.text).toBe('hi');
  });

  it('sends from the club name at the configured address', async () => {
    const fetchMock = okFetch();
    await getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!.send(message);
    expect(sentBody(fetchMock).from).toBe('"East Leake FC" <noreply@club.example>');
  });

  it('includes reply_to when the club has a contact address', async () => {
    const fetchMock = okFetch();
    await getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!
      .send({ ...message, replyTo: 'secretary@club.example' });
    expect(sentBody(fetchMock).reply_to).toBe('secretary@club.example');
  });

  it('omits reply_to entirely when the club has none', async () => {
    const fetchMock = okFetch();
    await getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!.send(message);
    expect(sentBody(fetchMock)).not.toHaveProperty('reply_to');
  });

  it('throws with the provider status when the message is rejected', async () => {
    const fetchMock = vi.fn(async () => new Response('domain not verified', { status: 403 }));
    await expect(
      getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!.send(message),
    ).rejects.toThrow(/403.*domain not verified/);
  });

  it('refuses a recipient that is not an address', async () => {
    const fetchMock = okFetch();
    await expect(
      getMailer(CONFIGURED, { fetch: fetchMock as unknown as typeof fetch })!
        .send({ ...message, to: 'not-an-address' }),
    ).rejects.toThrow(/invalid address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('header safety', () => {
  it('strips the structural characters from an address', () => {
    expect(sanitizeAddress('parent@example.com\r\nBcc: attacker@evil.example'))
      .toBe('parent@example.comBcc:attacker@evil.example');
  });

  it('keeps hyphens and dots, which are ordinary in addresses', () => {
    expect(sanitizeAddress('first.last@east-leake-fc.example'))
      .toBe('first.last@east-leake-fc.example');
  });

  it('takes the line breaks out of a subject but leaves its punctuation', () => {
    expect(sanitizeSubject('Reset your password\r\nX-Injected: yes'))
      .toBe('Reset your password X-Injected: yes');
  });

  it('quotes the display name and drops what could close the phrase', () => {
    expect(formatFrom('Club" <evil@evil.example>, x', 'noreply@club.example'))
      .toBe('"Club <evil@evil.example>, x" <noreply@club.example>');
  });

  it('keeps a club name that is merely punctuated', () => {
    expect(formatFrom("St Mary's FC (Juniors)", 'noreply@club.example'))
      .toBe('"St Mary\'s FC (Juniors)" <noreply@club.example>');
  });

  it('falls back to a bare address when there is no usable name', () => {
    expect(formatFrom('', 'noreply@club.example')).toBe('noreply@club.example');
    expect(formatFrom(undefined, 'noreply@club.example')).toBe('noreply@club.example');
  });
});

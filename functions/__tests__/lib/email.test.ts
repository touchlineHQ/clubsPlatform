import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMailer, formatFrom, EmailDeliveryError, DEFAULT_FROM_NAME } from '../../lib/email';

const CONFIGURED = {
  EMAIL_API_KEY: 'key_test',
  EMAIL_FROM: 'no-reply@example.com',
  EMAIL_API_BASE: 'https://mail.test',
};

function message(overrides: Record<string, unknown> = {}) {
  return {
    to: 'parent@example.com',
    subject: 'Subject',
    html: '<p>Body</p>',
    text: 'Body',
    ...overrides,
  } as Parameters<NonNullable<ReturnType<typeof getMailer>>['send']>[0];
}

describe('formatFrom', () => {
  it('returns the bare address when there is no name', () => {
    expect(formatFrom('a@b.com')).toBe('a@b.com');
  });

  it('wraps the display name in front of the address', () => {
    expect(formatFrom('a@b.com', 'East Leake FC')).toBe('East Leake FC <a@b.com>');
  });

  // A club name is admin-editable text that lands in a mail header. Anything
  // that could close the phrase or open a new header has to go.
  it('strips characters that could inject a header', () => {
    const from = formatFrom('a@b.com', 'Evil"\r\nBcc: victim@example.com <x@y.com>');
    expect(from).toBe('Evil Bcc victim@example.com x@y.com <a@b.com>');
    expect(from).not.toContain('\n');
    expect(from).not.toContain('"');
  });

  it('falls back to the bare address when the name is only unsafe characters', () => {
    expect(formatFrom('a@b.com', '<<>>')).toBe('a@b.com');
  });
});

describe('getMailer', () => {
  it('returns null without an API key', () => {
    expect(getMailer({ EMAIL_FROM: 'a@b.com' })).toBeNull();
  });

  it('returns null without a from address', () => {
    expect(getMailer({ EMAIL_API_KEY: 'k' })).toBeNull();
  });

  it('returns a mailer when both are set', () => {
    expect(getMailer(CONFIGURED)).not.toBeNull();
  });
});

describe('mailer.send', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('posts to the provider with the API key and message', async () => {
    await getMailer(CONFIGURED)!.send(message({ fromName: 'East Leake FC', replyTo: 'sec@elfc.com' }));

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://mail.test/emails');
    expect(init.headers.Authorization).toBe('Bearer key_test');

    const body = JSON.parse(init.body);
    expect(body.from).toBe('East Leake FC <no-reply@example.com>');
    expect(body.to).toEqual(['parent@example.com']);
    expect(body.reply_to).toBe('sec@elfc.com');
    expect(body.html).toBe('<p>Body</p>');
    expect(body.text).toBe('Body');
  });

  it('falls back to the platform name when the club has none', async () => {
    await getMailer(CONFIGURED)!.send(message());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.from).toBe(`${DEFAULT_FROM_NAME} <no-reply@example.com>`);
  });

  it('omits reply_to entirely when the club has no contact address', async () => {
    await getMailer(CONFIGURED)!.send(message({ replyTo: null }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('reply_to');
  });

  it('throws EmailDeliveryError carrying the status when the provider rejects', async () => {
    fetchMock.mockResolvedValue(new Response('domain not verified', { status: 422 }));
    await expect(getMailer(CONFIGURED)!.send(message())).rejects.toMatchObject({
      name: 'EmailDeliveryError',
      status: 422,
    });
  });

  it('truncates a long provider error body', async () => {
    fetchMock.mockResolvedValue(new Response('x'.repeat(5000), { status: 500 }));
    const err = await getMailer(CONFIGURED)!.send(message()).catch((e: EmailDeliveryError) => e);
    expect((err as EmailDeliveryError).message.length).toBeLessThan(600);
  });

  it('trims a trailing slash off the configured API base', async () => {
    await getMailer({ ...CONFIGURED, EMAIL_API_BASE: 'https://mail.test/' })!.send(message());
    expect(fetchMock.mock.calls[0][0]).toBe('https://mail.test/emails');
  });
});

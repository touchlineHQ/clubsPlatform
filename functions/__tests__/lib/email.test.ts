import { describe, it, expect } from 'vitest';
import {
  getMailer,
  formatFrom,
  readSmtpConfig,
  buildMimeMessage,
  encodeHeaderValue,
  formatDate,
  EmailDeliveryError,
  DEFAULT_FROM_NAME,
  type EmailEnv,
} from '../../lib/email';
import { fakeSmtpServer, HAPPY_PATH } from './fake-smtp-socket';

const CONFIGURED: EmailEnv = {
  SMTP_HOST: 'smtp.test',
  SMTP_PORT: '465',
  SMTP_SECURE: 'true',
  SMTP_USER: 'committee@club.test',
  SMTP_PASSWORD: 'hunter2hunter2',
  FROM_EMAIL: 'committee@club.test',
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

/** Pull the DATA payload out of what the client wrote. */
function sentMessage(transcript: string): string {
  const start = transcript.indexOf('DATA\r\n') + 'DATA\r\n'.length;
  return transcript.slice(start, transcript.indexOf('\r\n.\r\n', start));
}

function part(mime: string, contentType: string): string {
  const section = mime.split(/--=_cp_[^\r\n]+/).find((p) => p.includes(contentType));
  const body = section!.split('\r\n\r\n')[1] ?? '';
  return atob(body.replace(/\r\n/g, ''));
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

describe('encodeHeaderValue', () => {
  it('leaves plain ASCII readable', () => {
    expect(encodeHeaderValue('Reset your password')).toBe('Reset your password');
  });

  it('RFC 2047 encodes a value with non-ASCII in it', () => {
    const encoded = encodeHeaderValue('Reset your Fútbol Club password');
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
  });
});

describe('formatDate', () => {
  // toUTCString() ends in "GMT", which RFC 5322 treats as obsolete syntax.
  it('emits a numeric UTC offset', () => {
    expect(formatDate(new Date('2026-09-03T07:05:09Z')))
      .toBe('Thu, 03 Sep 2026 07:05:09 +0000');
  });
});

describe('readSmtpConfig', () => {
  it.each(['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'FROM_EMAIL'] as const)(
    'returns null without %s',
    (key) => {
      expect(readSmtpConfig({ ...CONFIGURED, [key]: undefined })).toBeNull();
    },
  );

  it('defaults to implicit TLS on 465', () => {
    const config = readSmtpConfig({ ...CONFIGURED, SMTP_PORT: undefined, SMTP_SECURE: undefined })!;
    expect(config.port).toBe(465);
    expect(config.secure).toBe(true);
  });

  it('treats SMTP_SECURE=false as a STARTTLS upgrade', () => {
    expect(readSmtpConfig({ ...CONFIGURED, SMTP_PORT: '587', SMTP_SECURE: 'false' })!)
      .toMatchObject({ port: 587, secure: false });
  });

  // Reading a typo as "send my password in the clear" is the wrong default.
  it('falls back to encrypted for an unrecognised SMTP_SECURE', () => {
    expect(readSmtpConfig({ ...CONFIGURED, SMTP_SECURE: 'yes' })!.secure).toBe(true);
  });

  it('ignores an unparseable port rather than dialling port NaN', () => {
    expect(readSmtpConfig({ ...CONFIGURED, SMTP_PORT: 'not-a-port' })!.port).toBe(465);
  });

  it('passes a configured timeout through', () => {
    expect(readSmtpConfig({ ...CONFIGURED, SMTP_TIMEOUT_MS: '5000' })!.timeoutMs).toBe(5000);
  });
});

describe('buildMimeMessage', () => {
  const base = {
    from: 'committee@club.test',
    to: 'parent@example.com',
    subject: 'Reset your password',
    html: '<p>Hello</p>',
    text: 'Hello',
    boundary: '=_cp_test',
    messageId: 'fixed@club.test',
    date: new Date('2026-09-03T07:05:09Z'),
  };

  it('writes the headers a relay and an inbox both expect', () => {
    const mime = buildMimeMessage({ ...base, fromName: 'East Leake FC' });
    expect(mime).toContain('From: East Leake FC <committee@club.test>');
    expect(mime).toContain('To: parent@example.com');
    expect(mime).toContain('Subject: Reset your password');
    expect(mime).toContain('Message-ID: <fixed@club.test>');
    expect(mime).toContain('Date: Thu, 03 Sep 2026 07:05:09 +0000');
    expect(mime).toContain('MIME-Version: 1.0');
    expect(mime).toContain('Content-Type: multipart/alternative; boundary="=_cp_test"');
  });

  it('includes Reply-To only when one is given', () => {
    expect(buildMimeMessage({ ...base, replyTo: 'sec@elfc.com' }))
      .toContain('Reply-To: sec@elfc.com');
    expect(buildMimeMessage(base)).not.toContain('Reply-To:');
  });

  // A subject legitimately contains colons and commas — only CR/LF can end a
  // header, so only CR/LF are removed.
  it('keeps subject punctuation but drops line breaks', () => {
    const mime = buildMimeMessage({
      ...base,
      subject: 'Training cancelled: pitch waterlogged\r\nBcc: victim@example.com',
    });
    expect(mime).toContain('Subject: Training cancelled: pitch waterlogged Bcc: victim@example.com');
    expect(mime).not.toMatch(/\r\nBcc:/);
  });

  it('carries both bodies as base64 alternatives, HTML last', () => {
    const mime = buildMimeMessage(base);
    expect(part(mime, 'text/plain')).toBe('Hello');
    expect(part(mime, 'text/html')).toBe('<p>Hello</p>');
    expect(mime.indexOf('text/html')).toBeGreaterThan(mime.indexOf('text/plain'));
    expect(mime.trimEnd().endsWith('--=_cp_test--')).toBe(true);
  });

  // Base64 is what buys this: SMTP refuses lines over 998 octets.
  it('wraps encoded bodies well inside the SMTP line limit', () => {
    const mime = buildMimeMessage({ ...base, html: '<p>' + 'x'.repeat(5000) + '</p>' });
    for (const line of mime.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(998);
    }
  });

  // No line of base64 can start with "." so dot-stuffing has nothing to do.
  it('never emits a line that would need dot-stuffing', () => {
    const mime = buildMimeMessage({ ...base, text: '.\n.hidden\n..' });
    expect(mime.split('\r\n').some((l) => l.startsWith('.'))).toBe(false);
  });

  it('survives non-ASCII in the body', () => {
    const mime = buildMimeMessage({ ...base, text: 'Rúnda — café ☕' });
    expect(part(mime, 'text/plain')).not.toBe('');
    expect(new TextDecoder().decode(
      Uint8Array.from(part(mime, 'text/plain'), (c) => c.charCodeAt(0)),
    )).toBe('Rúnda — café ☕');
  });
});

describe('getMailer', () => {
  it('returns null when the SMTP settings are incomplete', () => {
    expect(getMailer({ SMTP_HOST: 'smtp.test' })).toBeNull();
    expect(getMailer({ ...CONFIGURED, SMTP_PASSWORD: undefined })).toBeNull();
  });

  it('returns a mailer when they are complete', () => {
    expect(getMailer(CONFIGURED)).not.toBeNull();
  });
});

describe('mailer.send', () => {
  it('submits the message through the configured relay', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await getMailer(CONFIGURED, server.connect)!.send(
      message({ fromName: 'East Leake FC', replyTo: 'sec@elfc.com' }),
    );

    expect(server.connectOptions().address).toEqual({ hostname: 'smtp.test', port: 465 });
    expect(server.sent).toContain('MAIL FROM:<committee@club.test>');
    expect(server.sent).toContain('RCPT TO:<parent@example.com>');

    const mime = sentMessage(server.transcript());
    expect(mime).toContain('From: East Leake FC <committee@club.test>');
    expect(mime).toContain('Reply-To: sec@elfc.com');
    expect(part(mime, 'text/html')).toBe('<p>Body</p>');
  });

  it('falls back to the platform name when the club has none', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await getMailer(CONFIGURED, server.connect)!.send(message());
    expect(sentMessage(server.transcript()))
      .toContain(`From: ${DEFAULT_FROM_NAME} <committee@club.test>`);
  });

  it('omits Reply-To when the club has no contact address', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await getMailer(CONFIGURED, server.connect)!.send(message({ replyTo: null }));
    expect(sentMessage(server.transcript())).not.toContain('Reply-To:');
  });

  // Callers outside this module should never have to know SMTP exists.
  it('translates a relay rejection into EmailDeliveryError with the reply code', async () => {
    const server = fakeSmtpServer({
      replies: [
        '220 smtp.test\r\n',
        '250-smtp.test\r\n250 AUTH PLAIN\r\n',
        '535 5.7.8 Authentication credentials invalid\r\n',
      ],
    });

    const err = await getMailer(CONFIGURED, server.connect)!.send(message()).catch((e) => e);
    expect(err).toBeInstanceOf(EmailDeliveryError);
    expect(err.status).toBe(535);
    expect(err.message).toContain('AUTH');
  });

  it('truncates a long relay error so it stays usable as an exception property', async () => {
    const server = fakeSmtpServer({
      replies: [
        '220 smtp.test\r\n',
        '250-smtp.test\r\n250 AUTH PLAIN\r\n',
        `550 ${'x'.repeat(4000)}\r\n`,
      ],
    });

    const err = await getMailer(CONFIGURED, server.connect)!.send(message()).catch((e) => e);
    expect(err.message.length).toBeLessThan(600);
  });
});

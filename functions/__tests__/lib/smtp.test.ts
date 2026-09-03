import { describe, it, expect, vi } from 'vitest';
import { sendSmtpMessage, parseReply, SmtpError, type SmtpConfig } from '../../lib/smtp';
import { fakeSmtpServer, HAPPY_PATH } from './fake-smtp-socket';

const CONFIG: SmtpConfig = {
  host: 'smtp.test',
  port: 465,
  secure: true,
  user: 'committee@club.test',
  password: 'hunter2hunter2',
};

const MESSAGE = {
  from: 'committee@club.test',
  to: 'parent@example.com',
  content: 'Subject: Hello\r\n\r\nBody',
};

function decode(b64: string) {
  return atob(b64);
}

describe('parseReply', () => {
  it('returns null while the reply is incomplete', () => {
    expect(parseReply('250-smtp.test\r\n')).toBeNull();
    expect(parseReply('250 partial line without terminator')).toBeNull();
  });

  it('reads a single-line reply and hands back the remainder', () => {
    const parsed = parseReply('250 Ok\r\n354 Go ahead\r\n')!;
    expect(parsed.reply).toEqual({ code: 250, text: 'Ok' });
    expect(parsed.rest).toBe('354 Go ahead\r\n');
  });

  it('joins a multi-line reply', () => {
    const parsed = parseReply('250-smtp.test\r\n250-SIZE 100\r\n250 AUTH PLAIN\r\n')!;
    expect(parsed.reply.code).toBe(250);
    expect(parsed.reply.text).toBe('smtp.test\nSIZE 100\nAUTH PLAIN');
  });

  // Unparsed noise must not read as success.
  it('reports code 0 for a line that is not an SMTP reply', () => {
    expect(parseReply('garbage from the wire\r\n')!.reply.code).toBe(0);
  });
});

describe('sendSmtpMessage', () => {
  it('walks the full submission dialogue in order', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await sendSmtpMessage(CONFIG, MESSAGE, server.connect);

    expect(server.sent[0]).toBe('EHLO clubsplatform');
    expect(server.sent[1]).toMatch(/^AUTH PLAIN /);
    expect(server.sent[2]).toBe('MAIL FROM:<committee@club.test>');
    expect(server.sent[3]).toBe('RCPT TO:<parent@example.com>');
    expect(server.sent[4]).toBe('DATA');
    expect(server.sent).toContain('QUIT');
  });

  it('opens the socket with implicit TLS when secure', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await sendSmtpMessage(CONFIG, MESSAGE, server.connect);

    const { address, options } = server.connectOptions();
    expect(address).toEqual({ hostname: 'smtp.test', port: 465 });
    expect(options).toMatchObject({ secureTransport: 'on' });
    expect(server.tlsUpgrades()).toBe(0);
  });

  it('sends AUTH PLAIN as a NUL-separated credential', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await sendSmtpMessage(CONFIG, MESSAGE, server.connect);

    const payload = server.sent.find((l) => l.startsWith('AUTH PLAIN '))!.slice('AUTH PLAIN '.length);
    expect(decode(payload)).toBe('\0committee@club.test\0hunter2hunter2');
  });

  it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
    const server = fakeSmtpServer({
      replies: [
        '220 smtp.test ESMTP\r\n',
        '250-smtp.test\r\n250 AUTH LOGIN\r\n',
        '334 VXNlcm5hbWU6\r\n',
        '334 UGFzc3dvcmQ6\r\n',
        '235 ok\r\n',
        '250 ok\r\n',
        '250 ok\r\n',
        '354 go\r\n',
        '250 queued\r\n',
        '221 bye\r\n',
      ],
    });
    await sendSmtpMessage(CONFIG, MESSAGE, server.connect);

    expect(server.sent[1]).toBe('AUTH LOGIN');
    expect(decode(server.sent[2])).toBe('committee@club.test');
    expect(decode(server.sent[3])).toBe('hunter2hunter2');
  });

  it('terminates the body with a lone dot', async () => {
    const server = fakeSmtpServer({ replies: HAPPY_PATH });
    await sendSmtpMessage(CONFIG, MESSAGE, server.connect);
    expect(server.transcript()).toContain('Subject: Hello\r\n\r\nBody\r\n.\r\n');
  });

  describe('STARTTLS', () => {
    const plain = { ...CONFIG, port: 587, secure: false };

    const STARTTLS_SCRIPT = {
      replies: [
        '220 smtp.test ESMTP\r\n',
        '250-smtp.test\r\n250 STARTTLS\r\n',   // EHLO
        '220 2.0.0 Ready to start TLS\r\n',    // STARTTLS
      ],
      repliesAfterTls: [
        '250-smtp.test\r\n250 AUTH PLAIN\r\n', // EHLO again
        '235 ok\r\n',
        '250 ok\r\n',
        '250 ok\r\n',
        '354 go\r\n',
        '250 queued\r\n',
        '221 bye\r\n',
      ],
    };

    it('upgrades the connection and re-issues EHLO', async () => {
      const server = fakeSmtpServer(STARTTLS_SCRIPT);
      await sendSmtpMessage(plain, MESSAGE, server.connect);

      expect(server.connectOptions().options).toMatchObject({ secureTransport: 'starttls' });
      expect(server.tlsUpgrades()).toBe(1);
      expect(server.sent.filter((l) => l.startsWith('EHLO'))).toHaveLength(2);
      expect(server.sent).toContain('STARTTLS');
    });

    it('authenticates only after the upgrade', async () => {
      const server = fakeSmtpServer(STARTTLS_SCRIPT);
      await sendSmtpMessage(plain, MESSAGE, server.connect);

      const auth = server.sent.findIndex((l) => l.startsWith('AUTH'));
      const starttls = server.sent.indexOf('STARTTLS');
      expect(starttls).toBeGreaterThanOrEqual(0);
      expect(auth).toBeGreaterThan(starttls);
    });

    // Carrying on would put the mailbox password on the wire in the clear.
    it('refuses to send credentials to a relay that does not offer STARTTLS', async () => {
      const server = fakeSmtpServer({
        replies: ['220 smtp.test ESMTP\r\n', '250-smtp.test\r\n250 AUTH PLAIN\r\n'],
      });

      await expect(sendSmtpMessage(plain, MESSAGE, server.connect)).rejects.toThrow(/STARTTLS/);
      expect(server.sent.some((l) => l.startsWith('AUTH'))).toBe(false);
    });

    // Data buffered before the handshake would be read back as though it had
    // arrived encrypted — the STARTTLS injection bug.
    it('aborts when the relay sends data before the handshake', async () => {
      const server = fakeSmtpServer({
        replies: [
          '220 smtp.test ESMTP\r\n',
          '250-smtp.test\r\n250 STARTTLS\r\n',
          '220 Ready to start TLS\r\n250 Injected\r\n',
        ],
      });

      await expect(sendSmtpMessage(plain, MESSAGE, server.connect))
        .rejects.toThrow(/before the TLS handshake/);
      expect(server.tlsUpgrades()).toBe(0);
    });
  });

  describe('failures', () => {
    it('raises the reply code and stage when the relay rejects a command', async () => {
      const server = fakeSmtpServer({
        replies: [
          '220 smtp.test ESMTP\r\n',
          '250-smtp.test\r\n250 AUTH PLAIN\r\n',
          '535 5.7.8 Authentication credentials invalid\r\n',
        ],
      });

      const err = await sendSmtpMessage(CONFIG, MESSAGE, server.connect).catch((e) => e);
      expect(err).toBeInstanceOf(SmtpError);
      expect(err.code).toBe(535);
      expect(err.stage).toBe('AUTH');
    });

    it('raises when a recipient is refused', async () => {
      const server = fakeSmtpServer({
        replies: [
          '220 smtp.test ESMTP\r\n',
          '250-smtp.test\r\n250 AUTH PLAIN\r\n',
          '235 ok\r\n',
          '250 ok\r\n',
          '550 5.1.1 No such user\r\n',
        ],
      });

      const err = await sendSmtpMessage(CONFIG, MESSAGE, server.connect).catch((e) => e);
      expect(err.code).toBe(550);
      expect(err.stage).toBe('RCPT TO');
    });

    // An address that carried one would close the command early.
    it('strips angle brackets and whitespace from envelope addresses', async () => {
      const server = fakeSmtpServer({ replies: HAPPY_PATH });
      await sendSmtpMessage(CONFIG, {
        ...MESSAGE,
        to: 'parent@example.com> RCPT TO:<evil@attacker.test',
      }, server.connect);

      expect(server.sent).toContain('RCPT TO:<parent@example.comRCPTTO:evil@attacker.test>');
      expect(server.sent.filter((l) => l.startsWith('RCPT TO'))).toHaveLength(1);
    });

    it('closes the socket when the dialogue fails', async () => {
      const server = fakeSmtpServer({
        replies: ['220 smtp.test\r\n', '250 smtp.test\r\n', '535 nope\r\n'],
      });
      await sendSmtpMessage(CONFIG, MESSAGE, server.connect).catch(() => {});
      expect(server.closed()).toBe(true);
    });

    it('raises when the relay hangs up mid-dialogue', async () => {
      const server = fakeSmtpServer({
        replies: ['220 smtp.test ESMTP\r\n', '250-smtp.test\r\n250 AUTH PLAIN\r\n'],
        closeAt: 1,
      });
      await expect(sendSmtpMessage(CONFIG, MESSAGE, server.connect))
        .rejects.toThrow(/closed the connection/);
    });

    // A relay that stops answering must not hold the request open.
    it('times out a relay that stops answering', async () => {
      vi.useFakeTimers();
      try {
        const server = fakeSmtpServer({ replies: ['220 smtp.test\r\n'], hangAt: 0 });
        const promise = sendSmtpMessage({ ...CONFIG, timeoutMs: 5_000 }, MESSAGE, server.connect);
        const assertion = expect(promise).rejects.toThrow(/timed out after 5000ms/);
        await vi.advanceTimersByTimeAsync(5_000);
        await assertion;
        // Nothing else will close it — the session is parked on a read that
        // will never settle.
        expect(server.closed()).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    // The message is already accepted at that point.
    it('succeeds even when the relay hangs up instead of answering QUIT', async () => {
      const server = fakeSmtpServer({ replies: HAPPY_PATH.slice(0, 7), closeAt: 6 });
      await expect(sendSmtpMessage(CONFIG, MESSAGE, server.connect)).resolves.toBeUndefined();
    });
  });
});

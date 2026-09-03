import { vi } from 'vitest';
import type { Socket } from '@cloudflare/workers-types';
import type { ConnectFn } from '../../lib/smtp';

/**
 * A scripted SMTP server on a fake socket.
 *
 * The client is a protocol implementation, so the only test worth writing is
 * one that actually plays the dialogue: give it a queue of replies, let it talk,
 * then assert on the transcript it produced.
 */

export interface FakeServer {
  connect: ConnectFn;
  /** Every line the client wrote, in order, CRLF stripped. */
  sent: string[];
  /** The whole client-side transcript, unsplit — use for the DATA payload. */
  transcript: () => string;
  /** Options the client passed to connect(). */
  connectOptions: () => { address: unknown; options: unknown };
  /** How many times startTls() was called. */
  tlsUpgrades: () => number;
  closed: () => boolean;
}

export interface ScriptOptions {
  /** Replies handed out in order, one per client command. */
  replies: string[];
  /** Replies for the session after a STARTTLS upgrade. */
  repliesAfterTls?: string[];
  /** End the stream instead of replying, at this index into `replies`. */
  closeAt?: number;
  /** Never answer at this index, so the timeout can be exercised. */
  hangAt?: number;
}

/**
 * The reply queue is consumed one entry per client write. The DATA payload is
 * two writes (the command, then the body), so scripts list a reply for each.
 */
function makeSocket(
  script: string[],
  state: { sent: string[]; raw: string; upgrades: number; closed: boolean },
  opts: { closeAt?: number; hangAt?: number },
  onUpgrade: () => Socket,
): Socket {
  const encoder = new TextEncoder();
  const pending: string[] = [...script];
  let index = 0;

  let deliver: ((chunk: { value?: Uint8Array; done: boolean }) => void) | null = null;
  const inbox: { value?: Uint8Array; done: boolean }[] = [];

  function push(item: { value?: Uint8Array; done: boolean }) {
    if (deliver) {
      const fn = deliver;
      deliver = null;
      fn(item);
    } else {
      inbox.push(item);
    }
  }

  // The greeting arrives unprompted.
  if (pending.length) push({ value: encoder.encode(pending.shift()!), done: false });

  const readable = {
    getReader: () => ({
      read: () =>
        new Promise<{ value?: Uint8Array; done: boolean }>((resolve) => {
          const queued = inbox.shift();
          if (queued) return resolve(queued);
          deliver = resolve;
        }),
      releaseLock: () => { deliver = null; },
    }),
  };

  const writable = {
    getWriter: () => ({
      write: async (chunk: Uint8Array) => {
        const text = new TextDecoder().decode(chunk);
        state.raw += text;
        for (const line of text.split('\r\n')) {
          if (line !== '') state.sent.push(line);
        }

        const at = index++;
        if (opts.hangAt === at) return;
        if (opts.closeAt === at) return push({ done: true });

        const reply = pending.shift();
        if (reply !== undefined) push({ value: encoder.encode(reply), done: false });
      },
      releaseLock: () => {},
    }),
  };

  return {
    readable,
    writable,
    close: async () => { state.closed = true; },
    startTls: () => { state.upgrades++; return onUpgrade(); },
  } as unknown as Socket;
}

export function fakeSmtpServer(script: ScriptOptions): FakeServer {
  const state = { sent: [] as string[], raw: '', upgrades: 0, closed: false };
  let captured: { address: unknown; options: unknown } = { address: null, options: null };

  const connect = vi.fn((address: unknown, options: unknown) => {
    captured = { address, options };
    return makeSocket(
      script.replies,
      state,
      { closeAt: script.closeAt, hangAt: script.hangAt },
      () => makeSocket(script.repliesAfterTls ?? [], state, {}, () => {
        throw new Error('startTls called twice');
      }),
    );
  }) as unknown as ConnectFn;

  return {
    connect,
    sent: state.sent,
    transcript: () => state.raw,
    connectOptions: () => captured,
    tlsUpgrades: () => state.upgrades,
    closed: () => state.closed,
  };
}

/** A relay that accepts everything, on implicit TLS. */
export const HAPPY_PATH: string[] = [
  '220 smtp.test ESMTP ready\r\n',
  '250-smtp.test\r\n250-SIZE 52428800\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n', // EHLO
  '235 2.7.0 Authentication successful\r\n',                                        // AUTH PLAIN
  '250 2.1.0 Sender ok\r\n',                                                        // MAIL FROM
  '250 2.1.5 Recipient ok\r\n',                                                     // RCPT TO
  '354 End data with <CR><LF>.<CR><LF>\r\n',                                        // DATA
  '250 2.0.0 Ok: queued as ABC123\r\n',                                             // body
  '221 2.0.0 Bye\r\n',                                                              // QUIT
];

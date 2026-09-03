import type { Socket, SocketAddress, SocketOptions } from "@cloudflare/workers-types";
import { connect as realConnect } from "./socket-connect";

/**
 * A minimal SMTP submission client for workerd.
 *
 * Cloudflare Workers cannot use nodemailer — it wants `net`, `tls` and `dns` —
 * but they can open TCP sockets through `cloudflare:sockets`, which is enough
 * to speak SMTP directly. That is what this does: EHLO, authenticate, hand over
 * one message, quit.
 *
 * Scope is deliberately narrow. It submits a single already-formed RFC 5322
 * message to one recipient through an authenticated relay. No connection
 * pooling, no pipelining, no delivery to MX hosts, no bounce handling — the
 * relay owns all of that.
 *
 * **Port 25 will not work.** Cloudflare blocks outbound connections on it from
 * Workers. Use 465 (implicit TLS) or 587 (STARTTLS); both are open.
 */

const encoder = new TextEncoder();

export interface SmtpConfig {
  host: string;
  port: number;
  /**
   * true  — TLS from the first byte, the usual choice on port 465.
   * false — connect in the clear and upgrade with STARTTLS, as on port 587.
   *
   * Either way the session is encrypted before credentials are sent; see
   * `openSession`.
   */
  secure: boolean;
  user: string;
  password: string;
  /** Name announced in EHLO. Relays rarely care; some log it. */
  clientName?: string;
  /** Abandon the session after this long. Guards against a relay that hangs. */
  timeoutMs?: number;
}

export interface SmtpMessage {
  /** Envelope sender — a bare address, no display name. */
  from: string;
  /** Envelope recipient — a bare address. */
  to: string;
  /** The complete message, headers and body, already CRLF-delimited. */
  content: string;
}

/** A failed exchange. `code` is the SMTP reply code, or 0 for a transport fault. */
export class SmtpError extends Error {
  readonly code: number;
  readonly stage: string;
  constructor(code: number, stage: string, detail: string) {
    super(`SMTP ${stage} failed${code ? ` (${code})` : ""}: ${detail}`);
    this.name = "SmtpError";
    this.code = code;
    this.stage = stage;
  }
}

export const DEFAULT_TIMEOUT_MS = 20_000;

export type ConnectFn = (address: string | SocketAddress, options?: SocketOptions) => Socket;

interface Reply {
  code: number;
  /** Every line of the reply, newline-joined, codes stripped. */
  text: string;
}

/**
 * Pull one complete reply off the head of the buffer.
 *
 * A reply is one or more lines; continuations are `250-TEXT` and the last line
 * is `250 TEXT`. Returns null while the buffer holds only a partial reply.
 */
export function parseReply(buffer: string): { reply: Reply; rest: string } | null {
  const lines: string[] = [];
  let cursor = 0;

  for (;;) {
    const eol = buffer.indexOf("\r\n", cursor);
    if (eol === -1) return null;

    const line = buffer.slice(cursor, eol);
    cursor = eol + 2;

    const match = /^(\d{3})([ -]?)(.*)$/.exec(line);
    if (!match) {
      // Not a reply line at all. Surfacing code 0 makes the caller reject it
      // rather than treating unparsed noise as success.
      return { reply: { code: 0, text: [...lines, line].join("\n") }, rest: buffer.slice(cursor) };
    }

    lines.push(match[3]);
    if (match[2] !== "-") {
      return { reply: { code: Number(match[1]), text: lines.join("\n") }, rest: buffer.slice(cursor) };
    }
  }
}

/** One SMTP conversation. Not reusable — construct, `run`, discard. */
class SmtpSession {
  private socket: Socket;
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer = "";
  /** Per-session: a streaming decoder holds state, and the STARTTLS upgrade
   *  starts a second session on the same request. */
  private decoder = new TextDecoder();
  /** Capabilities from the most recent EHLO, upper-cased. */
  private capabilities: string[] = [];

  constructor(socket: Socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.writer = socket.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
  }

  private async read(stage: string): Promise<Reply> {
    for (;;) {
      const parsed = parseReply(this.buffer);
      if (parsed) {
        this.buffer = parsed.rest;
        return parsed.reply;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new SmtpError(0, stage, "the server closed the connection");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  private async write(line: string): Promise<void> {
    await this.writer.write(encoder.encode(line));
  }

  /** Send a command and require a reply in the expected 2xx/3xx family. */
  private async command(stage: string, line: string, expected: number): Promise<Reply> {
    await this.write(`${line}\r\n`);
    return this.expect(stage, expected);
  }

  private async expect(stage: string, expected: number): Promise<Reply> {
    const reply = await this.read(stage);
    if (Math.floor(reply.code / 100) !== expected) {
      throw new SmtpError(reply.code, stage, reply.text);
    }
    return reply;
  }

  private async ehlo(clientName: string): Promise<void> {
    const reply = await this.command("EHLO", `EHLO ${clientName}`, 2);
    this.capabilities = reply.text
      .split("\n")
      .map((l) => l.trim().toUpperCase())
      .filter(Boolean);
  }

  private supports(capability: string): boolean {
    return this.capabilities.some((c) => c === capability || c.startsWith(`${capability} `));
  }

  private authMechanisms(): string[] {
    const line = this.capabilities.find((c) => c === "AUTH" || c.startsWith("AUTH "));
    return line ? line.slice(4).trim().split(/\s+/).filter(Boolean) : [];
  }

  private async authenticate(user: string, password: string): Promise<void> {
    const mechanisms = this.authMechanisms();

    // PLAIN first: one round trip instead of three, and both are equally
    // dependent on the session already being encrypted.
    if (mechanisms.includes("PLAIN") || mechanisms.length === 0) {
      await this.command("AUTH", `AUTH PLAIN ${base64(`\0${user}\0${password}`)}`, 2);
      return;
    }
    if (mechanisms.includes("LOGIN")) {
      await this.command("AUTH", "AUTH LOGIN", 3);
      await this.command("AUTH", base64(user), 3);
      await this.command("AUTH", base64(password), 2);
      return;
    }
    throw new SmtpError(0, "AUTH", `server offers no supported mechanism (${mechanisms.join(", ") || "none"})`);
  }

  /**
   * Upgrade a plaintext connection.
   *
   * If the relay does not advertise STARTTLS we stop here rather than carry on
   * — continuing would put the mailbox password on the wire in the clear.
   */
  private async startTls(config: SmtpConfig): Promise<SmtpSession> {
    if (!this.supports("STARTTLS")) {
      throw new SmtpError(
        0,
        "STARTTLS",
        `${config.host}:${config.port} does not offer STARTTLS; refusing to send credentials unencrypted`,
      );
    }
    await this.command("STARTTLS", "STARTTLS", 2);

    // Anything still buffered was sent before the handshake and would be read
    // back as though it had arrived encrypted — the STARTTLS injection bug.
    // A well-behaved relay sends nothing here.
    if (this.buffer.length > 0) {
      throw new SmtpError(0, "STARTTLS", "the server sent data before the TLS handshake");
    }

    // The locks have to go before the socket can be handed over.
    this.reader.releaseLock();
    this.writer.releaseLock();

    const secure = this.socket.startTls({ expectedServerHostname: config.host });
    return new SmtpSession(secure);
  }

  private async quit(): Promise<void> {
    // A relay that hangs up rather than answering QUIT has still accepted the
    // message — never turn that into a failure.
    try {
      await this.write("QUIT\r\n");
      await this.read("QUIT");
    } catch {
      /* the message is already accepted */
    }
    await this.socket.close().catch(() => {});
  }

  static async run(socket: Socket, config: SmtpConfig, message: SmtpMessage): Promise<void> {
    const clientName = config.clientName ?? "clubsplatform";
    let session = new SmtpSession(socket);

    try {
      await session.expect("greeting", 2);
      await session.ehlo(clientName);

      if (!config.secure) {
        session = await session.startTls(config);
        // A fresh handshake means fresh capabilities, and the relay only
        // advertises AUTH once the channel is encrypted.
        await session.ehlo(clientName);
      }

      await session.authenticate(config.user, config.password);
      await session.command("MAIL FROM", `MAIL FROM:<${envelopeAddress(message.from)}>`, 2);
      await session.command("RCPT TO", `RCPT TO:<${envelopeAddress(message.to)}>`, 2);
      await session.command("DATA", "DATA", 3);

      // The body is base64 encoded, so no line can begin with a bare "." and
      // dot-stuffing has nothing to do.
      await session.write(`${message.content}\r\n.\r\n`);
      await session.expect("message", 2);

      await session.quit();
    } catch (err) {
      await session.socket.close().catch(() => {});
      throw err;
    }
  }
}

/**
 * Angle brackets and whitespace are structural in MAIL FROM / RCPT TO, so they
 * come out — an address carrying one would otherwise close the command early.
 */
function envelopeAddress(value: string): string {
  return value.replace(/[\r\n<>\s]/g, "");
}

function base64(value: string): string {
  const bytes = encoder.encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Reject after `ms`, so a relay that stops answering cannot hold the request open. */
function withTimeout<T>(promise: Promise<T>, ms: number, stage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError(0, stage, `timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Submit one message. Resolves when the relay has accepted it, throws
 * `SmtpError` otherwise.
 *
 * `connect` is injectable purely so the tests can drive a scripted socket.
 */
export async function sendSmtpMessage(
  config: SmtpConfig,
  message: SmtpMessage,
  connect: ConnectFn = realConnect as ConnectFn,
): Promise<void> {
  const socket = connect(
    { hostname: config.host, port: config.port },
    {
      // "starttls" is what makes socket.startTls() available later; it does not
      // encrypt anything on its own.
      secureTransport: config.secure ? "on" : "starttls",
      allowHalfOpen: false,
    },
  );

  try {
    await withTimeout(
      SmtpSession.run(socket, config, message),
      config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "session",
    );
  } catch (err) {
    // On a timeout the session is still parked on a read that will never
    // settle, so nothing else is going to close this.
    await socket.close().catch(() => {});
    throw err;
  }
}

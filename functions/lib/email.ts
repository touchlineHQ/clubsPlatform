import { sendSmtpMessage, SmtpError, type ConnectFn, type SmtpConfig } from "./smtp";

/**
 * Transactional email for the Pages Functions.
 *
 * Deliberately the same shape as `getPostHog()`: `getMailer()` returns null
 * unless the SMTP settings are complete, and every call site is guarded. A club
 * running without them keeps working exactly as it did — it just cannot send
 * mail — rather than 500ing on a password reset.
 *
 * Any SMTP relay will do: the club's own mailbox provider, a transactional
 * service's SMTP endpoint, whatever the committee already pays for. Nothing
 * outside this file knows how a message gets sent; `smtp.ts` owns the protocol
 * and this file owns the envelope and the MIME.
 */

export interface EmailEnv {
  SMTP_HOST?: string;
  /** Defaults to 465. Cloudflare blocks port 25 — use 465 or 587. */
  SMTP_PORT?: string;
  /** "true" (default) for implicit TLS on 465; "false" to upgrade with STARTTLS. */
  SMTP_SECURE?: string;
  SMTP_USER?: string;
  /** Cloudflare Pages secret — never a plain var. See the README. */
  SMTP_PASSWORD?: string;
  /** Address messages are sent from, e.g. `committee@yourdomain.com`. */
  FROM_EMAIL?: string;
  /** Abandon a hung relay after this many milliseconds. */
  SMTP_TIMEOUT_MS?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Display name in the From header. This is what makes mail read as the club
   * rather than as the platform — the address stays `FROM_EMAIL`, because that
   * is the mailbox the relay will let us authenticate as.
   */
  fromName?: string;
  /** Where a reply goes. The club's own contact address when it has one. */
  replyTo?: string | null;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}

/** Used when a club has no name of its own to put in the From header. */
export const DEFAULT_FROM_NAME = "Club Platform";

const DEFAULT_PORT = 465;

/** Raised when the relay rejects a message. Carries the SMTP reply code. */
export class EmailDeliveryError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Email relay rejected the message${status ? ` (${status})` : ""}: ${detail}`);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}

/**
 * Strip anything from a club-controlled display name that could close the From
 * phrase or open a new header. A club name has no legitimate use for these, and
 * injection here would let one club send mail appearing to come from another.
 *
 * Only for display names — it is too aggressive for a subject line, which is
 * allowed its colons and commas.
 */
function sanitiseDisplayName(value: string): string {
  return value.replace(/[\r\n"<>,;:\\]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The minimum any header value needs: no CR or LF, which are the only
 * characters that can end a header and start another.
 */
function sanitiseHeaderValue(value: string): string {
  // A CRLF run collapses to one space, so a folded value does not come out
  // with a gap where the line break was.
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Strip CR and LF from an address before it goes in a header or the envelope. */
function sanitiseAddress(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}

/**
 * Build an RFC 5322 From header.
 */
export function formatFrom(address: string, name?: string): string {
  const safe = sanitiseDisplayName(name ?? "");
  return safe ? `${safe} <${sanitiseAddress(address)}>` : sanitiseAddress(address);
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Base64 in 76-character lines, as RFC 2045 requires. */
function base64Body(value: string): string {
  return (base64(value).match(/.{1,76}/g) ?? []).join("\r\n");
}

/**
 * Encode a header value that may contain non-ASCII — a club name with an
 * accent in it, say — per RFC 2047. Plain ASCII is left readable.
 */
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${base64(value)}?=`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** RFC 5322 date, always in UTC. `toUTCString()` ends in "GMT", which is obsolete syntax. */
export function formatDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${DAYS[date.getUTCDay()]}, ${pad(date.getUTCDate())} ${MONTHS[date.getUTCMonth()]} ` +
    `${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:` +
    `${pad(date.getUTCSeconds())} +0000`
  );
}

/**
 * Assemble the RFC 5322 message.
 *
 * Both bodies are base64 encoded rather than quoted-printable. It costs a third
 * more bytes and buys three problems away at once: no line can exceed SMTP's
 * 998-octet limit, no line can begin with a bare "." and need dot-stuffing, and
 * non-ASCII in a club's name or address survives intact.
 */
export function buildMimeMessage(opts: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
  date?: Date;
  boundary?: string;
  messageId?: string;
}): string {
  const boundary = opts.boundary ?? `=_cp_${crypto.randomUUID()}`;
  const domain = opts.from.split("@")[1] ?? "clubsplatform";
  const messageId = opts.messageId ?? `${crypto.randomUUID()}@${domain}`;

  const headers = [
    `From: ${formatFrom(opts.from, opts.fromName)}`,
    `To: ${sanitiseAddress(opts.to)}`,
    `Subject: ${encodeHeaderValue(sanitiseHeaderValue(opts.subject))}`,
    `Message-ID: <${messageId}>`,
    `Date: ${formatDate(opts.date ?? new Date())}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (opts.replyTo) headers.splice(1, 0, `Reply-To: ${sanitiseAddress(opts.replyTo)}`);

  // Plain text first: RFC 2046 says the last part is the one clients prefer,
  // and we want the HTML to win wherever it can be shown.
  return [
    ...headers,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(opts.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Body(opts.html),
    `--${boundary}--`,
  ].join("\r\n");
}

/** Read the SMTP settings out of the environment, or null when incomplete. */
export function readSmtpConfig(env: EmailEnv): (SmtpConfig & { fromEmail: string }) | null {
  const { SMTP_HOST, SMTP_USER, SMTP_PASSWORD, FROM_EMAIL } = env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD || !FROM_EMAIL) return null;

  const port = Number(env.SMTP_PORT ?? DEFAULT_PORT);
  const timeout = Number(env.SMTP_TIMEOUT_MS ?? NaN);

  return {
    host: SMTP_HOST,
    port: Number.isFinite(port) && port > 0 ? port : DEFAULT_PORT,
    // Anything other than an explicit "false"/"0" means implicit TLS. The safe
    // reading of a typo is "encrypt it", not "send my password in the clear".
    secure: !(env.SMTP_SECURE === "false" || env.SMTP_SECURE === "0"),
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    fromEmail: FROM_EMAIL,
    ...(Number.isFinite(timeout) && timeout > 0 ? { timeoutMs: timeout } : {}),
  };
}

/**
 * Returns a mailer, or null when transactional email is not configured.
 * Callers must treat null as "sending is off", never as an error.
 *
 * `connect` is injectable purely so the tests can drive a scripted socket.
 */
export function getMailer(env: EmailEnv, connect?: ConnectFn): Mailer | null {
  const config = readSmtpConfig(env);
  if (!config) return null;

  return {
    async send(message: OutgoingEmail): Promise<void> {
      const content = buildMimeMessage({
        from: config.fromEmail,
        fromName: message.fromName ?? DEFAULT_FROM_NAME,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });

      try {
        await sendSmtpMessage(
          config,
          { from: config.fromEmail, to: sanitiseAddress(message.to), content },
          connect,
        );
      } catch (err) {
        // Everything above this line is provider-agnostic, so the rest of the
        // codebase only ever sees EmailDeliveryError.
        if (err instanceof SmtpError) {
          throw new EmailDeliveryError(err.code, `${err.stage}: ${err.message}`.slice(0, 500));
        }
        throw err;
      }
    },
  };
}

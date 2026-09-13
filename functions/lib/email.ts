/**
 * Transactional email over Resend's HTTP API.
 *
 * The provider is reached with `fetch` rather than SMTP deliberately. workerd
 * has no `net`, `tls` or `dns`, so nodemailer cannot run here at all, and the
 * alternative — speaking SMTP over `cloudflare:sockets` — means owning an
 * implementation of AUTH, STARTTLS and dot-stuffing for the sake of a request
 * the provider already exposes as one POST.
 */

export interface MailEnv {
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
}

export interface OutboundMessage {
  /** Recipient address. One per message — this is transactional mail, not a campaign. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name the message appears to come from. The address is always FROM_EMAIL. */
  fromName?: string;
  /** Where a reply should land. Omitted entirely when the club has no contact address. */
  replyTo?: string;
}

export interface Mailer {
  send(message: OutboundMessage): Promise<void>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Strip anything structural from an address: CR/LF, angle brackets, commas,
 * whitespace and control characters. What is left is either a usable address
 * or obviously not one, and never a second header or a second recipient.
 */
export function sanitizeAddress(address: string): string {
  // eslint-disable-next-line no-control-regex
  return address.replace(/[\r\n<>,;"\\\s\u0000-\u001F\u007F]/g, "");
}

/**
 * A subject is free text, so it keeps its colons and commas — only the line
 * breaks that would end the header go.
 */
export function sanitizeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  // A run of them collapses to one space — a CRLF is two characters and
  // would otherwise leave a visible double gap in the subject line.
  return subject.replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim();
}

/**
 * Render a From value as `"Club Name" <address>`.
 *
 * The display name is admin-editable text going into a mail header, so it
 * loses the quote and backslash that could close the quoted phrase, along
 * with CR/LF and control characters. A name left empty after that is dropped
 * rather than sent as an empty phrase.
 */
export function formatFrom(name: string | undefined, address: string): string {
  const cleanAddress = sanitizeAddress(address);
  // eslint-disable-next-line no-control-regex
  const cleanName = (name ?? "").replace(/["\\\r\n\u0000-\u001F\u007F]/g, "").trim();
  return cleanName ? `${JSON.stringify(cleanName)} <${cleanAddress}>` : cleanAddress;
}

/**
 * Build a mailer, or return null when the provider is not configured.
 *
 * This follows `getPostHog()` exactly: null unless **both** `RESEND_API_KEY`
 * and `FROM_EMAIL` are set, and every call site is guarded. A club without
 * mail configured keeps working — it simply cannot send — rather than
 * returning 500 from a password reset.
 *
 * `deps.fetch` exists so tests can drive the provider dialogue without a
 * network call; production passes nothing and gets the global.
 */
export function getMailer(
  env: MailEnv,
  deps?: { fetch?: typeof fetch },
): Mailer | null {
  const apiKey = env.RESEND_API_KEY;
  const fromEmail = env.FROM_EMAIL;
  if (!apiKey || !fromEmail) return null;

  const doFetch = deps?.fetch ?? fetch;

  return {
    async send(message: OutboundMessage): Promise<void> {
      const to = sanitizeAddress(message.to);
      if (!to.includes("@")) throw new Error("Refusing to send to an invalid address");

      const replyTo = message.replyTo ? sanitizeAddress(message.replyTo) : "";

      const res = await doFetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: formatFrom(message.fromName, fromEmail),
          to: [to],
          subject: sanitizeSubject(message.subject),
          html: message.html,
          text: message.text,
          ...(replyTo.includes("@") ? { reply_to: replyTo } : {}),
        }),
      });

      if (!res.ok) {
        // The body carries the provider's reason (bad key, unverified domain,
        // rejected recipient). Callers log this; none of them surface it.
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend rejected the message (${res.status}): ${detail.slice(0, 500)}`);
      }
    },
  };
}

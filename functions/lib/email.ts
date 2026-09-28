/**
 * Outbound mail provider client (#72 / #133).
 *
 * Follows getPostHog(): null unless RESEND_API_KEY and FROM_EMAIL are both set.
 * Club contact sends must go through send-guard.ts — this module is the thin
 * provider boundary only. Do not call getMailer from route handlers to address
 * player_contact rows; resolve recipients via purpose + audience instead.
 */

export interface MailEnv {
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
}

export interface OutboundMessage {
  /** Recipient address. One per message. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name; the address is always FROM_EMAIL. */
  fromName?: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: OutboundMessage): Promise<{ id?: string }>;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** Strip structural characters so an address cannot smuggle a second header. */
export function sanitizeAddress(address: string): string {
  // eslint-disable-next-line no-control-regex
  return address.replace(/[\r\n<>,;"\\\s\u0000-\u001F\u007F]/g, "");
}

export function sanitizeSubject(subject: string): string {
  // eslint-disable-next-line no-control-regex
  return subject.replace(/[\r\n\u0000-\u001F\u007F]+/g, " ").trim();
}

export function formatFrom(name: string | undefined, address: string): string {
  const cleanAddress = sanitizeAddress(address);
  // eslint-disable-next-line no-control-regex
  const cleanName = (name ?? "").replace(/["\\\r\n\u0000-\u001F\u007F]/g, "").trim();
  return cleanName ? `${JSON.stringify(cleanName)} <${cleanAddress}>` : cleanAddress;
}

/**
 * Build a mailer, or null when the provider is not configured.
 * Production deploys without RESEND keep working — they simply cannot send.
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
    async send(message: OutboundMessage): Promise<{ id?: string }> {
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
        const detail = await res.text().catch(() => "");
        throw new Error(`Resend rejected the message (${res.status}): ${detail.slice(0, 500)}`);
      }

      try {
        const body = await res.json() as { id?: string };
        return { id: typeof body.id === "string" ? body.id : undefined };
      } catch {
        return {};
      }
    },
  };
}

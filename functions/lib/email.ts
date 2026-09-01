/**
 * Transactional email for the Pages Functions.
 *
 * Deliberately the same shape as `getPostHog()`: `getMailer()` returns null
 * unless the provider is fully configured, and every call site is guarded. A
 * club running without `EMAIL_API_KEY` keeps working exactly as it did — it
 * just cannot send mail — rather than 500ing on a password reset.
 *
 * The provider is Resend, reached over its HTTP API because the Node SDK is
 * not workerd-friendly. Swapping providers means replacing `send()`; nothing
 * outside this file knows what is behind it.
 */

export interface EmailEnv {
  /** Provider API key. Cloudflare Pages secret — see the README. */
  EMAIL_API_KEY?: string;
  /** Envelope sender, e.g. `no-reply@touchlinehq.co.uk`. Must be a verified domain. */
  EMAIL_FROM?: string;
  /** Provider API base. Overridable so tests never touch the network. */
  EMAIL_API_BASE?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Display name in the From header. This is what makes mail read as the club
   * rather than as the platform — the address stays the platform's verified
   * sending domain, because a club cannot verify one it does not own.
   */
  fromName?: string;
  /** Where a reply goes. The club's own contact address when it has one. */
  replyTo?: string | null;
}

export interface Mailer {
  send(message: OutgoingEmail): Promise<void>;
}

const DEFAULT_API_BASE = "https://api.resend.com";

/** Used when a club has no name of its own to put in the From header. */
export const DEFAULT_FROM_NAME = "Club Platform";

/** Raised when the provider rejects a message. Carries the status for logging. */
export class EmailDeliveryError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(`Email provider responded ${status}: ${detail}`);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}

/**
 * Build an RFC 5322 From header.
 *
 * The display name is club-controlled text, so quotes and anything that could
 * close the phrase or start a new header are stripped rather than escaped —
 * a club name has no legitimate use for them, and header injection here would
 * let one club send mail that appears to come from another.
 */
export function formatFrom(address: string, name?: string): string {
  const safe = (name ?? "").replace(/[\r\n"<>,;:\\]/g, " ").replace(/\s+/g, " ").trim();
  return safe ? `${safe} <${address}>` : address;
}

/**
 * Returns a mailer, or null when transactional email is not configured.
 * Callers must treat null as "sending is off", never as an error.
 */
export function getMailer(env: EmailEnv): Mailer | null {
  const apiKey = env.EMAIL_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) return null;

  const base = (env.EMAIL_API_BASE ?? DEFAULT_API_BASE).replace(/\/+$/, "");

  return {
    async send(message: OutgoingEmail): Promise<void> {
      const res = await fetch(`${base}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: formatFrom(from, message.fromName ?? DEFAULT_FROM_NAME),
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });

      if (!res.ok) {
        // Truncated: provider error bodies can be long, and this string ends up
        // in a PostHog exception property.
        const detail = (await res.text().catch(() => "")).slice(0, 500);
        throw new EmailDeliveryError(res.status, detail);
      }
    },
  };
}

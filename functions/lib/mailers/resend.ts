/**
 * Resend HTTP provider for outbound mail.
 *
 * Provider-specific: do not import this from route handlers. Use getMailer()
 * from ../email, which returns null when Resend is not configured.
 */

import {
  formatFrom,
  sanitizeAddress,
  sanitizeSubject,
} from "../email-format";
import type { Mailer, OutboundMessage } from "../email";

export interface ResendMailEnv {
  RESEND_API_KEY?: string;
  FROM_EMAIL?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

/**
 * Build a Resend-backed mailer, or null when API key / from-address are missing.
 * Same null pattern as getPostHog(): unconfigured deploys simply cannot send.
 */
export function createResendMailer(
  env: ResendMailEnv,
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
        signal: AbortSignal.timeout(10_000),
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

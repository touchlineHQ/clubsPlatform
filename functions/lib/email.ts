/**
 * Provider-agnostic outbound mail surface.
 *
 * Club contact sends must go through send-guard.ts. This module owns the
 * Mailer contract, shared header sanitizers, and getMailer() selection —
 * not any one provider's HTTP client. Resend lives in ./mailers/resend.
 */

import { createResendMailer } from "./mailers/resend";

export {
  formatFrom,
  sanitizeAddress,
  sanitizeSubject,
} from "./email-format";

export interface MailEnv {
  /** Present when the Resend provider should be used. */
  RESEND_API_KEY?: string;
  /** Verified from-address for the configured provider. */
  FROM_EMAIL?: string;
}

export interface OutboundMessage {
  /** Recipient address. One per message. */
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Display name; the address comes from the provider / FROM_EMAIL. */
  fromName?: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: OutboundMessage): Promise<{ id?: string }>;
}

/**
 * Build a mailer for the configured provider, or null when none is set.
 * Follows getPostHog(): unconfigured deploys keep working and simply cannot send.
 *
 * Today that means Resend when RESEND_API_KEY + FROM_EMAIL are both present.
 * Callers depend only on Mailer — swap the implementation without touching them.
 */
export function getMailer(
  env: MailEnv,
  deps?: { fetch?: typeof fetch },
): Mailer | null {
  return createResendMailer(env, deps);
}

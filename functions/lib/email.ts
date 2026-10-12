/**
 * Provider-agnostic outbound mail surface.
 *
 * Club contact sends must go through send-guard.ts. This module owns the
 * Mailer contract, shared header sanitizers, and getMailer() selection —
 * not any one provider's HTTP client. Resend lives in ./mailers/resend.
 */

import { createResendMailer } from "./mailers/resend";
import { applyMailLayout, type MailFooter } from "./mail-layout";

export type { MailFooter } from "./mail-layout";

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
  /** Body only — the shared layout adds the footer (#135). */
  html: string;
  text: string;
  /**
   * Required: which footer this message carries. Operational and marketing
   * mail must supply a one-click unsubscribe URL; transactional mail says
   * plainly that it has no unsubscribe.
   */
  footer: MailFooter;
  /** Display name; the address comes from the provider / FROM_EMAIL. */
  fromName?: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: OutboundMessage): Promise<{ id?: string }>;
}

/** What a provider receives: the body with the footer already applied. */
export interface ProviderMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  fromName?: string;
  replyTo?: string;
}

export interface MailProvider {
  send(message: ProviderMessage): Promise<{ id?: string }>;
}

/**
 * Wrap a provider so every message goes through the shared layout. This is
 * the only way a Mailer is built, so no send path can skip the footer.
 */
export function withMailLayout(provider: MailProvider): Mailer {
  return {
    async send(message: OutboundMessage) {
      const laidOut = applyMailLayout(message);
      return provider.send({
        to: message.to,
        subject: message.subject,
        html: laidOut.html,
        text: laidOut.text,
        headers: laidOut.headers,
        fromName: message.fromName,
        replyTo: message.replyTo,
      });
    },
  };
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
  const provider = createResendMailer(env, deps);
  return provider ? withMailLayout(provider) : null;
}

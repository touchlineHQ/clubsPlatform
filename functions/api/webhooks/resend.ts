import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { applyDeliveryFeedback } from "../../lib/unsubscribe";
import { verifySvixSignature } from "../../lib/webhook-signature";

/**
 * Resend delivery webhook (#135).
 *
 * email.bounced   → the contact is marked `bounced` (Resend only sends this
 *                   for a permanent rejection; a Transient type is ignored).
 * email.complained → treated as withdrawal of all club mail.
 *
 * Messages are matched by provider message id against email_send_event, so
 * the payload's addresses are never read or stored. Unknown ids are accepted
 * and ignored, so the response says nothing about what we hold.
 */

type ResendEvent = {
  type?: string;
  data?: {
    email_id?: string;
    bounce?: { type?: string };
  };
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook not configured" }, { status: 503 });

  const body = await context.request.text();
  if (!(await verifySvixSignature(secret, context.request.headers, body))) {
    return json({ error: "invalid signature" }, { status: 401 });
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return json({ error: "invalid payload" }, { status: 400 });
  }

  const emailId = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  const isBounce = event.type === "email.bounced"
    && (event.data?.bounce?.type ?? "").toLowerCase() !== "transient";
  const isComplaint = event.type === "email.complained";
  if (!emailId || (!isBounce && !isComplaint)) return json({ ok: true });

  await ensureTables(context.env.DB);
  const kind = isComplaint ? "complaint" : "bounce";
  const applied = await applyDeliveryFeedback(context.env.DB, { providerMessageId: emailId, kind });

  if (applied) {
    const posthog = getPostHog(context.env);
    if (posthog) {
      context.waitUntil(
        posthog
          .captureImmediate({
            distinctId: `club:${applied.clubSlug}`,
            event: "contact delivery feedback applied",
            ...clubGroups(applied.clubSlug),
            // Kind only: no contact id, message id or address.
            properties: { club_slug: applied.clubSlug, kind },
          })
          .catch((err) => console.error("PostHog capture failed", err)),
      );
    }
  }

  return json({ ok: true });
};

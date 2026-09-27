import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAuth, getClubSlug } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  ConsentPolicyMismatchError,
  parseConsentPolicy,
  recordMarketingConsentGrant,
  requestIp,
  unsubscribePath,
} from "../../lib/consent";

/**
 * Subject grants marketing-email consent for a player_contact they own (#75).
 * Club admins cannot grant marketing consent on a parent's behalf.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  const auth = await requireAuth(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  const body = (await context.request.json()) as Partial<{
    contactId: string;
    policyVersion: string;
    wordingHash: string;
  }>;

  const contactId = body.contactId?.trim() ?? "";
  if (!contactId) {
    return json({ error: "contactId is required" }, { status: 400 });
  }

  const policy = parseConsentPolicy(body);
  if (!policy) {
    return json({ error: "policyVersion and wordingHash are required" }, { status: 400 });
  }

  const userId = auth.session.user.id as string;
  const userEmail = String((auth.session.user as Record<string, unknown>).email ?? "")
    .trim()
    .toLowerCase();

  const contact = await context.env.DB
    .prepare(
      `SELECT pc.id, pc.email, pc.playerId, pc.state
         FROM "player_contact" pc
        WHERE pc.id = ? AND pc.clubSlug = ?`,
    )
    .bind(contactId, clubSlug)
    .first<{ id: string; email: string; playerId: string; state: string }>();

  if (!contact) {
    return json({ error: "Contact not found" }, { status: 404 });
  }

  // Subject must own the address (email match) or be linked to the player.
  const emailMatch = contact.email.trim().toLowerCase() === userEmail;
  const linked = await context.env.DB
    .prepare(
      `SELECT id FROM "user_player" WHERE userId = ? AND playerId = ?`,
    )
    .bind(userId, contact.playerId)
    .first<{ id: string }>();

  if (!emailMatch && !linked) {
    return json({ error: "Only the contact subject can grant marketing consent" }, { status: 403 });
  }

  try {
    const { recordId, withdrawToken } = await recordMarketingConsentGrant(context.env.DB, {
      clubSlug,
      subjectType: "player_contact",
      subjectId: contactId,
      ipAddress: requestIp(context.request),
      policy,
    });

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: userId,
        event: "marketing consent granted",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          contact_id: contactId,
          record_id: recordId,
          policy_version: policy.policyVersion,
        },
      });
    }

    return json({
      ok: true,
      recordId,
      // Returned once so activation/mail flows can embed it; not stored in plaintext.
      unsubscribePath: unsubscribePath(withdrawToken),
    }, { status: 201 });
  } catch (err) {
    if (err instanceof ConsentPolicyMismatchError) {
      return json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
};

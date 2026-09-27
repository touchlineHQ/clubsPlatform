import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  currentAcceptedLiabilities,
  currentPolicyPayload,
  hasCurrentEmailSignoff,
  parseSignoffPolicy,
  parseSignoffTicks,
  recordEmailSignoff,
  requestIp,
  SignoffIncompleteError,
  SignoffPolicyMismatchError,
} from "../../lib/club-email-signoff";

/** Current sign-off status + the wording the admin must see before ticking. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) {
    return json({ error: "X-Club-Slug header is required" }, { status: 400 });
  }

  const policy = await currentPolicyPayload();
  const accepted = await currentAcceptedLiabilities(context.env.DB, clubSlug);
  const current = await hasCurrentEmailSignoff(context.env.DB, clubSlug);

  return json({
    ...policy,
    current,
    acceptedLiabilities: accepted,
  });
};

/**
 * Record independent acceptance of every liability under the current wording.
 * Partial bodies are rejected — there is no accept-all shortcut.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  await ensureTables(context.env.DB);

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) {
    return json({ error: "X-Club-Slug header is required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const bodyObject = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const ticks = parseSignoffTicks(bodyObject?.liabilities);
  const policy = parseSignoffPolicy(bodyObject);
  if (!ticks || !policy) {
    return json(
      {
        error:
          "Each of parental_consent, operational_split and right_to_object must be independently true",
      },
      { status: 400 },
    );
  }

  const userId = (result.session.user as Record<string, unknown>).id as string;
  const ipAddress = requestIp(context.request);

  try {
    const { acceptanceId, alreadyHeld } = await recordEmailSignoff(context.env.DB, {
      clubSlug,
      userId,
      ipAddress,
      ticks,
      policy,
    });

    if (!alreadyHeld) {
      const posthog = getPostHog(context.env);
      if (posthog) {
        await posthog.captureImmediate({
          distinctId: userId,
          event: "club email signoff accepted",
          ...clubGroups(clubSlug),
          properties: {
            club_slug: clubSlug,
            acceptance_id: acceptanceId,
            policy_version: (await currentPolicyPayload()).policyVersion,
          },
        });
      }
    }

    return json({ ok: true, acceptanceId, alreadyHeld, current: true });
  } catch (err) {
    if (err instanceof SignoffIncompleteError) {
      return json({ error: err.message }, { status: 400 });
    }
    if (err instanceof SignoffPolicyMismatchError) {
      return json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
};

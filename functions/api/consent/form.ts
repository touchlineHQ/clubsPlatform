import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  currentMarketingConsentPolicy,
  currentOperationalConsentPolicy,
  parseConsentPolicy,
  requestIp,
} from "../../lib/consent";
import {
  ParentConsentError,
  findContactByActivationToken,
  declineActivationByToken,
  submitParentConsentForm,
  withdrawParentConsentByToken,
} from "../../lib/parent-consent";

/**
 * Public parent consent form API (#149). No auth — the activation token is the
 * credential. Club is resolved from the token, not from X-Club-Slug.
 */

/**
 * One response for every token that cannot be activated: unknown, expired,
 * spent (already activated), declined. Same status and body so the link tells
 * a stranger nothing; the page offers a fresh link in all of these cases.
 */
function linkUnavailable() {
  return json(
    { error: "This link is no longer valid", code: "link_unavailable" },
    { status: 404 },
  );
}

async function teamFor(db: Env["DB"], clubSlug: string, playerId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT teamName FROM "player_registration"
        WHERE clubSlug = ? AND playerId = ? ORDER BY updatedAt DESC LIMIT 1`,
    )
    .bind(clubSlug, playerId)
    .first<{ teamName: string }>();
  return row?.teamName ?? null;
}

async function clubName(db: Env["DB"], clubSlug: string): Promise<string> {
  const row = await db
    .prepare(`SELECT name FROM "club_config" WHERE slug = ?`)
    .bind(clubSlug)
    .first<{ name: string }>();
  return row?.name ?? clubSlug;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const token = new URL(context.request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) return json({ error: "token is required" }, { status: 400 });

  const contact = await findContactByActivationToken(context.env.DB, token);
  if (
    !contact
    || contact.state !== "pending"
    || (contact.activationExpiresAt != null && contact.activationExpiresAt < Date.now())
  ) {
    return linkUnavailable();
  }

  const [operational, marketing, name, teamName] = await Promise.all([
    currentOperationalConsentPolicy(),
    currentMarketingConsentPolicy(),
    clubName(context.env.DB, contact.clubSlug),
    teamFor(context.env.DB, contact.clubSlug, contact.playerId),
  ]);

  return json({
    club: {
      slug: contact.clubSlug,
      name,
      privacyPath: "/#/privacy",
    },
    contact: {
      id: contact.id,
      email: contact.email,
      state: contact.state,
      relationship: contact.relationship,
      operationalOptIn: contact.operationalOptIn === 1,
      marketingOptIn: contact.marketingOptIn === 1,
      fanId: contact.fanId,
      teamName,
    },
    operational,
    marketing,
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  let body: Record<string, unknown>;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "submit";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return json({ error: "token is required" }, { status: 400 });

  const ip = requestIp(context.request);

  if (action === "decline") {
    try {
      const result = await declineActivationByToken(context.env.DB, token);
      const posthog = getPostHog(context.env);
      if (posthog) {
        await posthog.captureImmediate({
          distinctId: `consent:${result.contactId}`,
          event: "parent contact declined",
          ...clubGroups(result.clubSlug),
          properties: { club_slug: result.clubSlug, source: "activation_email" },
        });
      }
      return json({ ok: true, declined: true });
    } catch (err) {
      if (err instanceof ParentConsentError) return linkUnavailable();
      throw err;
    }
  }

  if (action === "withdraw") {
    try {
      const result = await withdrawParentConsentByToken(context.env.DB, token, ip);
      const posthog = getPostHog(context.env);
      if (posthog) {
        await posthog.captureImmediate({
          distinctId: `consent:${result.contactId}`,
          event: "parent contact withdrawn",
          ...clubGroups(result.clubSlug),
          properties: {
            club_slug: result.clubSlug,
            contact_id: result.contactId,
            source: "parent_consent_form",
          },
        });
      }
      return json({ ok: true, withdrawn: true, contactId: result.contactId });
    } catch (err) {
      if (err instanceof ParentConsentError) {
        const status = err.code === "not_found" ? 404
          : err.code === "invalid_state" ? 409
            : 400;
        return json({ error: err.message, code: err.code }, { status });
      }
      throw err;
    }
  }

  const email = typeof body.email === "string" ? body.email : "";
  const operationalAgreed = body.operationalAgreed === true;
  if (!operationalAgreed) {
    return json(
      { error: "You must agree that the club may use this address for operational admin" },
      { status: 400 },
    );
  }

  const operationalPolicy = parseConsentPolicy(body.operational);
  if (!operationalPolicy) {
    return json(
      { error: "operational.policyVersion and operational.wordingHash are required" },
      { status: 400 },
    );
  }

  const marketingOptIn = body.marketingOptIn === true;
  const marketingPolicy = marketingOptIn ? parseConsentPolicy(body.marketing) : null;
  if (marketingOptIn && !marketingPolicy) {
    return json(
      { error: "marketing.policyVersion and marketing.wordingHash are required when opting in" },
      { status: 400 },
    );
  }

  try {
    const result = await submitParentConsentForm(context.env.DB, {
      token,
      email,
      operationalPolicy,
      marketingOptIn,
      marketingPolicy,
      ipAddress: ip,
    });

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: `consent:${result.contactId}`,
        event: "parent contact confirmed",
        ...clubGroups(result.clubSlug),
        properties: {
          club_slug: result.clubSlug,
          contact_id: result.contactId,
          marketing_opt_in: marketingOptIn,
        },
      });
    }

    return json({
      ok: true,
      contactId: result.contactId,
      state: result.state,
      marketingOptIn,
    });
  } catch (err) {
    if (err instanceof ParentConsentError) {
      // Unknown / expired / spent are one response (see linkUnavailable).
      if (err.code === "not_found" || err.code === "expired" || err.code === "invalid_state") {
        return linkUnavailable();
      }
      const status = err.code === "policy_mismatch" ? 409 : 400;
      return json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
};

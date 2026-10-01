import { ensureTables } from "../../lib/ensure-tables";
import {
  type Env,
  json,
  requireAdmin,
  getClubSlug,
} from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  ContactPurgeError,
  purgeContactsForClub,
  purgeContactsForTeam,
  purgePlayerContact,
} from "../../lib/contact-purge";

/**
 * Admin one-click / bulk contact email purge (#134).
 *
 * POST body shapes:
 * - { contactId } — single contact on a player's row
 * - { teamName } — every contact for players registered on that team
 * - { entireClub: true } — every contact at the club
 *
 * Hard-deletes player_contact + related consent; suppresses a salted hash;
 * leaves FAN / registration / payment / user login alone. Audit never stores
 * the deleted address.
 */

type PurgeBody = {
  contactId?: unknown;
  teamName?: unknown;
  entireClub?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAdmin(context);
  if ("error" in auth) return auth.error;

  const clubSlug = getClubSlug(context.request);
  if (!clubSlug) return json({ error: "X-Club-Slug header required" }, { status: 400 });

  let body: PurgeBody;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }

  const adminId = (auth.session.user as Record<string, unknown>).id as string;
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const entireClub = body.entireClub === true;

  const modes = [contactId ? 1 : 0, teamName ? 1 : 0, entireClub ? 1 : 0];
  if (modes.reduce((a, b) => a + b, 0) !== 1) {
    return json(
      { error: "Provide exactly one of contactId, teamName, or entireClub: true" },
      { status: 400 },
    );
  }

  try {
    let purged;
    let scope: "contact" | "team" | "club";

    if (contactId) {
      const one = await purgePlayerContact(context.env.DB, {
        clubSlug,
        contactId,
        actor: { actorId: adminId, source: "admin" },
      });
      if (!one) return json({ error: "Contact not found in this club" }, { status: 404 });
      purged = [one];
      scope = "contact";
    } else if (teamName) {
      purged = await purgeContactsForTeam(context.env.DB, {
        clubSlug,
        teamName,
        actorId: adminId,
      });
      scope = "team";
    } else {
      purged = await purgeContactsForClub(context.env.DB, {
        clubSlug,
        actorId: adminId,
      });
      scope = "club";
    }

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: adminId,
        event: "contact email purged",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          scope,
          purged_count: purged.length,
          // Never include emails.
          contact_ids: purged.map((p) => p.contactId),
        },
      });
    }

    return json({
      ok: true,
      scope,
      purgedCount: purged.length,
      purged: purged.map((p) => ({
        contactId: p.contactId,
        playerId: p.playerId,
      })),
    });
  } catch (err) {
    if (err instanceof ContactPurgeError) {
      const status = err.code === "not_found" ? 404 : 400;
      return json({ error: err.message, code: err.code }, { status });
    }
    throw err;
  }
};

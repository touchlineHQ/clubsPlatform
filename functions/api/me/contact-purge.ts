import { ensureTables } from "../../lib/ensure-tables";
import { type Env, json, requireAuth } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import {
  ContactPurgeError,
  purgeContactsMatchingEmail,
} from "../../lib/contact-purge";

/**
 * Parent self-purge of their contact email(s) at their club (#134).
 *
 * Authenticated parent deletes every player_contact whose address matches their
 * login email. Shared purge helper: hard-delete + suppression + audit, no
 * cascade onto the user/account. Minimal preference hook until #135 polish.
 *
 * Optional JSON body: { cursor? }. Each call commits one chunk sized under the
 * Workers Free D1 query cap and returns `remaining` plus `cursor`. Call again
 * with that cursor until remaining is 0. A committed chunk is always reported.
 */

type PurgeBody = {
  /** Continue a self-purge after a previous chunk. */
  cursor?: unknown;
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const auth = await requireAuth(context);
  if ("error" in auth) return auth.error;

  const user = auth.session.user as Record<string, unknown>;
  const userId = user.id as string;
  const email = typeof user.email === "string" ? user.email : "";
  const clubSlug = typeof user.clubSlug === "string" ? user.clubSlug : null;

  if (!clubSlug) {
    return json(
      { error: "Your account is not bound to a club; contact your club admin" },
      { status: 400 },
    );
  }
  if (!email) {
    return json({ error: "Account has no email" }, { status: 400 });
  }

  // Body is optional: an empty POST starts a purge from the beginning.
  let body: PurgeBody = {};
  const raw = await context.request.text();
  if (raw.trim()) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") body = parsed as PurgeBody;
    } catch {
      return json({ error: "Malformed JSON body" }, { status: 400 });
    }
  }
  const cursor = typeof body.cursor === "string" ? body.cursor.trim() : "";

  try {
    const page = await purgeContactsMatchingEmail(context.env.DB, {
      clubSlug,
      email,
      actorId: userId,
      source: "parent",
      cursor: cursor || null,
    });
    const purged = page.purged;

    const posthog = getPostHog(context.env);
    if (posthog) {
      await posthog.captureImmediate({
        distinctId: userId,
        event: "contact email purged",
        ...clubGroups(clubSlug),
        properties: {
          club_slug: clubSlug,
          scope: "parent_self",
          purged_count: purged.length,
          remaining: page.remaining,
          contact_ids: purged.map((p) => p.contactId),
        },
      });
    }

    return json({
      ok: true,
      purgedCount: purged.length,
      remaining: page.remaining,
      cursor: page.cursor,
      purged: purged.map((p) => ({
        contactId: p.contactId,
        playerId: p.playerId,
      })),
    });
  } catch (err) {
    if (err instanceof ContactPurgeError) {
      return json({ error: err.message, code: err.code }, { status: 400 });
    }
    throw err;
  }
};

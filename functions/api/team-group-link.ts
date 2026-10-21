import { ensureTables } from "../lib/ensure-tables";
import { type Env, json, nowMs, getClubSlug } from "../lib/api-helpers";
import { createAuth } from "../lib/auth";
import { hasPermission } from "../lib/permissions";
import { isWhatsAppGroupInviteUrl } from "../lib/announcement";

/**
 * A team's WhatsApp group invite link (#74).
 *
 * In a WhatsApp group every participant sees every other participant's phone
 * number, so the link is never public. GET answers only a signed-in user who is
 * assigned to the team (coach or manager in user_team_role, club-scoped) or a
 * club content editor; everyone else, signed out included, gets the same 403,
 * whether or not a link is set. "Follow team" subscribers do not count:
 * following is self-service, so it would hand the link to anyone with an account.
 */

type Session = { user: Record<string, unknown> } | null;

async function session(context: EventContext<Env, string, unknown>): Promise<Session> {
  const baseURL = context.env.BETTER_AUTH_URL ?? new URL(context.request.url).origin;
  const auth = createAuth(context.env, { baseURL });
  return (await auth.api.getSession({ headers: context.request.headers })) as Session;
}

const forbidden = () => json({ error: "Not available" }, { status: 403 });

/** The club staff check used by requirePermission: role grants it and club matches. */
function isClubContentEditor(user: Record<string, unknown>, clubSlug: string): boolean {
  if (!hasPermission(user.role, "content")) return false;
  const userClub = (user.clubSlug as string | null) ?? null;
  return userClub === null || userClub === clubSlug;
}

function teamParams(url: URL): { slug: string; league: string } | null {
  const slug = url.searchParams.get("slug")?.trim() ?? "";
  const league = url.searchParams.get("league")?.trim() ?? "";
  return slug && league ? { slug, league } : null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  const team = teamParams(new URL(context.request.url));
  if (!clubSlug || !team) return json({ error: "X-Club-Slug, slug and league are required" }, { status: 400 });

  const s = await session(context);
  if (!s) return forbidden();
  const user = s.user;
  const userClub = (user.clubSlug as string | null) ?? null;

  let allowed = isClubContentEditor(user, clubSlug);
  if (!allowed && (userClub === null || userClub === clubSlug)) {
    const role = await context.env.DB
      .prepare(
        `SELECT 1 AS ok FROM user_team_role
         WHERE userId = ? AND teamSlug = ? AND teamLeague = ?
           AND role IN ('coach', 'manager')
           AND (clubSlug = ? OR clubSlug IS NULL)
         LIMIT 1`,
      )
      .bind(user.id as string, team.slug, team.league, clubSlug)
      .first<{ ok: number }>();
    allowed = !!role;
  }
  if (!allowed) return forbidden();

  const row = await context.env.DB
    .prepare(`SELECT url FROM team_group_link WHERE clubSlug = ? AND teamSlug = ? AND teamLeague = ?`)
    .bind(clubSlug, team.slug, team.league)
    .first<{ url: string }>();
  return json({ url: row?.url ?? null });
};

/** Set (or clear, with url null/"") a team's group link. Club content editors only. */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);
  const clubSlug = getClubSlug(context.request);
  const team = teamParams(new URL(context.request.url));
  if (!clubSlug || !team) return json({ error: "X-Club-Slug, slug and league are required" }, { status: 400 });

  const s = await session(context);
  if (!s || !isClubContentEditor(s.user, clubSlug)) return forbidden();

  let body: { url?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const raw = body?.url;
  if (raw === null || raw === undefined || raw === "") {
    await context.env.DB
      .prepare(`DELETE FROM team_group_link WHERE clubSlug = ? AND teamSlug = ? AND teamLeague = ?`)
      .bind(clubSlug, team.slug, team.league)
      .run();
    return json({ ok: true, url: null });
  }
  if (!isWhatsAppGroupInviteUrl(raw)) {
    return json({ error: "url must be a WhatsApp group invite link (https://chat.whatsapp.com/…)" }, { status: 400 });
  }

  const url = raw.trim();
  await context.env.DB
    .prepare(
      `INSERT INTO team_group_link (clubSlug, teamSlug, teamLeague, url, updatedBy, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (clubSlug, teamSlug, teamLeague) DO UPDATE SET
         url = excluded.url, updatedBy = excluded.updatedBy, updatedAt = excluded.updatedAt`,
    )
    .bind(clubSlug, team.slug, team.league, url, s.user.id as string, nowMs())
    .run();
  return json({ ok: true, url });
};

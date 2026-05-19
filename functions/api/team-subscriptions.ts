import { type Env, json, requireAuth } from "../lib/api-helpers";
import { getPostHog } from "../lib/posthog";

// POST /api/team-subscriptions
// Body: { teamSlug, teamLeague, teamName }
// Subscribes the current user to a team (role = 'subscriber')
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;
  const { session } = result;

  const userId = (session.user as Record<string, unknown>).id as string;

  const body = (await context.request.json()) as Partial<{
    teamSlug: string;
    teamLeague: string;
    teamName: string;
  }>;

  const teamSlug = body.teamSlug?.trim() ?? "";
  const teamLeague = body.teamLeague?.trim() ?? "";
  const teamName = body.teamName?.trim() ?? "";

  if (!teamSlug) return json({ error: "teamSlug is required" }, { status: 400 });
  if (!teamLeague) return json({ error: "teamLeague is required" }, { status: 400 });
  if (!teamName) return json({ error: "teamName is required" }, { status: 400 });

  // Don't allow overwriting a coach/manager assignment
  const existing = await context.env.DB
    .prepare(`SELECT id, role FROM user_team_role WHERE userId = ? AND teamSlug = ? AND teamLeague = ?`)
    .bind(userId, teamSlug, teamLeague)
    .first<{ id: string; role: string }>();

  if (existing) {
    if (existing.role !== "subscriber") {
      return json({ error: "You already have a role on this team" }, { status: 409 });
    }
    // Already subscribed — idempotent
    return json({ ok: true, id: existing.id });
  }

  const id = `utr_${crypto.randomUUID()}`;
  const ts = Date.now();

  await context.env.DB
    .prepare(
      `INSERT INTO user_team_role (id, userId, teamSlug, teamLeague, teamName, role, createdAt)
       VALUES (?, ?, ?, ?, ?, 'subscriber', ?)`
    )
    .bind(id, userId, teamSlug, teamLeague, teamName, ts)
    .run();

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: userId,
      event: 'team subscription created',
      properties: { team_slug: teamSlug, team_league: teamLeague, team_name: teamName },
    });
  }

  return json({ ok: true, id }, { status: 201 });
};

// DELETE /api/team-subscriptions?slug=<slug>&league=<league>
// Removes the current user's subscriber assignment for a team.
// Only removes 'subscriber' roles — coach/manager assignments are admin-only.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;
  const { session } = result;

  const userId = (session.user as Record<string, unknown>).id as string;
  const url = new URL(context.request.url);
  const slug = url.searchParams.get("slug") ?? "";
  const league = url.searchParams.get("league") ?? "";

  if (!slug || !league) return json({ error: "slug and league query params required" }, { status: 400 });

  const existing = await context.env.DB
    .prepare(`SELECT id, role FROM user_team_role WHERE userId = ? AND teamSlug = ? AND teamLeague = ?`)
    .bind(userId, slug, league)
    .first<{ id: string; role: string }>();

  if (!existing) return json({ error: "Subscription not found" }, { status: 404 });

  if (existing.role !== "subscriber") {
    return json({ error: "Cannot remove a coach or manager assignment — contact an admin" }, { status: 403 });
  }

  await context.env.DB
    .prepare(`DELETE FROM user_team_role WHERE id = ?`)
    .bind(existing.id)
    .run();

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: userId,
      event: 'team subscription deleted',
      properties: { team_slug: slug, team_league: league },
    });
  }

  return json({ ok: true });
};

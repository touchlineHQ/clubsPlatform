import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import { getPostHog } from "../../lib/posthog";

type UserTeamRoleRow = {
  id: string;
  userId: string;
  teamSlug: string;
  teamLeague: string;
  teamName: string;
  role: string;
  createdAt: number;
  userName: string;
  userEmail: string;
};

const VALID_ROLES = ["coach", "manager", "subscriber"];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const rows = await context.env.DB
    .prepare(`
      SELECT utr.id, utr.userId, utr.teamSlug, utr.teamLeague, utr.teamName, utr.role, utr.createdAt,
             u.name as userName, u.email as userEmail
      FROM user_team_role utr
      JOIN "user" u ON utr.userId = u.id
      WHERE (utr.clubSlug = ? OR (? IS NULL AND utr.clubSlug IS NULL))
      ORDER BY utr.teamName ASC, u.name ASC
    `)
    .bind(clubSlug, clubSlug)
    .all<UserTeamRoleRow>();

  return json({ assignments: rows.results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const body = (await context.request.json()) as Partial<{
    userId: string;
    teamSlug: string;
    teamLeague: string;
    teamName: string;
    role: string;
  }>;

  const userId = body.userId?.trim() ?? "";
  const teamSlug = body.teamSlug?.trim() ?? "";
  const teamLeague = body.teamLeague?.trim() ?? "";
  const teamName = body.teamName?.trim() ?? "";
  const role = body.role?.trim() ?? "";

  if (!userId) return json({ error: "userId is required" }, { status: 400 });
  if (!teamSlug) return json({ error: "teamSlug is required" }, { status: 400 });
  if (!teamLeague) return json({ error: "teamLeague is required" }, { status: 400 });
  if (!teamName) return json({ error: "teamName is required" }, { status: 400 });
  if (!role) return json({ error: "role is required" }, { status: 400 });
  if (!VALID_ROLES.includes(role)) {
    return json({ error: "role must be one of: coach, manager, subscriber" }, { status: 400 });
  }

  // Check user exists
  const user = await context.env.DB
    .prepare(`SELECT id, role FROM "user" WHERE id = ?`)
    .bind(userId)
    .first<{ id: string; role: string }>();

  if (!user) return json({ error: "User not found" }, { status: 404 });

  const id = `utr_${crypto.randomUUID()}`;
  const ts = Date.now();

  try {
    await context.env.DB
      .prepare(
        `INSERT INTO user_team_role (id, clubSlug, userId, teamSlug, teamLeague, teamName, role, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, clubSlug, userId, teamSlug, teamLeague, teamName, role, ts)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      return json({ error: "This user is already assigned to that team" }, { status: 409 });
    }
    throw e;
  }

  // Auto-upgrade global role to manager when assigning coach or manager team role
  if ((role === "coach" || role === "manager") && user.role === "member") {
    await context.env.DB
      .prepare(`UPDATE "user" SET role = 'manager', updatedAt = ? WHERE id = ?`)
      .bind(ts, userId)
      .run();
  }

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'team role assigned',
      properties: { club_slug: clubSlug, target_user_id: userId, team_slug: teamSlug, team_league: teamLeague, team_name: teamName, role },
    });
  }

  return json({ ok: true, id }, { status: 201 });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);
  const url = new URL(context.request.url);
  const id = url.searchParams.get("id") ?? "";
  if (!id) return json({ error: "id query param required" }, { status: 400 });

  const existing = await context.env.DB
    .prepare(`SELECT id FROM user_team_role WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`)
    .bind(id, clubSlug, clubSlug)
    .first<{ id: string }>();

  if (!existing) return json({ error: "Assignment not found" }, { status: 404 });

  await context.env.DB
    .prepare(`DELETE FROM user_team_role WHERE id = ?`)
    .bind(id)
    .run();

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'team role removed',
      properties: { club_slug: clubSlug, assignment_id: id },
    });
  }

  return json({ ok: true });
};

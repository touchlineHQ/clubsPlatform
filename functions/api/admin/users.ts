import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";
import { getPostHog, clubGroups } from "../../lib/posthog";
import { prepareAuditLog } from "../../lib/audit-log";
import { COMMITTEE_ROLES, isCommitteeRole, permissionsFor } from "../../lib/permissions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  const clubSlug = getClubSlug(context.request);

  const users = await context.env.DB
    .prepare(
      `SELECT id, name, email, role, createdAt FROM "user"
       WHERE (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))
       ORDER BY createdAt ASC`
    )
    .bind(clubSlug, clubSlug)
    .all<UserRow>();

  return json({ users: users.results });
};

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const result = await requireAdmin(context);
  if ("error" in result) return result.error;

  let body: { userId?: unknown; role?: unknown; reason?: unknown };
  try {
    body = await context.request.json() as typeof body;
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId : "";
  const role = body.role;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";

  if (!userId || !role) {
    return json({ error: "userId and role required" }, { status: 400 });
  }

  if (!isCommitteeRole(role)) {
    return json({ error: `Invalid role. Must be one of: ${COMMITTEE_ROLES.join(", ")}` }, { status: 400 });
  }

  const clubSlug = getClubSlug(context.request);
  const target = await context.env.DB
    .prepare(
      `SELECT role FROM "user"
       WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`
    )
    .bind(userId, clubSlug, clubSlug)
    .first<{ role: string }>();
  if (!target) return json({ error: "User not found" }, { status: 404 });

  const adminId = (result.session.user as Record<string, unknown>).id as string;
  // The audit row records who granted what, the old and new role, and the
  // reason given, so "why can this person see payments?" has an answer that
  // points at a person (#79). The grants themselves are permissionsFor(role).
  const note = JSON.stringify({ reason: reason || null, permissions: permissionsFor(role) });
  await context.env.DB.batch([
    context.env.DB
      .prepare(
        `UPDATE "user" SET role = ?
         WHERE id = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`
      )
      .bind(role, userId, clubSlug, clubSlug),
    prepareAuditLog(context.env.DB, {
      clubSlug: clubSlug ?? "",
      adminId,
      action: "user_role_changed",
      targetTable: "user",
      targetId: userId,
      oldStatus: target.role,
      newStatus: role,
      note,
    }),
  ]);

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: adminId,
      event: 'user role updated',
      ...clubGroups(getClubSlug(context.request)),
      properties: { target_user_id: userId, new_role: role },
    });
  }

  return json({ ok: true });
};

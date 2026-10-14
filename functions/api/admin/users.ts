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

  let parsed: unknown;
  try {
    parsed = await context.request.json();
  } catch {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return json({ error: "Invalid request body" }, { status: 400 });
  }
  const body = parsed as { userId?: unknown; role?: unknown; reason?: unknown };
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
  // The update only applies if the role is still the one just read, and the
  // audit row is only written if exactly that one row changed (otherwise 409), so a concurrent change or a moved/deleted user can never leave an
  // audit entry describing a change that didn't happen.
  let writes: D1Result<unknown>[];
  try {
    writes = await context.env.DB.batch([
      context.env.DB
        .prepare(
          `UPDATE "user" SET role = ?
           WHERE id = ? AND role = ? AND (clubSlug = ? OR (? IS NULL AND clubSlug IS NULL))`
        )
        .bind(role, userId, target.role, clubSlug, clubSlug),
      prepareAuditLog(context.env.DB, {
        clubSlug: clubSlug ?? "",
        adminId,
        action: "user_role_changed",
        targetTable: "user",
        targetId: userId,
        oldStatus: target.role,
        newStatus: role,
        note,
      }, { sql: "changes() = 1", bindings: [], abortOnFalse: false }),
    ]);
  } catch (error) {
    console.error("Role update transaction failed", { userId, error });
    return json({ error: "Failed to update the user's role" }, { status: 500 });
  }

  if ((writes[0]?.meta?.changes ?? 0) !== 1) {
    return json({ error: "That user's role changed while you were editing; reload and try again" }, { status: 409 });
  }

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

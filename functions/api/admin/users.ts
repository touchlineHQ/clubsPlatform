import { type Env, json, requireAdmin, getClubSlug } from "../../lib/api-helpers";

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

  const body = await context.request.json() as { userId?: string; role?: string };
  const { userId, role } = body;

  if (!userId || !role) {
    return json({ error: "userId and role required" }, { status: 400 });
  }

  const validRoles = ["member", "admin", "manager"];
  if (!validRoles.includes(role)) {
    return json({ error: "Invalid role. Must be 'member', 'admin', or 'manager'" }, { status: 400 });
  }

  await context.env.DB
    .prepare('UPDATE "user" SET role = ? WHERE id = ?')
    .bind(role, userId)
    .run();

  return json({ ok: true });
};

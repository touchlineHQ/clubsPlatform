import { type Env, json, requireAuth } from "../lib/api-helpers";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;
  const { session } = result;
  const u = session.user as Record<string, unknown>;

  return json({
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: u.role ?? "member",
      clubSlug: (u.clubSlug as string | null) ?? null,
    },
  });
};

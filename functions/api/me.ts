import { type Env, json, requireAuth } from "../lib/api-helpers";
import { getPostHog } from "../lib/posthog";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await requireAuth(context);
  if ("error" in result) return result.error;
  const { session } = result;
  const u = session.user as Record<string, unknown>;

  const posthog = getPostHog(context.env);
  if (posthog) {
    posthog.identify({
      distinctId: session.user.id,
      properties: {
        $set: {
          name: session.user.name,
          email: session.user.email,
          role: u.role ?? 'member',
          club_slug: (u.clubSlug as string | null) ?? null,
        },
      },
    });
    await posthog.flush();
  }

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

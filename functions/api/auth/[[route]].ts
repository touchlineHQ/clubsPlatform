import { Hono } from "hono";
import { createAuth } from "../../lib/auth";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog } from "../../lib/posthog";

interface Env {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

const app = new Hono<{ Bindings: Env }>();

app.all("/api/auth/*", async (c) => {
  if (!c.env.DB) {
    return c.json({ error: "D1 database not bound" }, 500);
  }
  if (!c.env.BETTER_AUTH_SECRET) {
    return c.json({ error: "BETTER_AUTH_SECRET not set" }, 500);
  }
  try {
    await ensureTables(c.env.DB);
    const baseURL = c.env.BETTER_AUTH_URL ?? new URL(c.req.url).origin;
    const auth = createAuth(c.env, { baseURL });
    return auth.handler(c.req.raw);
  } catch (e) {
    const posthog = getPostHog(c.env);
    if (posthog) {
      posthog.captureException(e);
      await posthog.flush();
    }
    return c.json({ error: "Auth error", details: String(e) }, 500);
  }
});

export const onRequest: PagesFunction<Env> = async (context) => {
  return app.fetch(context.request, context.env);
};

import { Hono } from "hono";
import { createAuth } from "../../lib/auth";
import { ensureTables } from "../../lib/ensure-tables";
import { getPostHog } from "../../lib/posthog";
import { isSignupRequest, validateSignupBody } from "../../lib/signup-validation";

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

    const url = new URL(c.req.url);
    if (isSignupRequest(c.req.method, url.pathname)) {
      const bodyText = await c.req.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        return c.json({ message: "Invalid JSON body", code: "INVALID_JSON" }, 400);
      }
      const validationError = validateSignupBody(parsed as Record<string, unknown>);
      if (validationError) {
        return c.json({ message: validationError, code: "VALIDATION_ERROR" }, 400);
      }
      const forwarded = new Request(c.req.raw.url, {
        method: c.req.raw.method,
        headers: c.req.raw.headers,
        body: bodyText,
      });
      return auth.handler(forwarded);
    }

    return auth.handler(c.req.raw);
  } catch (e) {
    const posthog = getPostHog(c.env);
    if (posthog) {
      posthog.captureException(e);
      await posthog.flush();
    }
    return c.json({ error: "Auth error" }, 500);
  }
});

export const onRequest: PagesFunction<Env> = async (context) => {
  return app.fetch(context.request, context.env);
};

import { ensureTables } from "../lib/ensure-tables";
import { type Env, json } from "../lib/api-helpers";
import { getPostHog, clubGroups } from "../lib/posthog";
import {
  requestIp,
  withdrawMarketingConsentByToken,
} from "../lib/consent";

/** Read an unsubscribe token from the query string or a POST form body. */
async function tokenFrom(context: EventContext<Env, string, unknown>): Promise<string> {
  const url = new URL(context.request.url);
  const fromQuery = url.searchParams.get("token")?.trim() ?? "";
  if (fromQuery) return fromQuery;
  if (context.request.method !== "POST") return "";
  const contentType = context.request.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await context.request.clone().formData();
    return String(form.get("token") ?? "").trim();
  }
  return "";
}

/** Apply a token withdrawal and emit its privacy-safe analytics event. */
async function handleWithdraw(context: EventContext<Env, string, unknown>): Promise<Response> {
  await ensureTables(context.env.DB);
  const token = await tokenFrom(context);
  if (!token) {
    return json({ error: "token is required" }, { status: 400 });
  }

  const result = await withdrawMarketingConsentByToken(
    context.env.DB,
    token,
    requestIp(context.request),
  );

  if (!result.ok) {
    // Quiet failure — do not confirm whether a token existed.
    return json({ ok: true, withdrawn: false });
  }

  const posthog = getPostHog(context.env);
  if (posthog) {
    await posthog.captureImmediate({
      distinctId: `consent:${result.subjectId}`,
      event: "marketing consent withdrawn",
      ...clubGroups(result.clubSlug),
      properties: {
        club_slug: result.clubSlug,
        subject_id: result.subjectId,
        source: "unsubscribe_link",
      },
    });
  }

  return json({ ok: true, withdrawn: true });
}

/**
 * Show a confirmation form without changing consent. Mail scanners and link
 * previews commonly fetch GET links, so withdrawal is POST-only.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const token = await tokenFrom(context);
  if (!token) return json({ error: "token is required" }, { status: 400 });
  const escapedToken = token.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return new Response(
    `<!doctype html><title>Unsubscribe</title><h1>Unsubscribe from marketing emails</h1>
     <p>Click the button to confirm you no longer want marketing emails.</p>
     <form method="post"><input type="hidden" name="token" value="${escapedToken}">
     <button type="submit">Unsubscribe</button></form>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
};

/** One-click unsubscribe endpoint; state changes are deliberately POST-only. */
export const onRequestPost: PagesFunction<Env> = async (context) => handleWithdraw(context);

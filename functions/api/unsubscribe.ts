import { ensureTables } from "../lib/ensure-tables";
import { type Env, json } from "../lib/api-helpers";
import { getPostHog, clubGroups } from "../lib/posthog";
import {
  requestIp,
  withdrawMarketingConsentByToken,
} from "../lib/consent";

function tokenFrom(context: EventContext<Env, string, unknown>): string {
  const url = new URL(context.request.url);
  const fromQuery = url.searchParams.get("token")?.trim() ?? "";
  return fromQuery;
}

async function handleWithdraw(context: EventContext<Env, string, unknown>): Promise<Response> {
  await ensureTables(context.env.DB);
  const token = tokenFrom(context);
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

/** One-click unsubscribe from marketing (#75). GET and POST both work. */
export const onRequestGet: PagesFunction<Env> = async (context) => handleWithdraw(context);
export const onRequestPost: PagesFunction<Env> = async (context) => handleWithdraw(context);

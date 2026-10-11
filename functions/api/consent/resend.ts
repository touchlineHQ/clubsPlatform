import { ensureTables } from "../../lib/ensure-tables";
import { type Env, isMultiClubMode, json } from "../../lib/api-helpers";
import { getPostHog } from "../../lib/posthog";
import { resendActivationForToken } from "../../lib/activation-mail";

/**
 * Public: "send me a fresh activation link" from an expired or spent link
 * (#132). The token is the only input. The response is always the same 202 —
 * unknown, spent, live, rate-limited — and the work runs in waitUntil, so
 * neither status, body nor timing says whether the token meant anything.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTables(context.env.DB);

  let token = "";
  try {
    const body = await context.request.json() as Record<string, unknown>;
    if (typeof body.token === "string") token = body.token.trim();
  } catch {
    // Same response as every other outcome.
  }

  if (token) {
    const ctx = {
      env: context.env,
      origin: new URL(context.request.url).origin,
      multiClub: isMultiClubMode(context.env),
    };
    context.waitUntil(
      resendActivationForToken(context.env.DB, ctx, token)
        .then(async (sent) => {
          const posthog = getPostHog(context.env);
          if (sent && posthog) {
            await posthog.captureImmediate({
              distinctId: "activation-resend",
              event: "activation link resent",
              properties: {},
            });
          }
        })
        .catch(() => undefined),
    );
  }

  return json(
    { ok: true, message: "If that link was valid, a new one is on its way to the same address." },
    { status: 202 },
  );
};

import { type Env, getClubSlug } from "./lib/api-helpers";
import { createAuth } from "./lib/auth";
import { getPostHog } from "./lib/posthog";

/**
 * Resolve the signed-in user's id so an exception can be attributed to a
 * person rather than a random anonymous one.
 *
 * Only called on the error path — the happy path must not pay for an extra
 * session lookup on every request. Never throws: we are already handling an
 * error, and losing the id is much better than masking the original fault.
 */
async function resolveDistinctId(
  request: Request,
  env: Env,
): Promise<string | null> {
  try {
    const baseURL = env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    const auth = createAuth(env, { baseURL });
    const session = await auth.api.getSession({ headers: request.headers });
    return session?.user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Catches anything thrown by a Pages Function and reports it to PostHog.
 *
 * This covers every route under functions/ at once. Before it existed the only
 * server-side captureException was in the better-auth handler, so a failure
 * anywhere else was invisible.
 *
 * The error is always re-thrown: this middleware observes, it does not handle.
 * Changing the response shape here would alter behaviour every route depends on.
 */
export const onRequest: PagesFunction<Env> = async (context) => {
  try {
    return await context.next();
  } catch (e) {
    const posthog = getPostHog(context.env);
    if (posthog) {
      try {
        const url = new URL(context.request.url);
        const distinctId = await resolveDistinctId(context.request, context.env);

        // Immediate, like the other edge capture sites: awaits the send rather
        // than relying on a queue the worker may be torn down before draining.
        await posthog.captureExceptionImmediate(
          e,
          // Undefined lets posthog-node fall back to an anonymous id rather
          // than inventing a fake one, keeping "unattributed" honest.
          distinctId ?? undefined,
          {
            path: url.pathname,
            method: context.request.method,
            club_slug: getClubSlug(context.request),
            source: "pages-function",
          },
        );
      } catch {
        // Reporting must never turn a route error into a different one.
      }
    }
    throw e;
  }
};

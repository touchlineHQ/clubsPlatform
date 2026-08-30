import { PostHog } from 'posthog-node';

interface PostHogEnv {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

/**
 * Group-analytics payload tying an event to a club.
 *
 * Spread into a capture call: `{ ...clubGroups(clubSlug) }`. Without this an
 * event has no `$groups`, so it is invisible to every club-scoped breakdown
 * and funnel — the frontend already calls `posthog.group('club', slug)`, so
 * browser events were grouped and server events were not, splitting any funnel
 * that crosses the boundary.
 *
 * Returns an empty object when there is no slug, so the key is simply absent
 * rather than set to null. Genuinely club-less events (GoCardless webhooks,
 * the public payment entry page) stay ungrouped by design.
 */
export function clubGroups(
  clubSlug?: string | null,
): { groups?: Record<string, string> } {
  return clubSlug ? { groups: { club: clubSlug } } : {};
}

/**
 * Creates a PostHog client configured for serverless/edge use.
 * Uses flushAt:1/flushInterval:0 so events are flushed before
 * the Cloudflare Pages Function returns.
 */
export function getPostHog(env: PostHogEnv): PostHog | null {
  const apiKey = env.POSTHOG_API_KEY;
  const host = env.POSTHOG_HOST;
  if (!apiKey || !host) return null;

  // No enableExceptionAutocapture: it installs Node `uncaughtException` /
  // `unhandledRejection` process handlers, which do not exist on workerd. It
  // read as coverage we did not have. Server exceptions are captured
  // explicitly in functions/_middleware.ts instead.
  return new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
}

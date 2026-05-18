import { PostHog } from 'posthog-node';

interface PostHogEnv {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
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

  return new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
}

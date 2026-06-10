import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_API_KEY || 'phc_CfHQ76a3hqCFjLJKDvvFaowTsnRiUAFCubTvbvzUpzaD';
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://p.touchlinehq.co.uk';

/**
 * Initialize PostHog on the frontend. Call once at app startup.
 * In dev mode we opt out to avoid polluting production data.
 */
export function init(): void {
  if (!POSTHOG_KEY) {
    if (import.meta.env.DEV) {
      console.warn('[PostHog] VITE_POSTHOG_API_KEY not set — skipping init');
    }
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    defaults: '2026-05-30',
    loaded: (ph) => {
      if (import.meta.env.DEV) {
        ph.opt_out_capturing();
        console.log('[PostHog] Dev mode — opted out');
      }
    },
  });
}

/**
 * Track a page view manually — call on every route change.
 */
export function pageview(path?: string): void {
  posthog.capture('$pageview', {
    $current_url: path || window.location.href,
  });
}

/**
 * Identify the current user and link them to their club group.
 */
export function identify(opts: {
  distinctId: string;
  email?: string;
  name?: string;
  role?: string;
  clubSlug?: string | null;
}): void {
  const { distinctId, email, name, role, clubSlug } = opts;

  posthog.identify(distinctId, {
    email,
    name,
    role,
    club_slug: clubSlug,
  });

  if (clubSlug) {
    posthog.group('club', clubSlug, { slug: clubSlug });
  }
}

/**
 * Reset user identity — call on logout.
 */
export function reset(): void {
  posthog.reset();
}

/**
 * Reload feature flags for the current user.
 */
export async function reloadFeatureFlags(): Promise<void> {
  return posthog.reloadFeatureFlags();
}

/**
 * Check if a feature flag is enabled.
 */
export function isFeatureEnabled(key: string, options?: { send_event?: boolean }): boolean {
  return posthog.isFeatureEnabled(key, options ?? { send_event: false }) ?? false;
}

/**
 * Get a feature flag's payload.
 */
export function getFeatureFlagPayload(key: string): unknown {
  return posthog.getFeatureFlagPayload(key);
}

/**
 * React hooks for feature flags.
 */
export { useFeatureFlagVariantKey, useFeatureFlagEnabled } from 'posthog-js/react';

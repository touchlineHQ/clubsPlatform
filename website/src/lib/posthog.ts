import posthog from 'posthog-js';

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_API_KEY;
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST;

/**
 * Explicit opt-out, so the pipeline can be exercised locally. Defaults to on in
 * dev — previously this was hardcoded to `import.meta.env.DEV`, which meant
 * there was no way to verify an analytics change before shipping it.
 */
const DISABLED = import.meta.env.VITE_POSTHOG_DISABLED === 'true'
  || (import.meta.env.VITE_POSTHOG_DISABLED === undefined && import.meta.env.DEV);

/**
 * Whether init() actually configured the SDK. Every helper below is a no-op
 * unless this is true: calling into posthog-js before init both loses the event
 * and, for some methods, throws.
 */
let active = false;

/**
 * Extract the in-app route from a HashRouter URL.
 *
 * `window.location.pathname` is the club prefix (`/east-leake-fc`), and the
 * actual route lives in the fragment. Returns `/` when there is no fragment.
 */
function currentRoute(): string {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return '/';
  return hash.slice(1).split('?')[0] || '/';
}

/**
 * Initialize PostHog on the frontend. Call once at app startup.
 */
export function init(): void {
  if (!POSTHOG_KEY || !POSTHOG_HOST) {
    // Loud, and not gated on DEV: a production bundle built without these is a
    // real misconfiguration, and it used to be masked by a hardcoded fallback
    // key so nobody found out.
    console.error(
      '[PostHog] VITE_POSTHOG_API_KEY / VITE_POSTHOG_HOST missing at build time — analytics disabled. ' +
      'These are injected by the Build step in .github/workflows/main.yml; the Cloudflare Pages ' +
      'dashboard build variables do not apply to this project.'
    );
    return;
  }

  if (DISABLED) {
    console.info('[PostHog] Disabled via VITE_POSTHOG_DISABLED — no events will be sent');
    return;
  }

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    // Off deliberately. This is a HashRouter app, so posthog-js sees the route
    // only as a fragment: automatic capture records every page as `/` or as the
    // club prefix. NavigationHandler in App.tsx is the single source of
    // pageviews instead. Leaving this on also double-counted the first route of
    // every session — once at init, once on mount.
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    defaults: '2026-05-30',
  });

  active = true;
}

/**
 * Track a page view. Called on every route change by NavigationHandler.
 *
 * `$current_url` must be a full URL — PostHog derives `$host`, referrer
 * handling and session stitching from it. This previously received React
 * Router's pathname, so events arrived with `$current_url: '/registrations'`
 * and split the same page across two rows in every report.
 */
export function pageview(pathname?: string): void {
  if (!active) return;

  posthog.capture('$pageview', {
    $current_url: window.location.href,
    // Overridden explicitly: PostHog would otherwise parse `$pathname` out of
    // `$current_url` and get the club prefix, since the route is in the
    // fragment. This is what makes route-level breakdowns work.
    $pathname: pathname ?? currentRoute(),
  });
}

/**
 * Report a handled error that would otherwise be swallowed.
 *
 * Exception autocapture only sees errors that reach `window.onerror` or an
 * unhandled rejection. Anything inside a `try/catch` — which is most of our
 * failure handling — is invisible unless reported explicitly.
 */
export function captureError(error: unknown, context: Record<string, unknown> = {}): void {
  if (!active) return;

  posthog.captureException(
    error instanceof Error ? error : new Error(String(error)),
    {
      $current_url: window.location.href,
      route: currentRoute(),
      handled: true,
      ...context,
    },
  );
}

/**
 * Record a product event.
 *
 * Names follow the convention already used server-side: lowercase, space
 * separated, noun then past-tense verb ("club registered", "players imported").
 * Every name must also appear in .posthog-events.json — a test enforces that,
 * so the registry cannot drift the way it already had.
 */
export function captureEvent(event: string, properties: Record<string, unknown> = {}): void {
  if (!active) return;

  posthog.capture(event, {
    route: currentRoute(),
    ...properties,
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
  if (!active) return;

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
  if (!active) return;
  posthog.reset();
}

/**
 * Reload feature flags for the current user.
 */
export async function reloadFeatureFlags(): Promise<void> {
  if (!active) return;
  return posthog.reloadFeatureFlags();
}

/**
 * Check if a feature flag is enabled.
 */
export function isFeatureEnabled(key: string, options?: { send_event?: boolean }): boolean {
  if (!active) return false;
  return posthog.isFeatureEnabled(key, options ?? { send_event: false }) ?? false;
}

/**
 * Get a feature flag's payload.
 */
export function getFeatureFlagPayload(key: string): unknown {
  if (!active) return undefined;
  return posthog.getFeatureFlagPayload(key);
}

/**
 * React hooks for feature flags.
 */
export { useFeatureFlagVariantKey, useFeatureFlagEnabled } from 'posthog-js/react';

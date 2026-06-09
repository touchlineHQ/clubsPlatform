import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(cleanup);

// ── PostHog mock ────────────────────────────────────────────────────────────
// website/src/lib/posthog.ts imports from 'posthog-js'.  Tests loading
// App.tsx or AuthContext.tsx transitively pull in this dependency.
// Mock the SDK here so no real PostHog code runs in jsdom.

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
    capture: vi.fn(),
    group: vi.fn(),
    opt_out_capturing: vi.fn(),
    reloadFeatureFlags: vi.fn().mockResolvedValue(undefined),
    isFeatureEnabled: vi.fn().mockReturnValue(false),
    getFeatureFlagPayload: vi.fn().mockReturnValue(null),
  },
  __esModule: true,
}));

// ── Environment polyfills ───────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });

  if (!('ResizeObserver' in window)) {
    (window as unknown as Record<string, unknown>).ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
}

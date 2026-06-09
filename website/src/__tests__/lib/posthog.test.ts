import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock posthog-js directly in the test file (setup file mocks may not hoist properly)
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
}));

import { init, pageview, identify, reset, reloadFeatureFlags, isFeatureEnabled, getFeatureFlagPayload } from '../../lib/posthog';
import posthog from 'posthog-js';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('pageview()', () => {
  it('calls posthog.capture with $pageview', () => {
    pageview('/test');
    expect(posthog.capture).toHaveBeenCalledWith('$pageview', { $current_url: '/test' });
  });
});

describe('identify()', () => {
  it('calls posthog.identify with user properties', () => {
    identify({ distinctId: 'u1', email: 'a@b.com', name: 'A', role: 'admin', clubSlug: 'c' });
    expect(posthog.identify).toHaveBeenCalledWith('u1', { email: 'a@b.com', name: 'A', role: 'admin', club_slug: 'c' });
    expect(posthog.group).toHaveBeenCalledWith('club', 'c', { slug: 'c' });
  });
});

describe('reset()', () => {
  it('calls posthog.reset', () => {
    reset();
    expect(posthog.reset).toHaveBeenCalled();
  });
});

describe('isFeatureEnabled()', () => {
  it('calls posthog.isFeatureEnabled', () => {
    isFeatureEnabled('flag');
    expect(posthog.isFeatureEnabled).toHaveBeenCalledWith('flag', { send_event: false });
  });
});

describe('getFeatureFlagPayload()', () => {
  it('calls posthog.getFeatureFlagPayload', () => {
    getFeatureFlagPayload('flag');
    expect(posthog.getFeatureFlagPayload).toHaveBeenCalledWith('flag');
  });
});

describe('reloadFeatureFlags()', () => {
  it('calls posthog.reloadFeatureFlags', async () => {
    await reloadFeatureFlags();
    expect(posthog.reloadFeatureFlags).toHaveBeenCalled();
  });
});

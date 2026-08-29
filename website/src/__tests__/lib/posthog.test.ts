import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPosthog = {
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  group: vi.fn(),
  opt_out_capturing: vi.fn(),
  reloadFeatureFlags: vi.fn().mockResolvedValue(undefined),
  isFeatureEnabled: vi.fn().mockReturnValue(false),
  getFeatureFlagPayload: vi.fn().mockReturnValue(null),
};

vi.mock('posthog-js', () => ({ default: mockPosthog }));

/**
 * The module reads import.meta.env at load time and keeps module-level state
 * for whether init() succeeded, so each scenario needs a fresh import.
 */
async function loadModule(env: Record<string, string | undefined>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv('VITE_POSTHOG_API_KEY', env.key as string);
  vi.stubEnv('VITE_POSTHOG_HOST', env.host as string);
  vi.stubEnv('VITE_POSTHOG_DISABLED', env.disabled as string);
  return import('../../lib/posthog');
}

/** A fully configured, enabled module with init() already called. */
async function loadActive() {
  const mod = await loadModule({
    key: 'phc_test',
    host: 'https://ph.example.com',
    disabled: 'false',
  });
  mod.init();
  return mod;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('init()', () => {
  it('initialises with the configured key and host', async () => {
    const mod = await loadModule({ key: 'phc_test', host: 'https://ph.example.com', disabled: 'false' });
    mod.init();

    expect(mockPosthog.init).toHaveBeenCalledTimes(1);
    expect(mockPosthog.init.mock.calls[0][0]).toBe('phc_test');
    expect(mockPosthog.init.mock.calls[0][1]).toMatchObject({
      api_host: 'https://ph.example.com',
      capture_pageleave: true,
      autocapture: true,
    });
  });

  // Automatic capture can only see the club prefix under HashRouter, and it
  // also double-counted the first route of every session.
  it('leaves capture_pageview off so NavigationHandler is the only source', async () => {
    const mod = await loadModule({ key: 'phc_test', host: 'https://ph.example.com', disabled: 'false' });
    mod.init();

    expect(mockPosthog.init.mock.calls[0][1].capture_pageview).toBe(false);
  });

  it('does not initialise, and logs loudly, when the key is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await loadModule({ key: undefined, host: 'https://ph.example.com', disabled: 'false' });

    mod.init();

    expect(mockPosthog.init).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('VITE_POSTHOG_API_KEY'));
    error.mockRestore();
  });

  it('does not initialise when the host is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await loadModule({ key: 'phc_test', host: undefined, disabled: 'false' });

    mod.init();

    expect(mockPosthog.init).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('does not initialise when explicitly disabled', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const mod = await loadModule({ key: 'phc_test', host: 'https://ph.example.com', disabled: 'true' });

    mod.init();

    expect(mockPosthog.init).not.toHaveBeenCalled();
    info.mockRestore();
  });
});

describe('helpers before init()', () => {
  // Calling into posthog-js before init loses the event, and some methods
  // throw. Every helper must be inert until the SDK is configured.
  it('are all no-ops', async () => {
    const mod = await loadModule({ key: undefined, host: undefined, disabled: 'false' });

    mod.pageview('/teams');
    mod.captureError(new Error('boom'));
    mod.identify({ distinctId: 'u1' });
    mod.reset();
    await mod.reloadFeatureFlags();

    expect(mockPosthog.capture).not.toHaveBeenCalled();
    expect(mockPosthog.captureException).not.toHaveBeenCalled();
    expect(mockPosthog.identify).not.toHaveBeenCalled();
    expect(mockPosthog.reset).not.toHaveBeenCalled();
    expect(mockPosthog.reloadFeatureFlags).not.toHaveBeenCalled();
    expect(mod.isFeatureEnabled('flag')).toBe(false);
    expect(mod.getFeatureFlagPayload('flag')).toBeUndefined();
  });
});

describe('pageview()', () => {
  // The regression: pageview(pathname) used to put React Router's pathname
  // straight into $current_url, so events arrived as '/registrations' and split
  // the same page across two rows against the full-URL entries.
  it('sends a full URL as $current_url, not the route', async () => {
    const mod = await loadActive();
    window.location.hash = '#/registrations';

    mod.pageview('/registrations');

    const [event, props] = mockPosthog.capture.mock.calls[0];
    expect(event).toBe('$pageview');
    expect(props.$current_url).toBe(window.location.href);
    expect(props.$current_url).toMatch(/^https?:\/\//);
  });

  it('sends the in-app route as $pathname', async () => {
    const mod = await loadActive();

    mod.pageview('/registrations');

    expect(mockPosthog.capture.mock.calls[0][1].$pathname).toBe('/registrations');
  });

  it('falls back to the hash route when no pathname is given', async () => {
    const mod = await loadActive();
    window.location.hash = '#/admin/payments';

    mod.pageview();

    expect(mockPosthog.capture.mock.calls[0][1].$pathname).toBe('/admin/payments');
  });

  it('strips query strings from the derived route', async () => {
    const mod = await loadActive();
    window.location.hash = '#/payment-success?mandate=MD01&amount=3000';

    mod.pageview();

    expect(mockPosthog.capture.mock.calls[0][1].$pathname).toBe('/payment-success');
  });

  it('derives / when there is no fragment', async () => {
    const mod = await loadActive();

    mod.pageview();

    expect(mockPosthog.capture.mock.calls[0][1].$pathname).toBe('/');
  });
});

describe('captureError()', () => {
  it('reports the error with route context', async () => {
    const mod = await loadActive();
    window.location.hash = '#/customise';
    const err = new Error('save failed');

    mod.captureError(err, { op: 'customisation.save' });

    const [reported, props] = mockPosthog.captureException.mock.calls[0];
    expect(reported).toBe(err);
    expect(props).toMatchObject({
      route: '/customise',
      handled: true,
      op: 'customisation.save',
    });
    expect(props.$current_url).toBe(window.location.href);
  });

  it('wraps non-Error throwables so they still get a stack', async () => {
    const mod = await loadActive();

    mod.captureError('just a string');

    const reported = mockPosthog.captureException.mock.calls[0][0];
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe('just a string');
  });

  it('lets caller context override the defaults', async () => {
    const mod = await loadActive();

    mod.captureError(new Error('x'), { handled: false });

    expect(mockPosthog.captureException.mock.calls[0][1].handled).toBe(false);
  });
});

describe('identify()', () => {
  it('sets user properties and the club group', async () => {
    const mod = await loadActive();

    mod.identify({ distinctId: 'u1', email: 'a@b.com', name: 'A', role: 'admin', clubSlug: 'c' });

    expect(mockPosthog.identify).toHaveBeenCalledWith('u1', {
      email: 'a@b.com', name: 'A', role: 'admin', club_slug: 'c',
    });
    expect(mockPosthog.group).toHaveBeenCalledWith('club', 'c', { slug: 'c' });
  });

  it('skips the group when there is no club', async () => {
    const mod = await loadActive();

    mod.identify({ distinctId: 'u1' });

    expect(mockPosthog.group).not.toHaveBeenCalled();
  });
});

describe('feature flag helpers', () => {
  it('delegate to posthog once active', async () => {
    const mod = await loadActive();

    mod.isFeatureEnabled('flag');
    mod.getFeatureFlagPayload('flag');
    await mod.reloadFeatureFlags();
    mod.reset();

    expect(mockPosthog.isFeatureEnabled).toHaveBeenCalledWith('flag', { send_event: false });
    expect(mockPosthog.getFeatureFlagPayload).toHaveBeenCalledWith('flag');
    expect(mockPosthog.reloadFeatureFlags).toHaveBeenCalled();
    expect(mockPosthog.reset).toHaveBeenCalled();
  });
});

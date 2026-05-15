import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

// jsdom does not implement ResizeObserver; stub it so Mantine's ScrollArea doesn't throw.
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    // NumberInput uses react-number-format which has a dual-React issue;
    // replace with a plain input to keep the test isolated.
    NumberInput: ({ label, value, onChange }: { label?: string; value?: unknown; onChange?: (v: unknown) => void }) => (
      <input aria-label={label ?? ''} value={String(value ?? '')} onChange={e => onChange?.(e.target.value)} />
    ),
  };
});

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/admin/subscription-levels')) {
      return { ok: true, json: async () => ({ levels: [] }) };
    }
    if (url.includes('/api/admin/team-subscription-levels')) {
      return { ok: true, json: async () => ({ teams: [] }) };
    }
    if (url.includes('/api/admin/status-subscription-levels')) {
      return { ok: true, json: async () => ({ statuses: [], clubRates: [], teamRates: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

import { SubscriptionLevelsTab } from '../../../pages/admin-payments/SubscriptionLevelsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

describe('SubscriptionLevelsTab', () => {
  it('shows loader initially when fetch never resolves', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(<SubscriptionLevelsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('renders component headings after loading', async () => {
    renderWithMantine(<SubscriptionLevelsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText('Defined levels')).toBeTruthy();
    });
    expect(screen.getByText('Create a subscription level')).toBeTruthy();
    expect(screen.getByText('Assign to teams')).toBeTruthy();
  });

  it('shows empty state when no subscription levels exist', async () => {
    renderWithMantine(<SubscriptionLevelsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText(/No subscription levels yet/i)).toBeTruthy();
    });
  });

  it('renders a subscription level row when a level is provided', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/team-subscription-levels')) {
        return { ok: true, json: async () => ({ teams: [] }) };
      }
      if (url.includes('/api/admin/status-subscription-levels')) {
        return { ok: true, json: async () => ({ statuses: [], clubRates: [], teamRates: [] }) };
      }
      if (url.includes('/api/admin/subscription-levels')) {
        return {
          ok: true,
          json: async () => ({
            levels: [
              {
                id: 'lvl-1',
                name: '5 Aside',
                yearlyPriceInPence: 25000,
                intervalCount: 10,
                intervalUnit: 'monthly',
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<SubscriptionLevelsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('5 Aside')).toBeTruthy();
    });
  });

  it('shows an error alert when fetch fails', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/subscription-levels')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ teams: [] }) };
    });

    renderWithMantine(<SubscriptionLevelsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });
});

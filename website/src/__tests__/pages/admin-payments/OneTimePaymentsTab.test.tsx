import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/admin/player-registrations')) {
      return { ok: true, json: async () => ({ registrations: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
});

import { OneTimePaymentsTab } from '../../../pages/admin-payments/OneTimePaymentsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

describe('OneTimePaymentsTab', () => {
  it('renders the picker without first loading the whole club', () => {
    // The club-wide load this replaces was the same unbounded read #114
    // removed from the registrations table; the picker searches instead.
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    expect(mockFetch.mock.calls.some(
      c => String(c[0]).startsWith('/api/admin/player-registrations'),
    )).toBe(false);
  });

  it('renders component headings after loading', async () => {
    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText('1. Select a registration')).toBeTruthy();
    });
    expect(screen.getByText('2. Configure one-off payment')).toBeTruthy();
  });

  it('renders the player select when registrations are loaded', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return {
          ok: true,
          json: async () => ({
            registrations: [
              {
                registrationId: 'reg-1',
                fanId: '99001',
                teamName: 'Under 12s',
                yearlyPriceInPence: null,
                intervalCount: null,
                intervalUnit: null,
                subscriptionLevelName: null,
              },
            ],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });
  });

  it('shows an error alert when a search fails', async () => {
    // Nothing is fetched until the admin types, so the failure surfaces on the
    // search rather than on mount.
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    fireEvent.change(screen.getByPlaceholderText(/Search by FAN number or team/i), {
      target: { value: 'Under' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to search player registrations/i)).toBeTruthy();
    });
  });
});

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
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
  it('shows loader initially when fetch never resolves', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
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
                ageGroup: 'U12',
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

  it('shows an error alert when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<OneTimePaymentsTab clubHeaders={clubHeaders} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
    expect(screen.getByText(/Failed to load player registrations/i)).toBeTruthy();
  });
});

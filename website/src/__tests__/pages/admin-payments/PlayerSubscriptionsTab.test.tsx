import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return { ...mod, Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

// jsdom doesn't implement scrollIntoView; stub it to prevent Mantine Combobox timer errors
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/admin/player-registrations')) {
      return { ok: true, json: async () => ({ registrations: [] }) };
    }
    if (url.includes('/api/admin/player-payments')) {
      return { ok: true, json: async () => ({ payments: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
});

import { PlayerSubscriptionsTab } from '../../../pages/admin-payments/PlayerSubscriptionsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

const sampleRegistration = {
  registrationId: 'reg-1',
  fanId: '12345',
  teamName: 'Under 10s',
  ageGroup: 'U10',
  yearlyPriceInPence: 3000,
  intervalCount: 12,
  intervalUnit: 'monthly',
  subscriptionLevelName: 'Junior Monthly',
  subscriptionLevelId: 'lvl-1',
};

const samplePayment = {
  id: 'pay-1',
  registrationId: 'reg-1',
  fanId: '12345',
  teamName: 'Under 10s',
  reference: 'UNDER10S-12345-SUBS-ABCD1234',
  mandateId: 'MD123',
  subscriptionId: 'SB456',
  status: 'active',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

describe('PlayerSubscriptionsTab', () => {
  it('shows loader initially when fetch never resolves', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('renders component headings after loading', async () => {
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    await waitFor(() => {
      expect(screen.getByText('1. Select a registration')).toBeTruthy();
    });
    expect(screen.getByText('2. Configure subscription')).toBeTruthy();
    expect(screen.getByText('Payment records')).toBeTruthy();
  });

  it('shows empty state when no registrations exist', async () => {
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    await waitFor(() => {
      expect(screen.getByText(/No registered players found/i)).toBeTruthy();
    });
  });

  it('shows player option in select when registrations are provided', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return {
          ok: true,
          json: async () => ({
            registrations: [
              {
                registrationId: 'reg-1',
                fanId: '12345',
                teamName: 'Under 10s',
                ageGroup: 'U10',
                yearlyPriceInPence: null,
                intervalCount: null,
                intervalUnit: null,
                subscriptionLevelName: null,
              },
            ],
          }),
        };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    // After loading the player select should be present (not the empty state)
    await waitFor(() => {
      // The empty state text should not be present
      expect(screen.queryByText(/No registered players found/i)).toBeNull();
    });
    // The select placeholder should appear
    expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
  });

  it('shows empty payment records state when no payments exist', async () => {
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    await waitFor(() => {
      expect(screen.getByText('No payment records yet.')).toBeTruthy();
    });
  });

  it('shows auto-fill alert with level name when a registration with a subscription level is selected', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    // Open the select dropdown and pick the registration
    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => {
      const option = screen.queryByText(/FAN 12345/i);
      if (option) fireEvent.click(option);
    });

    await waitFor(() => {
      // The auto-fill alert contains unique text — check that rather than the level name
      // which also appears in the badge ("Level: Junior Monthly")
      expect(screen.queryByText(/Auto-filled from team subscription level/i)).toBeTruthy();
    });
  });

  it('shows warning about existing payment records when SUBS payments exist for the selected registration', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [samplePayment] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => {
      const option = screen.queryByText(/FAN 12345/i);
      if (option) fireEvent.click(option);
    });

    await waitFor(() => {
      expect(screen.queryByText(/existing payment record/i)).toBeTruthy();
    });
  });

  it('renders the payment records table with FAN column when payments exist', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [samplePayment] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('FAN')).toBeTruthy();
    });
    expect(screen.getByText('12345')).toBeTruthy();
    expect(screen.getByText('Under 10s')).toBeTruthy();
  });

  it('shows "3. Share with player" section after link is generated successfully', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      if (url.includes('/api/gocardless/create-link')) {
        return {
          ok: true,
          json: async () => ({ authorisation_url: 'https://pay.example.com', reference: 'REF-001' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    // Select a registration so the Generate button becomes enabled
    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => {
      const option = screen.queryByText(/FAN 12345/i);
      if (option) fireEvent.click(option);
    });

    // Wait for the amount field to be auto-filled (registration has yearlyPriceInPence)
    await waitFor(() => {
      const generateBtn = screen.getByRole('button', { name: /Generate Payment Link/i });
      expect(generateBtn).toBeTruthy();
      fireEvent.click(generateBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/3\. Share with player/i)).toBeTruthy();
    });
  });

  it('shows Deactivate button for active payment and completes deactivation on confirm', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ payments: [samplePayment] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    // Wait for the payment row to appear, then the Deactivate button
    await waitFor(() => {
      expect(screen.getByText('Deactivate')).toBeTruthy();
    });

    // First click shows inline Confirm / Cancel
    fireEvent.click(screen.getByText('Deactivate'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /confirm/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    });

    // Confirm triggers the PATCH and updates the badge to Inactive
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeTruthy();
    });
  });

  it('shows error alert when generate link API returns ok:false', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      if (url.includes('/api/gocardless/create-link')) {
        return {
          ok: false,
          json: async () => ({ error: 'GC token not configured' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => {
      const option = screen.queryByText(/FAN 12345/i);
      if (option) fireEvent.click(option);
    });

    await waitFor(() => {
      const generateBtn = screen.getByRole('button', { name: /Generate Payment Link/i });
      expect(generateBtn).toBeTruthy();
      fireEvent.click(generateBtn);
    });

    await waitFor(() => {
      expect(screen.queryByText(/GC token not configured/i)).toBeTruthy();
    });
  });
});

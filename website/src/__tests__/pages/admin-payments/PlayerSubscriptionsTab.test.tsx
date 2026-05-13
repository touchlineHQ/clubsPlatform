import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return { ...mod, Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

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
});

import { PlayerSubscriptionsTab } from '../../../pages/admin-payments/PlayerSubscriptionsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

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
});

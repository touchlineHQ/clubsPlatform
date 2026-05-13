import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockMember, mockAdmin, mockSingleClub } from '../test-utils';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

// Modal and Tooltip use react-remove-scroll which has a dual-React conflict; stub them out.
vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Modal: ({ children, opened }: { children: React.ReactNode; opened: boolean }) =>
      opened ? <div data-testid="modal">{children}</div> : null,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

import { MyRegistrationsPage } from '../../pages/MyRegistrationsPage';

const sampleRow = {
  registrationId: 'reg_1',
  fanId: 'fan_1',
  teamName: 'First XI',
  ageGroup: 'Senior',
  registrationExpiry: '2025-08-01',
  registrationStatus: 'active',
  relationship: null,
  linkedAccounts: null,
  subscriptionLevelId: 'sub_1',
  subscriptionLevelName: 'Full Member',
  paymentStatus: 'active',
};

describe('MyRegistrationsPage', () => {
  it('renders personal registrations returned by API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [sampleRow], club: null, scope: 'user' }),
    });

    renderWithMantine(<MyRegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('First XI')).toBeTruthy();
    });
  });

  it('shows admin club tab when scope is admin', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [sampleRow], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<MyRegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });
  });

  it('shows a loader while fetching', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<MyRegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows an error when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<MyRegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeTruthy();
    });
  });
});

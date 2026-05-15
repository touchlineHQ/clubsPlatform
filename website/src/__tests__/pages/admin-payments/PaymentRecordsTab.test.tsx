import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return { ...mod, Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> };
});

vi.mock('@mantine/hooks', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/hooks')>();
  return { ...mod, useMediaQuery: () => false };
});

// jsdom doesn't implement scrollIntoView; stub it to prevent Mantine Combobox timer errors
if (typeof window !== 'undefined') {
  window.HTMLElement.prototype.scrollIntoView = () => {};
}

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => {
    return { ok: true, json: async () => ({ payments: [] }) };
  });
});

import { PaymentRecordsTab } from '../../../pages/admin-payments/PaymentRecordsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

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

const samplePayment2 = {
  id: 'pay-2',
  registrationId: 'reg-2',
  fanId: '99999',
  teamName: 'Sunday Vets',
  reference: 'SUNDAYVETS-99999-SUBS-XY789012',
  mandateId: 'MD456',
  subscriptionId: 'SB789',
  status: 'mandate_only',
  createdAt: 1700000001000,
  updatedAt: 1700000001000,
};

describe('PaymentRecordsTab', () => {
  it('shows loader initially when fetch never resolves', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows empty state when no payments exist', async () => {
    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    await waitFor(() => {
      expect(screen.getByText(/No payment records yet/i)).toBeTruthy();
    });
  });

  it('renders FAN column with payment data', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('12345')).toBeTruthy();
    });
    expect(screen.getByText('Under 10s')).toBeTruthy();
  });

  it('shows Active badge for active payment', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('Active')).toBeTruthy();
    });
  });

  it('shows Mandate only badge for mandate_only payment', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment2] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('Mandate only')).toBeTruthy();
    });
  });

  it('filters payments by team', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment, samplePayment2] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('12345')).toBeTruthy();
      expect(screen.getByText('99999')).toBeTruthy();
    });

    // Select "Under 10s" in the team filter
    const teamSelect = screen.getByRole('combobox', { name: /filter by team/i });
    fireEvent.click(teamSelect);
    await waitFor(() => {
      const option = screen.queryByRole('option', { name: 'Under 10s' });
      if (option) fireEvent.click(option);
    });

    await waitFor(() => {
      expect(screen.getByText('12345')).toBeTruthy();
      expect(screen.queryByText('99999')).toBeNull();
    });
  });

  it('filters payments by status', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment, samplePayment2] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('12345')).toBeTruthy();
    });

    // Select "Active" in the status filter (use role='option' to target dropdown, not the badge)
    const statusSelect = screen.getByRole('combobox', { name: /filter by status/i });
    fireEvent.click(statusSelect);
    await waitFor(() => {
      const option = screen.queryByRole('option', { name: 'Active' });
      if (option) fireEvent.click(option);
    });

    await waitFor(() => {
      expect(screen.getByText('12345')).toBeTruthy();
      expect(screen.queryByText('99999')).toBeNull();
    });
  });

  it('shows Deactivate button for active payment and completes deactivation on confirm', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (url.includes('/api/admin/player-payments')) {
        if (opts?.method === 'PATCH') {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return { ok: true, json: async () => ({ payments: [samplePayment] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

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

  it('cancels deactivation when Cancel is clicked', async () => {
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [samplePayment] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('Deactivate')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Deactivate'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.getByText('Deactivate')).toBeTruthy();
    });
  });

  it('shows no action button for inactive payments', async () => {
    const inactivePayment = { ...samplePayment, status: 'inactive' };
    mockFetch.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ payments: [inactivePayment] }),
    }));

    renderWithMantine(
      <PaymentRecordsTab clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByText('Inactive')).toBeTruthy();
    });
    expect(screen.queryByText('Deactivate')).toBeNull();
  });
});

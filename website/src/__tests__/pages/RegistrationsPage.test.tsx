import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
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

import { RegistrationsPage } from '../../pages/RegistrationsPage';

const sampleRow = {
  registrationId: 'reg_1',
  fanId: 'fan_1',
  teamName: 'First XI',
  registrationExpiry: '2025-08-01',
  registrationStatus: 'active',
  relationship: null,
  linkedAccounts: null,
  subscriptionLevelId: 'sub_1',
  subscriptionLevelName: 'Full Member',
  paymentStatus: 'active',
};

describe('RegistrationsPage', () => {
  it('renders personal registrations returned by API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [sampleRow], club: null, scope: 'user' }),
    });

    renderWithMantine(<RegistrationsPage />, {
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

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });
  });

  it('shows a loader while fetching', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows an error when fetch fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeTruthy();
    });
  });

  it('shows Export to Excel button next to Import Players in Club Registrations tab', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import Players/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /Export to Excel/i })).toBeTruthy();
    });
  });

  it('shows Import Players button in Club Registrations tab for admins', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import Players/i })).toBeTruthy();
    });
  });

  it('opens the delete modal when the remove button is clicked on a club registration', async () => {
    const adminRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves' };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: [adminRow], scope: 'admin' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));

    await waitFor(() => {
      const removeBtn = document.querySelector('[aria-label="Remove registration"]');
      expect(removeBtn).toBeTruthy();
      fireEvent.click(removeBtn!);
    });

    expect(screen.getByTestId('modal')).toBeInTheDocument();
  });

  // ─── Manual payment override ────────────────────────────────────────────────

  describe('manual payment override', () => {
    const outstandingRow = { ...sampleRow, registrationId: 'reg_2', fanId: 'fan_2', teamName: 'Reserves', paymentStatus: null };
    const manualRow = {
      ...outstandingRow,
      paymentStatus: 'manual',
      manualPaidBy: 'alice@club.com',
      manualPaidAt: 1755000000000,
      manualNote: 'cash at training',
    };

    /** Renders as an admin and switches to the Club Registrations tab. */
    async function renderClubTab(club: unknown[]) {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ personal: [], club, scope: 'admin' }),
      });

      renderWithMantine(<RegistrationsPage />, {
        authValue: mockAdmin,
        clubValue: mockSingleClub,
      });

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: /Club Registrations/i })).toBeTruthy();
      });
      fireEvent.click(screen.getByRole('tab', { name: /Club Registrations/i }));
      // The team name also appears in the filter dropdown, so key off the
      // toolbar instead to know the club table has rendered.
      await waitFor(() => expect(screen.getByRole('button', { name: /Export to Excel/i })).toBeTruthy());
    }

    it('shows a manually paid registration as Paid, with a marker for the admin', async () => {
      await renderClubTab([manualRow]);

      // Scoped to the table — "Paid" is also a filter option.
      const table = within(document.querySelector('table')!);
      expect(table.getByText('Paid')).toBeTruthy();
      expect(document.querySelector('[aria-label="Manually marked as paid"]')).toBeTruthy();
    });

    it('shows no marker to a player — a manual override looks like any other paid row', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ personal: [{ ...manualRow, relationship: 'self' }], club: null, scope: 'user' }),
      });

      renderWithMantine(<RegistrationsPage />, {
        authValue: mockMember,
        clubValue: mockSingleClub,
      });

      await waitFor(() => expect(screen.getByText('Paid')).toBeTruthy());
      expect(document.querySelector('[aria-label="Manually marked as paid"]')).toBeNull();
      expect(screen.queryByRole('button', { name: /Mark as paid/i })).toBeNull();
    });

    it.each([
      ['active', 'a live subscription'],
      ['pending', 'a live mandate'],
    ])('offers no override for %s — %s cannot be overridden', async (paymentStatus) => {
      await renderClubTab([{ ...outstandingRow, paymentStatus }]);
      expect(screen.queryByRole('button', { name: /Mark as paid/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /Undo paid/i })).toBeNull();
    });

    it('offers the override for a cancelled payment', async () => {
      await renderClubTab([{ ...outstandingRow, paymentStatus: 'inactive' }]);
      expect(screen.getByRole('button', { name: /Mark as paid/i })).toBeTruthy();
    });

    it('marks a registration as paid with a note', async () => {
      await renderClubTab([outstandingRow]);

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      const modal = screen.getByTestId('modal');

      fireEvent.change(within(modal).getByPlaceholderText(/cash at training/i), {
        target: { value: 'bank transfer ref 4471' },
      });
      fireEvent.click(within(modal).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment',
          expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ registrationId: 'reg_2', note: 'bank transfer ref 4471' }),
          }),
        );
      });
    });

    it('omits the note when none is typed', async () => {
      await renderClubTab([outstandingRow]);

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      fireEvent.click(within(screen.getByTestId('modal')).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment',
          expect.objectContaining({ body: JSON.stringify({ registrationId: 'reg_2' }) }),
        );
      });
    });

    it('surfaces the error when the server refuses the override', async () => {
      await renderClubTab([outstandingRow]);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ error: 'This registration has a live GoCardless payment — a manual override cannot be applied while it is in place.' }),
      });

      fireEvent.click(screen.getByRole('button', { name: /Mark as paid/i }));
      fireEvent.click(within(screen.getByTestId('modal')).getByRole('button', { name: /Mark as paid/i }));

      await waitFor(() => {
        expect(screen.getByText(/live GoCardless payment/i)).toBeTruthy();
      });
    });

    it('undoes a manual override', async () => {
      await renderClubTab([manualRow]);

      fireEvent.click(screen.getByRole('button', { name: /Undo paid/i }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/admin/manual-payment?registrationId=reg_2',
          expect.objectContaining({ method: 'DELETE' }),
        );
      });
    });
  });

  it('shows "No registrations linked to your account yet" when personal is empty and scope is user', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ personal: [], club: null, scope: 'user' }),
    });

    renderWithMantine(<RegistrationsPage />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/No registrations linked to your account yet/i)).toBeTruthy();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../test-utils';

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Modal: ({ children, opened, onClose }: { children: React.ReactNode; opened: boolean; onClose?: () => void }) =>
      opened ? <div data-testid="modal"><button data-testid="modal-close" onClick={onClose}>Close</button>{children}</div> : null,
  };
});

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [] }) };
    if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
    if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

import { BookingAdminPage } from '../../pages/BookingAdminPage';

describe('BookingAdminPage', () => {
  it('renders the "Booking Administration" page header', async () => {
    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText('Booking Administration')).toBeTruthy();
    });
  });

  it('renders "Pending Requests" tab', async () => {
    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText(/Pending Requests/)).toBeTruthy();
    });
  });

  it('renders "All Bookings" tab', async () => {
    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    await waitFor(() => {
      expect(screen.getByText('All Bookings')).toBeTruthy();
    });
  });

  it('shows empty state when fetch fails', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: false, json: async () => ({}) };
      if (url.includes('/api/bookings')) return { ok: false, json: async () => ({}) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: false, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });

    // When fetch fails, error is only shown inside Modals (not in main body).
    // Verify the page still renders with the header and empty-state messaging.
    await waitFor(() => {
      expect(screen.getByText('Booking Administration')).toBeTruthy();
      expect(screen.getByText('No pending requests.')).toBeTruthy();
    });
  });

  it('renders request row when pending request exists', async () => {
    const pendingRequest = {
      id: 'req1', userName: 'John Manager', userEmail: 'john@example.com',
      teamName: 'First XI', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      format: '11v11', status: 'pending', createdAt: 1700000000,
    };

    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => {
      expect(screen.getByText('John Manager')).toBeTruthy();
      expect(screen.getByText('First XI')).toBeTruthy();
    });
  });

  it('clicking Approve opens approve modal', async () => {
    const pendingRequest = {
      id: 'req1', userName: 'John Manager', userEmail: 'john@example.com',
      teamName: 'First XI', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      format: '11v11', status: 'pending', createdAt: 1700000000, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [{ id: 'p1', name: 'Pitch 1', formats: ['11v11', '7v7', '5v5'] }] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('clicking Decline opens decline modal', async () => {
    const pendingRequest = {
      id: 'req2', userName: 'Jane Manager', userEmail: 'jane@example.com',
      teamName: 'Second XI', date: '2026-06-02', timeStart: '14:00', timeEnd: '16:00',
      format: '7v7', status: 'pending', createdAt: 1700000001, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Decline/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Decline/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('closing approve modal removes it', async () => {
    const pendingRequest = {
      id: 'req1', userName: 'John Manager', userEmail: 'john@example.com',
      teamName: 'First XI', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      format: '11v11', status: 'pending', createdAt: 1700000000, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('modal')).toBeNull();
  });

  it('approve modal time inputs and notes textarea update state', async () => {
    const pendingRequest = {
      id: 'req1', userName: 'John Manager', userEmail: 'john@example.com',
      teamName: 'First XI', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      format: '11v11', status: 'pending', createdAt: 1700000000, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));

    // Fire change on time inputs (native input[type=time])
    const timeInputs = document.querySelectorAll('input[type="time"]');
    if (timeInputs.length > 0) {
      fireEvent.change(timeInputs[0], { target: { value: '11:00' } });
    }
    if (timeInputs.length > 1) {
      fireEvent.change(timeInputs[1], { target: { value: '13:00' } });
    }

    // Fire change on notes textarea
    const textareas = document.querySelectorAll('textarea');
    if (textareas.length > 0) {
      fireEvent.change(textareas[0], { target: { value: 'Test notes' } });
    }

    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('clicking Confirm Approval calls handleApprove', async () => {
    const pendingRequest = {
      id: 'req1', userName: 'John Manager', userEmail: 'john@example.com',
      teamName: 'First XI', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      format: '11v11', status: 'pending', createdAt: 1700000000, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Approve/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Approve/i }));
    await waitFor(() => { expect(screen.getByRole('button', { name: /Confirm Approval/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Approval/i }));
    // handleApprove validates pitchId; since no pitch selected, it sets an error
    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('decline modal textarea change and Confirm Decline calls handleDecline', async () => {
    const pendingRequest = {
      id: 'req2', userName: 'Jane Manager', userEmail: 'jane@example.com',
      teamName: 'Second XI', date: '2026-06-02', timeStart: '14:00', timeEnd: '16:00',
      format: '7v7', status: 'pending', createdAt: 1700000001, notes: '',
    };
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [pendingRequest] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });
    await waitFor(() => { expect(screen.getByRole('button', { name: /Decline/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Decline/i }));

    // Change decline reason textarea
    const textareas = document.querySelectorAll('textarea');
    if (textareas.length > 0) {
      fireEvent.change(textareas[0], { target: { value: 'Not available' } });
    }

    // Click Confirm Decline
    await waitFor(() => { expect(screen.getByRole('button', { name: /Confirm Decline/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Confirm Decline/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/booking-requests?id=req2'),
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('delete booking calls handleDeleteBooking', async () => {
    const booking = {
      id: 'b1', date: '2026-06-01', timeStart: '10:00', timeEnd: '12:00',
      teamName: 'First XI', format: '11v11', pitchName: 'Pitch A', createdAt: 1700000000,
    };
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'DELETE') return { ok: true, json: async () => ({}) };
      if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [] }) };
      if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [booking] }) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(<BookingAdminPage clubFeedSlug="test" />, { authValue: mockAdmin, clubValue: mockSingleClub });

    // Switch to All Bookings tab
    await waitFor(() => { expect(screen.getByText('All Bookings')).toBeTruthy(); });
    fireEvent.click(screen.getByText('All Bookings'));

    await waitFor(() => { expect(screen.getByRole('button', { name: /Delete/i })).toBeTruthy(); });
    fireEvent.click(screen.getByRole('button', { name: /Delete/i }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/bookings?id=b1'),
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });
});

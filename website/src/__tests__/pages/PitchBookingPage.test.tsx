import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockSingleClub } from '../test-utils';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [{ id: 'p1', name: 'Main Pitch', formats: ['11v11', '7v7'] }] }) };
    if (url.includes('/api/teams')) return { ok: true, json: async () => ({ sections: [], teams: [] }) };
    if (url.includes('/api/booking-requests')) return { ok: true, json: async () => ({ requests: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

import { PitchBookingPage } from '../../pages/PitchBookingPage';

describe('PitchBookingPage', () => {
  it('renders the page heading', async () => {
    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('Pitch Bookings')).toBeTruthy();
    });
  });

  it('renders "Request a Pitch" tab', async () => {
    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('Request a Pitch')).toBeTruthy();
    });
  });

  it('renders "My Requests" tab', async () => {
    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('My Requests')).toBeTruthy();
    });
  });

  it('shows "Request Booking" form elements (date input and format select)', async () => {
    renderWithMantine(<PitchBookingPage liveTeams={[]} />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      // The date input with label "Date"
      expect(screen.getByText('Date')).toBeTruthy();
      // The format select with label "Format"
      expect(screen.getByText('Format')).toBeTruthy();
    });
  });
});

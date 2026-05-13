import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockSingleClub } from '../test-utils';

vi.mock('@mantine/dates', () => ({
  DatePicker: ({ value, onChange }: { value: string | null; onChange: (d: string) => void }) => (
    <input
      type="date"
      data-testid="date-picker"
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
    />
  ),
}));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/api/bookings')) return { ok: true, json: async () => ({ bookings: [] }) };
    if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
    return { ok: true, json: async () => ({}) };
  });
});

import { PitchSchedulePage } from '../../pages/PitchSchedulePage';

describe('PitchSchedulePage', () => {
  it('shows loader initially', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    renderWithMantine(<PitchSchedulePage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows "Pitch Schedule" heading after loading', async () => {
    renderWithMantine(<PitchSchedulePage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('Pitch Schedule')).toBeTruthy();
    });
  });

  it('shows "Calendar" and "List" tabs after loading', async () => {
    renderWithMantine(<PitchSchedulePage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText('Calendar')).toBeTruthy();
      expect(screen.getByText('List')).toBeTruthy();
    });
  });

  it('shows upcoming bookings count in subtitle', async () => {
    renderWithMantine(<PitchSchedulePage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getByText(/upcoming/)).toBeTruthy();
    });
  });

  it('shows error when bookings fetch fails', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/bookings')) return { ok: false, json: async () => ({}) };
      if (url.includes('/api/pitches')) return { ok: true, json: async () => ({ pitches: [] }) };
      return { ok: false, json: async () => ({}) };
    });

    renderWithMantine(<PitchSchedulePage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SaveButton } from '../../components/customize/SaveButton';
import { renderWithMantine, mockSingleClub } from '../test-utils';
import type { AppData } from '../../types';

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();

  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, reload: vi.fn() },
  });
});

const appData: AppData = {
  club: {
    slug: 'test-club',
    name: 'Test FC',
    tagline: '',
    founded: 2000,
    email: '',
    address: { line1: '', line2: '', postcode: '' },
    what3words: '',
    socials: {},
    about: [],
    history: [],
  },
  teams: { sections: [] },
  committee: { committee: [] },
  registration: [],
  news: [],
  gallery: [],
  matchday: [],
  clubFeed: null,
  liveTeams: [],
  sidebarFeeds: [],
  visibility: {},
};

describe('SaveButton', () => {
  it("renders 'Save to Site' button initially", () => {
    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    expect(screen.getByRole('button', { name: /Save to Site/i })).toBeTruthy();
  });

  it('calls fetch on button click', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
  });

  it("shows 'Saved!' text after successful save", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() => expect(screen.getByText('Saved!')).toBeTruthy());
  });

  it("shows 'Error' text when fetch fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'bad' }),
    });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() => expect(screen.getByText('Error')).toBeTruthy());
  });
});

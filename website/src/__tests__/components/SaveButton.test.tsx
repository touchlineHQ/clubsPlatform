import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { SaveButton } from '../../components/customize/SaveButton';
import { renderWithMantine, mockSingleClub } from '../test-utils';
import { captureError, captureEvent } from '../../lib/posthog';
import type { AppData } from '../../types';

vi.mock('../../lib/posthog', () => ({ captureError: vi.fn(), captureEvent: vi.fn() }));

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  vi.mocked(captureError).mockClear();
  vi.mocked(captureEvent).mockClear();

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
    socials: { facebook: '', instagram: '', twitter: '' },
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
  manualFixtures: [],
  rawClubFeed: null,
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

  // The regression this guards: handleSave used to `catch {}` with no binding,
  // so a failed save produced no console output, no telemetry, and a message
  // telling the user to check a console that had nothing in it. PostHog shows
  // "registration items updated" last firing on 19 May 2026 — saves have been
  // failing silently for months.
  it('reports a failed save to PostHog', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() => expect(captureError).toHaveBeenCalled());

    const [error, context] = vi.mocked(captureError).mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(context).toMatchObject({ op: 'customisation.save' });
  });

  it('does not report anything on a successful save', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() => expect(screen.getByText('Saved!')).toBeTruthy());
    expect(captureError).not.toHaveBeenCalled();
  });

  it("records 'customisation saved' on success", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() =>
      expect(captureEvent).toHaveBeenCalledWith('customisation saved', expect.any(Object)));
  });

  // handleSave issues seven independent writes through Promise.all, which
  // rejects on the first failure while the rest stay in flight — so a failure
  // can leave some sections saved and others not. The message must not tell
  // the user their data is intact, or they'll walk away from a half-saved club.
  it('does not claim the save was a no-op when it fails', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    const message = await screen.findByText(/couldn't save/i);
    expect(message.textContent).toMatch(/may have saved/i);
    expect(message.textContent).not.toMatch(/nothing was lost/i);
  });

  it("records 'customisation save failed' on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() =>
      expect(captureEvent).toHaveBeenCalledWith('customisation save failed', expect.any(Object)));
    expect(captureEvent).not.toHaveBeenCalledWith('customisation saved', expect.anything());
  });
});

describe('SaveButton reset timer (#249)', () => {
  it('leaves no pending timers after unmount', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const { unmount } = renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));
    await waitFor(() => expect(screen.getByText('Saved!')).toBeTruthy());
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('still clears the result after 5 seconds while mounted', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));
    await waitFor(() => expect(screen.getByText('Saved!')).toBeTruthy());
    vi.useFakeTimers();
    try {
      // Timer was scheduled with real timers; re-click under fake timers to schedule a fake one.
      fireEvent.click(screen.getByRole('button', { name: /Saved!/i }));
      await vi.waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThan(8));
      await vi.runAllTimersAsync();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('SaveButton with invalid manual fixtures (#78)', () => {
  it('blocks the save and says why', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const bad: AppData = {
      ...appData,
      manualFixtures: [{ team: 'Reds', date: '', time: '', homeAway: 'home', opponent: 'Blues', venue: '', competition: '', homeScore: null, awayScore: null }],
    };
    renderWithMantine(<SaveButton data={bad} />, { clubValue: mockSingleClub });
    const button = screen.getByRole('button', { name: /Save to Site/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/Fix the highlighted games/)).toBeTruthy();
  });
});

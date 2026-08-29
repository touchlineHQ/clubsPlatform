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

  it("records 'customisation save failed' on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad' }) });

    renderWithMantine(<SaveButton data={appData} />, { clubValue: mockSingleClub });
    fireEvent.click(screen.getByRole('button', { name: /Save to Site/i }));

    await waitFor(() =>
      expect(captureEvent).toHaveBeenCalledWith('customisation save failed', expect.any(Object)));
    expect(captureEvent).not.toHaveBeenCalledWith('customisation saved', expect.anything());
  });
});

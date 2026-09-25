import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../../test-utils';

vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    // NumberInput uses react-number-format which has a dual-React issue under
    // vitest; replace with a plain input to keep the test isolated.
    NumberInput: ({ label, value, onChange }: { label?: string; value?: unknown; onChange?: (v: unknown) => void }) => (
      <input aria-label={label ?? ''} value={String(value ?? '')} onChange={e => onChange?.(e.target.value)} />
    ),
  };
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

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
});

import { PlayerSubscriptionsTab } from '../../../pages/admin-payments/PlayerSubscriptionsTab';

const clubHeaders: HeadersInit = { 'x-club-slug': 'test-club' };

const sampleRegistration = {
  registrationId: 'reg-1',
  fanId: '12345',
  teamName: 'Under 10s',
  yearlyPriceInPence: 3000,
  intervalCount: 12,
  intervalUnit: 'monthly',
  subscriptionLevelName: 'Junior Monthly',
  subscriptionLevelId: 'lvl-1',
};

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

/**
 * Type into the picker and choose an option.
 *
 * The player list is searched server-side now, so options only exist after two
 * characters and a debounce — the assertion inside waitFor is what makes the
 * wait real rather than vacuous.
 */
async function pickPlayer(search: string, option: RegExp) {
  fireEvent.change(screen.getByPlaceholderText(/Search by FAN number or team/i), {
    target: { value: search },
  });
  await waitFor(() => expect(screen.getByText(option)).toBeTruthy());
  fireEvent.click(screen.getByText(option));
}

describe('PlayerSubscriptionsTab', () => {
  it('renders the picker without first loading the whole club', async () => {
    // The club-wide load this replaces was the same unbounded read #114
    // removed from the registrations table; the picker searches instead.
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    expect(mockFetch.mock.calls.some(
      c => String(c[0]).startsWith('/api/admin/player-registrations'),
    )).toBe(false);
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
  });

  it('asks for two characters before searching', async () => {
    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    const input = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.click(input);
    await waitFor(() => expect(screen.getByText(/Type 2 or more characters/i)).toBeTruthy());

    // One character is below the threshold, so it must not reach the server.
    fireEvent.change(input, { target: { value: 'U' } });
    await waitFor(() => expect(screen.getByText(/Type 2 or more characters/i)).toBeTruthy());
    expect(mockFetch.mock.calls.some(
      c => String(c[0]).startsWith('/api/admin/player-registrations?q='),
    )).toBe(false);
  });

  it('discards a search the admin has already shortened', async () => {
    // Type "Un", then delete a character before the response lands. Without a
    // sequence bump on the short-query path the in-flight response is still
    // current, and its options render under "Type 2 or more characters".
    let release: (() => void) | null = null;
    mockFetch.mockImplementation(async (url: string) => {
      if (String(url).startsWith('/api/admin/player-registrations?q=')) {
        await new Promise<void>(resolve => { release = resolve; });
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (String(url).includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    const input = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.click(input);
    fireEvent.change(input, { target: { value: 'Un' } });
    await waitFor(() => expect(release).toBeTruthy());

    fireEvent.change(input, { target: { value: 'U' } });
    release!();

    await waitFor(() => expect(screen.getByText(/Type 2 or more characters/i)).toBeTruthy());
    expect(screen.queryByText(/FAN 12345/)).toBeNull();
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

    await pickPlayer('12345', /FAN 12345/i);

    expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    // The search reached the server rather than filtering a preloaded club.
    expect(mockFetch.mock.calls.some(
      c => String(c[0]).includes('/api/admin/player-registrations?q=12345'),
    )).toBe(true);
  });

  it('shows auto-fill alert with level name when a registration with a subscription level is selected', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
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

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    // Open the select dropdown and pick the registration
    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => expect(screen.getByText(/FAN 12345/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/FAN 12345/i));

    await waitFor(() => {
      // The auto-fill alert contains unique text — check that rather than the level name
      // which also appears in the badge ("Level: Junior Monthly")
      expect(screen.queryByText(/Auto-filled from team subscription level/i)).toBeTruthy();
    });
  });

  it('shows warning about existing payment records when SUBS payments exist for the selected registration', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [samplePayment] }) };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => expect(screen.getByText(/FAN 12345/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/FAN 12345/i));

    await waitFor(() => {
      expect(screen.queryByText(/existing payment record/i)).toBeTruthy();
    });
  });

  it('shows "3. Share with player" section after link is generated successfully', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      if (url.includes('/api/gocardless/create-link')) {
        return {
          ok: true,
          json: async () => ({ authorisation_url: 'https://pay.example.com', reference: 'REF-001' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    // Select a registration so the Generate button becomes enabled
    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => expect(screen.getByText(/FAN 12345/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/FAN 12345/i));

    // Selecting is async now — the row is fetched by id before the pricing
    // fields autofill — so wait for the button to actually be usable rather
    // than for it to merely exist.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Generate Payment Link/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Generate Payment Link/i }));

    await waitFor(() => {
      expect(screen.getByText(/3\. Share with player/i)).toBeTruthy();
    });
  });

  it('shows error alert when generate link API returns ok:false', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: true, json: async () => ({ registrations: [sampleRegistration] }) };
      }
      if (url.includes('/api/admin/player-payments')) {
        return { ok: true, json: async () => ({ payments: [] }) };
      }
      if (url.includes('/api/gocardless/create-link')) {
        return {
          ok: false,
          json: async () => ({ error: 'GC token not configured' }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search by FAN number or team/i)).toBeTruthy();
    });

    const selectInput = screen.getByPlaceholderText(/Search by FAN number or team/i);
    fireEvent.change(selectInput, { target: { value: '12345' } });

    await waitFor(() => expect(screen.getByText(/FAN 12345/i)).toBeTruthy());
    fireEvent.click(screen.getByText(/FAN 12345/i));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Generate Payment Link/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /Generate Payment Link/i }));

    await waitFor(() => {
      expect(screen.queryByText(/GC token not configured/i)).toBeTruthy();
    });
  });

  it('shows an error alert when a player search fails', async () => {
    // The tab used to own its own load error; the picker owns it now, and a
    // failed query that says nothing reads as "no such player".
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/api/admin/player-registrations')) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ payments: [] }) };
    });

    renderWithMantine(
      <PlayerSubscriptionsTab clubSlug="test-club" clubHeaders={clubHeaders} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );

    fireEvent.change(screen.getByPlaceholderText(/Search by FAN number or team/i), {
      target: { value: 'Under' },
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to search player registrations/i)).toBeTruthy();
    });
  });
});

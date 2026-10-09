import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';
import { PrivacyNoticePage } from '../../pages/PrivacyNoticePage';

const notice = {
  controller: {
    name: 'Test FC',
    clubSlug: 'test-club',
    email: 'sec@test.example',
    address: '1 Road, TE1 1ST',
  },
  hosting: {
    name: 'touchlineHQ',
    role: 'Provides hosting while one real club is on this deploy.',
  },
  processor: {
    name: 'touchlineHQ',
    role: 'Provides hosting while one real club is on this deploy.',
  },
  held: [
    'Admin and member account logins',
    'FA Number (FAN), team, registration status, and payment references',
  ],
  notHeld: ['Date of birth', 'Medical information', 'Safeguarding notes'],
  payments: 'Subscriptions are collected through GoCardless. FAN is the membership reference.',
  purposes: [
    { purpose: 'Membership and subscriptions', basis: 'Contract', notes: 'Required.' },
  ],
  retention: [{ data: 'Active registration', period: '6 years.' }],
  rights: ['Access — ask the club for a copy.'],
  howToContact: 'To ask Test FC to correct or delete personal data: Email sec@test.example.',
  marketingConsent: 'Marketing emails need consent.',
  icoFeeNote: 'The club is responsible for the ICO fee.',
  generatedAt: '2026-09-27T12:00:00.000Z',
};

describe('PrivacyNoticePage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads the club-scoped notice and names the club as controller', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.['X-Club-Slug']).toBe('test-club');
      return { ok: true, json: async () => notice };
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithMantine(<PrivacyNoticePage />, { authValue: mockLoggedOut });

    expect(await screen.findByText('Test FC')).toBeTruthy();
    expect(screen.getByText(/Data controller/i)).toBeTruthy();
    expect(screen.getByText(/What this club holds/i)).toBeTruthy();
    expect(screen.getByText(/What this club does not hold/i)).toBeTruthy();
    expect(screen.getByText(/Date of birth/i)).toBeTruthy();
    expect(screen.getByText(/GoCardless/i)).toBeTruthy();
    expect(screen.getByText(/correct or delete/i)).toBeTruthy();
    // One-club model: public notice names the club only (#148)
    expect(screen.queryByText(/touchlineHQ/i)).toBeNull();
    expect(screen.queryByText(/Hosting \/ software/i)).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('shows an error when the notice fails to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    renderWithMantine(<PrivacyNoticePage />, { authValue: mockLoggedOut });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Could not load the privacy notice/i);
    });
  });
});

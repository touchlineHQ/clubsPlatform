import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithMantine, mockAdmin, mockSingleClub } from '../test-utils';

// Stub the complex sub-tabs that make their own API calls.
vi.mock('../../pages/admin-payments/SubscriptionLevelsTab', () => ({
  SubscriptionLevelsTab: () => <div data-testid="levels-tab">Levels</div>,
}));
vi.mock('../../pages/admin-payments/PlayerSubscriptionsTab', () => ({
  PlayerSubscriptionsTab: () => <div data-testid="subs-tab">Subs</div>,
}));
vi.mock('../../pages/admin-payments/OneTimePaymentsTab', () => ({
  OneTimePaymentsTab: () => <div data-testid="onetime-tab">One-time</div>,
}));

const mockFetch = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
});

import { AdminPaymentsPage } from '../../pages/AdminPaymentsPage';

describe('AdminPaymentsPage', () => {
  it('renders the Payments header', () => {
    renderWithMantine(<AdminPaymentsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(screen.getByText('Payments')).toBeTruthy();
  });

  it('shows the GDPR compliance notice', () => {
    renderWithMantine(<AdminPaymentsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(screen.getByText(/GDPR Compliant/i)).toBeTruthy();
  });

  it('renders subscription levels tab by default', () => {
    renderWithMantine(<AdminPaymentsPage />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(screen.getByTestId('levels-tab')).toBeTruthy();
  });
});

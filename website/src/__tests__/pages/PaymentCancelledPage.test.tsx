import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithMantine } from '../test-utils';

const mockUseSearchParams = vi.hoisted(() => vi.fn(() => [new URLSearchParams(), vi.fn()]));
vi.mock('react-router-dom', () => ({
  useSearchParams: mockUseSearchParams,
}));

import { PaymentCancelledPage } from '../../pages/PaymentCancelledPage';

beforeEach(() => {
  mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()]);
});

describe('PaymentCancelledPage', () => {
  it('renders the cancelled heading when no reason is set', () => {
    renderWithMantine(<PaymentCancelledPage />);
    expect(screen.getByText('Payment Not Completed')).toBeTruthy();
  });

  it('renders failure heading when a technical error reason is set', () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams('reason=fetch_failed'), vi.fn()]);
    renderWithMantine(<PaymentCancelledPage />);
    expect(screen.getByText('Payment Setup Failed')).toBeTruthy();
  });

  it('renders a friendly reason label', () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams('reason=missing_params'), vi.fn()]);
    renderWithMantine(<PaymentCancelledPage />);
    expect(screen.getByText(/Required payment parameters were missing/)).toBeTruthy();
  });

  it('renders the return to home button', () => {
    renderWithMantine(<PaymentCancelledPage />);
    expect(screen.getByRole('link', { name: /Return to Home/i })).toBeTruthy();
  });
});

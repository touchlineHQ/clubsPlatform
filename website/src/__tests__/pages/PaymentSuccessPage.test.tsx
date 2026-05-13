import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithMantine } from '../test-utils';

const mockUseSearchParams = vi.hoisted(() => vi.fn(() => [new URLSearchParams(), vi.fn()]));
vi.mock('react-router-dom', () => ({
  useSearchParams: mockUseSearchParams,
}));

import { PaymentSuccessPage } from '../../pages/PaymentSuccessPage';

beforeEach(() => {
  mockUseSearchParams.mockReturnValue([new URLSearchParams(), vi.fn()]);
});

describe('PaymentSuccessPage', () => {
  it('renders the success heading', () => {
    renderWithMantine(<PaymentSuccessPage />);
    expect(screen.getByText('Payment Setup Complete')).toBeTruthy();
  });

  it('renders the return to home button', () => {
    renderWithMantine(<PaymentSuccessPage />);
    expect(screen.getByRole('link', { name: /Return to Home/i })).toBeTruthy();
  });

  it('shows mandate ID when present in URL params', () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams('mandate=MD123'), vi.fn()]);
    renderWithMantine(<PaymentSuccessPage />);
    expect(screen.getByText('MD123')).toBeTruthy();
  });

  it('shows warning alert for subscription_failed warning', () => {
    mockUseSearchParams.mockReturnValue([new URLSearchParams('warning=subscription_failed&ref=REF01'), vi.fn()]);
    renderWithMantine(<PaymentSuccessPage />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';

const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  authClient: { requestPasswordReset: mockRequestPasswordReset },
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';

function submit(email = 'parent@example.com') {
  const input = document.querySelector('input[type="email"]') as HTMLInputElement;
  fireEvent.change(input, { target: { value: email } });
  fireEvent.submit(screen.getByRole('button', { name: /Send reset link/i }).closest('form')!);
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestPasswordReset.mockResolvedValue({ error: null });
  });

  it('renders the form', () => {
    renderWithMantine(<ForgotPasswordPage />, { authValue: mockLoggedOut });
    expect(screen.getByRole('heading', { name: 'Forgot Password' })).toBeTruthy();
  });

  it('asks the API for a reset link', async () => {
    renderWithMantine(<ForgotPasswordPage />, { authValue: mockLoggedOut });
    submit();

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({ email: 'parent@example.com' });
    });
  });

  it('confirms without saying whether the address has an account', async () => {
    renderWithMantine(<ForgotPasswordPage />, { authValue: mockLoggedOut });
    submit();

    await waitFor(() => {
      expect(screen.getByText(/If that address has an account/i)).toBeTruthy();
    });
  });

  it('gives exactly the same answer when the request fails', async () => {
    // Any difference here — an error banner, a different message — turns the
    // form into a way of testing whether a parent is registered with the club.
    mockRequestPasswordReset.mockRejectedValue(new Error('network'));
    renderWithMantine(<ForgotPasswordPage />, { authValue: mockLoggedOut });
    submit('nobody@example.com');

    await waitFor(() => {
      expect(screen.getByText(/If that address has an account/i)).toBeTruthy();
    });
    expect(screen.queryByText(/network/i)).toBeNull();
  });
});

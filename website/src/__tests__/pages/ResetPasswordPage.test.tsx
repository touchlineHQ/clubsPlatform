import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';

const mockResetPassword = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  authClient: { resetPassword: mockResetPassword },
}));

const mockNavigate = vi.hoisted(() => vi.fn());
const mockSearchParams = vi.hoisted(() => ({ current: new URLSearchParams('token=tok123') }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [mockSearchParams.current, vi.fn()],
}));

import { ResetPasswordPage } from '../../pages/ResetPasswordPage';

const GOOD = 'a-long-enough-password';

/** Mantine's PasswordInput does not associate its label the way getByLabelText wants. */
function passwordInputs() {
  return document.querySelectorAll('input[type="password"]') as NodeListOf<HTMLInputElement>;
}

function fill(password: string, confirm = password) {
  const [next, again] = passwordInputs();
  fireEvent.change(next, { target: { value: password } });
  fireEvent.change(again, { target: { value: confirm } });
  fireEvent.submit(screen.getByRole('button', { name: /Save password/i }).closest('form')!);
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.current = new URLSearchParams('token=tok123');
    mockResetPassword.mockResolvedValue({ error: null });
  });

  it('sends the new password with the token from the link', async () => {
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill(GOOD);

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({ newPassword: GOOD, token: 'tok123' });
    });
  });

  it('confirms once the password is set', async () => {
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill(GOOD);

    await waitFor(() => {
      expect(screen.getByText(/Your password is set/i)).toBeTruthy();
    });
  });

  it('rejects a password below the sign-up floor without calling the API', async () => {
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill('short');

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 10 characters')).toBeTruthy();
    });
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('rejects a mismatched confirmation without calling the API', async () => {
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill(GOOD, `${GOOD}-different`);

    await waitFor(() => {
      expect(screen.getByText(/must match/i)).toBeTruthy();
    });
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('explains an expired or spent token and offers a new link', async () => {
    mockResetPassword.mockResolvedValue({ error: { message: 'Invalid token' } });
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill(GOOD);

    await waitFor(() => {
      expect(screen.getByText('Invalid token')).toBeTruthy();
    });
    expect(screen.getByText(/Request a new one/i)).toBeTruthy();
  });

  it('recovers from a thrown request', async () => {
    mockResetPassword.mockRejectedValue(new Error('network'));
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });
    fill(GOOD);

    await waitFor(() => {
      expect(screen.getByText(/request a new link/i)).toBeTruthy();
    });
  });

  it('says so when the link arrived without a token', () => {
    mockSearchParams.current = new URLSearchParams();
    renderWithMantine(<ResetPasswordPage />, { authValue: mockLoggedOut });

    expect(screen.getByText(/missing its token/i)).toBeTruthy();
    expect(passwordInputs().length).toBe(0);
  });
});

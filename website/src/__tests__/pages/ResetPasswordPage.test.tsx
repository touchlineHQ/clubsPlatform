import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockSingleClub } from '../test-utils';

const mockResetPassword = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({ resetPassword: mockResetPassword }));

const searchParams = vi.hoisted(() => ({ current: new URLSearchParams('token=tok123') }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useSearchParams: () => [searchParams.current, vi.fn()],
}));

import { ResetPasswordPage } from '../../pages/ResetPasswordPage';

function passwordInputs() {
  return Array.from(document.querySelectorAll('input[type="password"]')) as HTMLInputElement[];
}
function fill(password: string, confirm = password) {
  const [a, b] = passwordInputs();
  fireEvent.change(a, { target: { value: password } });
  fireEvent.change(b, { target: { value: confirm } });
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: /Save password/i }).closest('form')!);
}
function render() {
  renderWithMantine(<ResetPasswordPage />, {
    authValue: mockLoggedOut,
    clubValue: mockSingleClub,
  });
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams.current = new URLSearchParams('token=tok123');
    mockResetPassword.mockResolvedValue({ error: null });
  });

  it('renders both password fields when the link carries a token', () => {
    render();
    expect(passwordInputs()).toHaveLength(2);
  });

  // Someone who pasted only half the link should be told what to do, not shown
  // a form that will fail on submit.
  it('explains itself when the link has no token', () => {
    searchParams.current = new URLSearchParams();
    render();
    expect(screen.getByText(/missing its reset code/i)).toBeTruthy();
    expect(passwordInputs()).toHaveLength(0);
  });

  it('sends the new password with the token from the link', async () => {
    render();
    fill('a-long-enough-password');
    submit();

    await waitFor(() => {
      expect(mockResetPassword).toHaveBeenCalledWith({
        newPassword: 'a-long-enough-password',
        token: 'tok123',
      });
    });
  });

  // The floor matches SIGNUP_LIMITS.passwordMin, so a reset cannot set a
  // password the sign-up form would have refused.
  it('refuses a password under ten characters without calling the API', async () => {
    render();
    fill('short');
    submit();

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 10 characters')).toBeTruthy();
    });
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('refuses mismatched passwords without calling the API', async () => {
    render();
    fill('a-long-enough-password', 'a-different-password');
    submit();

    await waitFor(() => {
      expect(screen.getByText(/do not match/i)).toBeTruthy();
    });
    expect(mockResetPassword).not.toHaveBeenCalled();
  });

  it('surfaces the API error for an expired or spent link', async () => {
    mockResetPassword.mockResolvedValue({ error: { message: 'invalid token' } });
    render();
    fill('a-long-enough-password');
    submit();

    await waitFor(() => {
      expect(screen.getByText('invalid token')).toBeTruthy();
    });
  });

  it('offers a way to sign in once the password is set', async () => {
    render();
    fill('a-long-enough-password');
    submit();

    await waitFor(() => {
      expect(screen.getByText(/Your password is set/i)).toBeTruthy();
    });
    expect(screen.getByRole('link', { name: /Sign in/i })).toBeTruthy();
  });

  it('shows an error when the request throws', async () => {
    mockResetPassword.mockRejectedValue(new Error('offline'));
    render();
    fill('a-long-enough-password');
    submit();

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockSingleClub } from '../test-utils';

const mockRequestPasswordReset = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({ requestPasswordReset: mockRequestPasswordReset }));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage';

function getEmailInput() {
  return document.querySelector('input[type="email"]') as HTMLInputElement;
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: /Send reset link/i }).closest('form')!);
}
function render() {
  renderWithMantine(<ForgotPasswordPage />, {
    authValue: mockLoggedOut,
    clubValue: mockSingleClub,
  });
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequestPasswordReset.mockResolvedValue({ error: null });
  });

  it('renders the email form', () => {
    render();
    expect(getEmailInput()).toBeTruthy();
    expect(screen.getByRole('button', { name: /Send reset link/i })).toBeTruthy();
  });

  it('submits the trimmed address', async () => {
    render();
    fireEvent.change(getEmailInput(), { target: { value: '  parent@example.com ' } });
    submit();

    await waitFor(() => {
      expect(mockRequestPasswordReset).toHaveBeenCalledWith({ email: 'parent@example.com' });
    });
  });

  // A page that says "no account with that email" would let anyone check which
  // parents are on a club's books.
  it('confirms without revealing whether the account exists', async () => {
    render();
    fireEvent.change(getEmailInput(), { target: { value: 'nobody@example.com' } });
    submit();

    await waitFor(() => {
      expect(screen.getByText(/If an account exists for that address/i)).toBeTruthy();
    });
    expect(document.querySelector('input[type="email"]')).toBeNull();
  });

  it('shows an error rather than a false confirmation when the API rejects', async () => {
    mockRequestPasswordReset.mockResolvedValue({ error: { message: 'nope' } });
    render();
    fireEvent.change(getEmailInput(), { target: { value: 'parent@example.com' } });
    submit();

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    });
    expect(screen.queryByText(/If an account exists/i)).toBeNull();
  });

  it('shows an error and keeps the form when the request throws', async () => {
    mockRequestPasswordReset.mockRejectedValue(new Error('offline'));
    render();
    fireEvent.change(getEmailInput(), { target: { value: 'parent@example.com' } });
    submit();

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
    });
    expect(getEmailInput()).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockSingleClub } from '../test-utils';

const mockSignIn = vi.hoisted(() => vi.fn());
const mockSignOut = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  signIn: { email: mockSignIn },
  signOut: mockSignOut,
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { LoginPage } from '../../pages/LoginPage';

function getEmailInput() {
  return document.querySelector('input[type="email"]') as HTMLInputElement;
}
function getPasswordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ error: null });
    mockSignOut.mockResolvedValue(undefined);
  });

  it('renders the login form', () => {
    renderWithMantine(<LoginPage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });
    expect(getEmailInput()).toBeTruthy();
    expect(getPasswordInput()).toBeTruthy();
    expect(screen.getByRole('button', { name: /Log In/i })).toBeTruthy();
  });

  it('shows an error alert when signIn returns an error', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    const mockRefresh = vi.fn().mockResolvedValue(null);
    renderWithMantine(<LoginPage />, {
      authValue: { ...mockLoggedOut, refresh: mockRefresh },
      clubValue: mockSingleClub,
    });

    fireEvent.change(getEmailInput(), { target: { value: 'bad@example.com' } });
    fireEvent.change(getPasswordInput(), { target: { value: 'wrong' } });
    fireEvent.submit(screen.getByRole('button', { name: /Log In/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeTruthy();
    });
  });

  it('navigates after successful login', async () => {
    const mockRefresh = vi.fn().mockResolvedValue({ id: 'u1', clubSlug: 'test-club' });
    mockSignIn.mockResolvedValue({ error: null });

    renderWithMantine(<LoginPage />, {
      authValue: { ...mockLoggedOut, refresh: mockRefresh },
      clubValue: mockSingleClub,
    });

    fireEvent.change(getEmailInput(), { target: { value: 'alice@example.com' } });
    fireEvent.change(getPasswordInput(), { target: { value: 'secret' } });
    fireEvent.submit(screen.getByRole('button', { name: /Log In/i }).closest('form')!);

    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'secret' });
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  it('shows error when signIn throws', async () => {
    mockSignIn.mockRejectedValue(new Error('Network error'));
    renderWithMantine(<LoginPage />, {
      authValue: mockLoggedOut,
      clubValue: mockSingleClub,
    });

    fireEvent.change(getEmailInput(), { target: { value: 'a@b.com' } });
    fireEvent.change(getPasswordInput(), { target: { value: 'pw' } });
    fireEvent.submit(screen.getByRole('button', { name: /Log In/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText(/Login failed/i)).toBeTruthy();
    });
  });
});

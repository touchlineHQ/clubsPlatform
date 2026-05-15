import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';

const mockSignUp = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  signUp: { email: mockSignUp },
}));

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));

import { SignUpPage } from '../../pages/SignUpPage';

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignUp.mockResolvedValue({ error: null });
  });

  it('renders the sign up form', () => {
    renderWithMantine(<SignUpPage />, { authValue: mockLoggedOut });
    expect(screen.getByRole('heading', { name: 'Create Account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Create Account/i })).toBeTruthy();
  });

  it('shows an error when signUp returns an error', async () => {
    mockSignUp.mockResolvedValue({ error: { message: 'Email already in use' } });
    const mockRefresh = vi.fn().mockResolvedValue(null);

    renderWithMantine(<SignUpPage />, {
      authValue: { ...mockLoggedOut, refresh: mockRefresh },
    });

    fireEvent.submit(screen.getByRole('button', { name: /Create Account/i }).closest('form')!);

    await waitFor(() => {
      expect(screen.getByText('Email already in use')).toBeTruthy();
    });
  });

  it('calls navigate after successful sign up', async () => {
    const mockRefresh = vi.fn().mockResolvedValue({ id: 'u1' });
    mockSignUp.mockResolvedValue({ error: null });

    renderWithMantine(<SignUpPage />, {
      authValue: { ...mockLoggedOut, refresh: mockRefresh },
    });

    fireEvent.submit(screen.getByRole('button', { name: /Create Account/i }).closest('form')!);

    await waitFor(() => {
      expect(mockSignUp).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalled();
    });
  });

  it('typing in name field updates state', () => {
    renderWithMantine(<SignUpPage />, { authValue: mockLoggedOut });
    const inputs = document.querySelectorAll('input[type="text"]');
    if (inputs.length > 0) {
      const nameInput = inputs[0] as HTMLInputElement;
      fireEvent.change(nameInput, { target: { value: 'John Doe' } });
      expect(nameInput.value).toBe('John Doe');
    }
  });

  it('typing in email field updates state', () => {
    renderWithMantine(<SignUpPage />, { authValue: mockLoggedOut });
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    if (emailInput) {
      fireEvent.change(emailInput, { target: { value: 'john@example.com' } });
      expect(emailInput.value).toBe('john@example.com');
    }
  });

  it('typing in password field updates state', () => {
    renderWithMantine(<SignUpPage />, { authValue: mockLoggedOut });
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    if (passwordInput) {
      fireEvent.change(passwordInput, { target: { value: 'secret123' } });
      expect(passwordInput.value).toBe('secret123');
    }
  });
});

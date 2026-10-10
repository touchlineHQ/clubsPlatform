import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';

const mockSignIn = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  signIn: { email: mockSignIn },
  authClient: {},
}));

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

import { PlatformLoginPage } from '../../pages/PlatformLoginPage';

describe('PlatformLoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without a ClubContext and links to forgot-password', () => {
    renderWithMantine(<PlatformLoginPage />, { authValue: mockLoggedOut });
    expect(screen.getByRole('heading', { name: 'Platform Log In' })).toBeTruthy();
    expect(screen.getByText('Forgot your password?').closest('a')!.getAttribute('href')).toBe('/forgot-password');
  });

  it('shows the error when sign-in is rejected', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid email or password' } });
    renderWithMantine(<PlatformLoginPage />, { authValue: mockLoggedOut });
    fireEvent.change(document.querySelector('input[type="email"]') as HTMLInputElement, { target: { value: 'a@b.co' } });
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, { target: { value: 'pw' } });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(screen.getByText('Invalid email or password')).toBeTruthy());
  });
});

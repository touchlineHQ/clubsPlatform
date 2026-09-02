import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut } from '../test-utils';
import type { AuthUser } from '../../context/AuthContext';

const mockSignIn = vi.hoisted(() => vi.fn());
vi.mock('../../auth-client', () => ({
  signIn: { email: mockSignIn },
  signOut: vi.fn(),
}));

const mockCaptureEvent = vi.hoisted(() => vi.fn());
vi.mock('../../lib/posthog', () => ({
  captureEvent: mockCaptureEvent,
  identify: vi.fn(),
  reset: vi.fn(),
  pageview: vi.fn(),
}));

import { LoginForm } from '../../components/LoginForm';

const alice: AuthUser = { id: 'u1', name: 'Alice', email: 'alice@example.com', role: 'admin', clubSlug: 'test-club' };

function getEmailInput() {
  return document.querySelector('input[type="email"]') as HTMLInputElement;
}
function getPasswordInput() {
  return document.querySelector('input[type="password"]') as HTMLInputElement;
}

function submit() {
  fireEvent.change(getEmailInput(), { target: { value: 'alice@example.com' } });
  fireEvent.change(getPasswordInput(), { target: { value: 'secret' } });
  fireEvent.submit(screen.getByRole('button', { name: /Log In/i }).closest('form')!);
}

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignIn.mockResolvedValue({ error: null });
  });

  const authValue = { ...mockLoggedOut, refresh: vi.fn(async () => alice) };

  it('signs in with the credentials entered', async () => {
    const onSuccess = vi.fn(async () => null);
    renderWithMantine(<LoginForm onSuccess={onSuccess} />, { authValue });
    submit();
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledWith({ email: 'alice@example.com', password: 'secret' });
    });
  });

  it('hands the refreshed user to onSuccess', async () => {
    const onSuccess = vi.fn(async () => null);
    renderWithMantine(<LoginForm onSuccess={onSuccess} />, { authValue });
    submit();
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith(alice);
    });
    expect(mockCaptureEvent).toHaveBeenCalledWith('login succeeded');
  });

  it('shows the rejection from the auth server', async () => {
    mockSignIn.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    renderWithMantine(<LoginForm onSuccess={vi.fn(async () => null)} />, { authValue });
    submit();
    await waitFor(() => {
      expect(screen.getByText('Invalid credentials')).toBeTruthy();
    });
    expect(mockCaptureEvent).toHaveBeenCalledWith('login failed', { reason: 'rejected' });
  });

  // How LoginPage turns away someone signing in on the wrong club's page: the
  // credentials were good, the caller still refuses the session.
  it('shows the message onSuccess returns and does not count it as a success', async () => {
    const onSuccess = vi.fn(async () => 'This account is not registered with this club.');
    renderWithMantine(<LoginForm onSuccess={onSuccess} />, { authValue });
    submit();
    await waitFor(() => {
      expect(screen.getByText('This account is not registered with this club.')).toBeTruthy();
    });
    expect(mockCaptureEvent).not.toHaveBeenCalledWith('login succeeded');
  });

  it('reports a thrown request as an error', async () => {
    mockSignIn.mockRejectedValue(new Error('network'));
    renderWithMantine(<LoginForm onSuccess={vi.fn(async () => null)} />, { authValue });
    submit();
    await waitFor(() => {
      expect(screen.getByText(/Login failed/i)).toBeTruthy();
    });
    expect(mockCaptureEvent).toHaveBeenCalledWith('login failed', { reason: 'error' });
  });
});

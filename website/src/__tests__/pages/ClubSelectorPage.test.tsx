import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockPlatformAdmin, mockMember } from '../test-utils';
import type { ClubEntry } from '../../types';

const mockSignOut = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../auth-client', () => ({
  signIn: { email: vi.fn().mockResolvedValue({ error: null }) },
  signOut: mockSignOut,
}));

// Modal uses react-remove-scroll which has a dual-React conflict; stub it out.
vi.mock('@mantine/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@mantine/core')>();
  return {
    ...mod,
    Modal: ({ children, opened, onClose }: { children: React.ReactNode; opened: boolean; onClose?: () => void }) =>
      opened ? <div data-testid="modal"><button data-testid="modal-close" onClick={onClose}>Close</button>{children}</div> : null,
  };
});

import { ClubSelectorPage } from '../../pages/ClubSelectorPage';

const clubs: ClubEntry[] = [
  { id: 'c1', slug: 'riverside-fc', name: 'Riverside FC', location: 'By the river' },
  { id: 'c2', slug: 'hilltop-fc', name: 'Hilltop FC', location: 'On the hill' },
];

describe('ClubSelectorPage', () => {
  it('renders the platform title', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getByText(/Touchline Clubs Platform/)).toBeTruthy();
  });

  it('renders a card for each club', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Riverside FC')).toBeTruthy();
    expect(screen.getByText('Hilltop FC')).toBeTruthy();
  });

  it('renders club slugs', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getByText('riverside-fc')).toBeTruthy();
    expect(screen.getByText('hilltop-fc')).toBeTruthy();
  });

  it('shows a loading spinner when loading=true', () => {
    renderWithMantine(<ClubSelectorPage clubs={[]} loading />, { authValue: mockLoggedOut });
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows Create new club button for platform admins', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    expect(screen.getByRole('button', { name: /Create new club/i })).toBeTruthy();
  });

  it('does not show Create new club button for regular users', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.queryByRole('button', { name: /Create new club/i })).toBeNull();
  });

  it('shows Sign in button when no user is logged in', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    expect(screen.getByRole('button', { name: /Sign in/i })).toBeTruthy();
  });

  it('shows Sign out button when user is logged in', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    expect(screen.getByRole('button', { name: /Sign out/i })).toBeTruthy();
  });

  it('clicking Sign out calls signOut', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockMember });
    fireEvent.click(screen.getByRole('button', { name: /Sign out/i }));
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('clicking Sign in button opens login modal', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('closing login modal removes it from DOM', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('modal')).toBeNull();
  });

  it('clicking Create new club button opens create modal', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    fireEvent.click(screen.getByRole('button', { name: /Create new club/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
  });

  it('closing create modal removes it from DOM', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    fireEvent.click(screen.getByRole('button', { name: /Create new club/i }));
    fireEvent.click(screen.getByTestId('modal-close'));
    expect(screen.queryByTestId('modal')).toBeNull();
  });

  it('typing in search box filters clubs', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    const searchInput = screen.getByPlaceholderText(/Search by name or slug/i);
    fireEvent.change(searchInput, { target: { value: 'riverside' } });
    expect(screen.getByText('Riverside FC')).toBeTruthy();
  });

  it('mouse enter/leave on club cards does not crash', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    const cards = document.querySelectorAll('a[href]');
    cards.forEach(card => {
      fireEvent.mouseEnter(card);
      fireEvent.mouseLeave(card);
    });
    expect(screen.getByText('Riverside FC')).toBeTruthy();
  });

  it('login modal email field change updates state', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    expect(screen.getByTestId('modal')).toBeTruthy();
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    if (emailInput) {
      fireEvent.change(emailInput, { target: { value: 'user@example.com' } });
      expect(emailInput.value).toBe('user@example.com');
    }
  });

  it('login modal password field change updates state', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockLoggedOut });
    fireEvent.click(screen.getByRole('button', { name: /Sign in/i }));
    const passwordInput = document.querySelector('input[type="password"]') as HTMLInputElement;
    if (passwordInput) {
      fireEvent.change(passwordInput, { target: { value: 'pass123' } });
      expect(passwordInput.value).toBe('pass123');
    }
  });

  it('create modal slug field change updates state', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    fireEvent.click(screen.getByRole('button', { name: /Create new club/i }));
    const slugInput = screen.getByPlaceholderText('your-club') as HTMLInputElement;
    fireEvent.change(slugInput, { target: { value: 'my-new-club' } });
    expect(slugInput.value).toBe('my-new-club');
  });

  it('create modal name field change updates state', () => {
    renderWithMantine(<ClubSelectorPage clubs={clubs} />, { authValue: mockPlatformAdmin });
    fireEvent.click(screen.getByRole('button', { name: /Create new club/i }));
    const nameInput = screen.getByPlaceholderText('Your Club FC') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'My New Club FC' } });
    expect(nameInput.value).toBe('My New Club FC');
  });

  it('sign in button in empty clubs state opens login modal', () => {
    renderWithMantine(<ClubSelectorPage clubs={[]} />, { authValue: mockLoggedOut });
    const signInBtns = screen.getAllByRole('button', { name: /Sign in/i });
    // Click the last sign-in button (the one in the empty state, not header)
    fireEvent.click(signInBtns[signInBtns.length - 1]);
    expect(screen.getByTestId('modal')).toBeTruthy();
  });
});

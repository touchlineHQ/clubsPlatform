import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { HomePage } from '../../pages/HomePage';
import { renderWithMantine, mockLoggedOut, mockMember } from '../test-utils';
import type { Club, VisibleItems } from '../../types';

vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const club: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Our great club',
  founded: 1990,
  email: 'info@testfc.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: 'abc.def.ghi',
  socials: { facebook: '#', instagram: '#', twitter: '#' },
  about: [
    { icon: 'fa-heart', title: 'Community', text: 'We care about our local community.' },
  ],
  history: ['The club was founded in 1990.'],
  nav: [],
  colours: 'Red and Black',
};

const visibility: VisibleItems = {
  '/about': true,
  '/register': true,
};

describe('HomePage', () => {
  it('renders the club name', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Test FC')).toBeTruthy();
  });

  it('renders the club tagline', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Our great club')).toBeTruthy();
  });

  it('renders founded stat', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByText('1990')).toBeTruthy();
    expect(screen.getByText('Founded')).toBeTruthy();
  });

  it('renders club colours stat', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Red and Black')).toBeTruthy();
    expect(screen.getByText('Club colours')).toBeTruthy();
  });

  it('renders about item titles when about is set', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Community')).toBeTruthy();
  });

  it('shows My Teams section when user is logged in with team roles', () => {
    const authWithTeams = {
      ...mockMember,
      teamRoles: [
        { id: 'utr_1', teamSlug: 'first-xi', teamLeague: 'Sunday', teamName: 'First XI', role: 'subscriber' as const },
      ],
    };
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: authWithTeams });
    expect(screen.getByText('My Teams')).toBeTruthy();
    expect(screen.getByText('First XI')).toBeTruthy();
  });

  it('does not show My Teams section when logged out', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.queryByText('My Teams')).toBeNull();
  });

  it('shows About Us button when /about is visible', () => {
    renderWithMantine(<HomePage club={club} visibility={visibility} />, { authValue: mockLoggedOut });
    expect(screen.getByRole('link', { name: 'About Us' })).toBeTruthy();
  });
});

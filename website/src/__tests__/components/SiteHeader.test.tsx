import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockAdmin, mockMember, mockSection, mockSingleClub } from '../test-utils';
import type { Club, TeamSection } from '../../types';

const mockNavigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => mockNavigate,
  useLocation: () => ({ pathname: '/' }),
}));

vi.mock('../../auth-client', () => ({
  signOut: vi.fn().mockResolvedValue(undefined),
}));

import { SiteHeader } from '../../components/SiteHeader';

const club: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'info@testfc.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: 'abc.def.ghi',
  socials: {
    facebook: 'https://facebook.com/testfc',
    instagram: 'https://instagram.com/testfc',
    twitter: 'https://twitter.com/testfc',
  },
  about: [],
  history: [],
  nav: [],
};

const sections: TeamSection[] = [
  { id: 'seniors', name: 'Senior', subtitle: 'Teams', icon: 'fa-shield-alt', teams: [], logo: undefined },
];

const defaultProps = { club, sections, navOpen: false, onNavToggle: vi.fn() };

describe('SiteHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the club name', () => {
    renderWithMantine(<SiteHeader {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByText(/Test/)).toBeTruthy();
  });

  it('shows Login button when user is not authenticated', () => {
    renderWithMantine(<SiteHeader {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByRole('link', { name: /Login/i })).toBeTruthy();
  });

  it('shows user name button when authenticated', () => {
    renderWithMantine(<SiteHeader {...defaultProps} />, { authValue: mockMember });
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('shows social link icons for configured socials', () => {
    renderWithMantine(<SiteHeader {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByLabelText('Facebook')).toBeTruthy();
    expect(screen.getByLabelText('Instagram')).toBeTruthy();
    expect(screen.getByLabelText('Twitter / X')).toBeTruthy();
  });

  it('does not show social links when set to "#"', () => {
    const noSocialsClub = { ...club, socials: { facebook: '#', instagram: '#', twitter: '#' } };
    renderWithMantine(<SiteHeader {...defaultProps} club={noSocialsClub} />, { authValue: mockLoggedOut });
    expect(screen.queryByLabelText('Facebook')).toBeNull();
    expect(screen.queryByLabelText('Instagram')).toBeNull();
    expect(screen.queryByLabelText('Twitter / X')).toBeNull();
  });

  it('shows section badge when a section is active', () => {
    const sectionActive = { ...mockSection, activeSection: 'seniors' };
    renderWithMantine(<SiteHeader {...defaultProps} />, {
      authValue: mockLoggedOut,
      sectionValue: sectionActive,
    });
    expect(screen.getByText(/Senior/)).toBeTruthy();
  });

  it('shows admin menu items when user is admin', async () => {
    renderWithMantine(<SiteHeader {...defaultProps} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    fireEvent.click(screen.getByText('Admin'));
    await waitFor(() => {
      expect(screen.getByText('Site Admin')).toBeTruthy();
      expect(screen.getByText('Manage Users')).toBeTruthy();
    });
  });
});

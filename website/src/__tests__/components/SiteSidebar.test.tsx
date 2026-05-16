import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithMantine, mockLoggedOut, mockAdmin, mockMember, mockSection, mockSingleClub } from '../test-utils';
import type { Club, TeamFeed, TeamSection } from '../../types';

const mockPathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('react-router-dom', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  NavLink: ({ to, label, active, onClick }: { to: string; label: string; active?: boolean; onClick?: () => void }) => (
    <a href={to} data-active={active} onClick={onClick}>{label}</a>
  ),
  useLocation: () => ({ pathname: mockPathname.current }),
}));

const mockSignOut = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../auth-client', () => ({ signOut: mockSignOut }));

import { SiteSidebar } from '../../components/SiteSidebar';

const club: Club = {
  slug: 'test-club',
  name: 'Test FC',
  tagline: 'Play hard',
  founded: 1990,
  email: 'info@testfc.com',
  address: { line1: '1 Lane', line2: 'Town', postcode: 'AB1 2CD' },
  what3words: 'abc.def.ghi',
  socials: { facebook: '#', instagram: '#', twitter: '#' },
  about: [],
  history: [],
  // nav omitted intentionally so DEFAULT_NAV is used
};

const sections: TeamSection[] = [
  { id: 'seniors', name: 'Senior', subtitle: 'Teams', icon: 'fa-shield-alt', teams: [] },
  { id: 'juniors', name: 'Junior', subtitle: 'Teams', icon: 'fa-child', teams: [] },
];

const defaultProps = { club, sections, onNavClick: vi.fn() };

const futureFeed: TeamFeed = {
  team: 'First XI',
  league: 'sunday-league',
  generated: '2026-05-12T00:00:00Z',
  fixtures: [{
    id: 'f1',
    date: '2026-06-01',
    time: '15:00',
    home_team: 'Test FC',
    away_team: 'Rival FC',
    venue: 'Home Ground',
    division: 'Division 1',
    league: 'sunday-league',
  }],
  results: [],
};

describe('SiteSidebar', () => {
  it('renders navigation links from DEFAULT_NAV when club.nav is empty', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('About Us')).toBeTruthy();
    expect(screen.getByText('Teams')).toBeTruthy();
  });

  it('renders section filter buttons when sections are provided', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, {
      authValue: mockLoggedOut,
      sectionValue: mockSection,
    });
    expect(screen.getByRole('button', { name: 'All' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Senior/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Junior/ })).toBeTruthy();
  });

  it('renders club contact info when email is present', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByText('info@testfc.com')).toBeTruthy();
  });

  it('renders club address when present', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.getByText(/1 Lane/)).toBeTruthy();
  });

  it('shows Pitch Schedule link when pitchBookings=true', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} pitchBookings />, { authValue: mockLoggedOut });
    expect(screen.getByText('Pitch Schedule')).toBeTruthy();
  });

  it('does not show Pitch Schedule link when pitchBookings is not set', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.queryByText('Pitch Schedule')).toBeNull();
  });

  it('shows admin links when user is admin', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, {
      authValue: mockAdmin,
      clubValue: mockSingleClub,
    });
    expect(screen.getByText('Customise')).toBeTruthy();
    expect(screen.getByText('Manage Users')).toBeTruthy();
  });

  it('shows My Registrations link for logged-in users', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, {
      authValue: mockMember,
      clubValue: mockSingleClub,
    });
    expect(screen.getByText('My Registrations')).toBeTruthy();
  });

  it('does not show My Registrations when logged out', () => {
    renderWithMantine(<SiteSidebar {...defaultProps} />, { authValue: mockLoggedOut });
    expect(screen.queryByText('My Registrations')).toBeNull();
  });

  it('renders NextTeamFixture when sidebarFeeds contain an upcoming fixture', () => {
    renderWithMantine(
      <SiteSidebar
        {...defaultProps}
        sidebarFeeds={[{ feed: futureFeed, label: 'First XI', sectionId: 'seniors' }]}
      />,
      { authValue: mockLoggedOut },
    );
    // 'Test FC' now appears in both the club hero and the feed home_team —
    // assert via the feed-specific copy that's unique to the fixture card.
    expect(screen.getByText('Rival FC')).toBeTruthy();
    expect(screen.getByText('NEXT FIRST XI')).toBeTruthy();
  });

  it('NextTeamFixture returns nothing when all fixtures are in the past', () => {
    const pastFeed: TeamFeed = {
      ...futureFeed,
      fixtures: [{ ...futureFeed.fixtures[0], date: '2020-01-01' }],
    };
    renderWithMantine(
      <SiteSidebar
        {...defaultProps}
        sidebarFeeds={[{ feed: pastFeed, label: 'First XI', sectionId: 'seniors' }]}
      />,
      { authValue: mockLoggedOut },
    );
    expect(screen.queryByText('Rival FC')).toBeNull();
  });

  it('sidebarFeeds filtered by active section hides non-matching feeds', () => {
    renderWithMantine(
      <SiteSidebar
        {...defaultProps}
        sidebarFeeds={[{ feed: futureFeed, label: 'First XI', sectionId: 'juniors' }]}
      />,
      {
        authValue: mockLoggedOut,
        sectionValue: { activeSection: 'seniors', setActiveSection: vi.fn() },
      },
    );
    // 'Rival FC' only appears inside the (filtered-out) feed card, so it being
    // absent confirms the card itself didn't render.
    expect(screen.queryByText('Rival FC')).toBeNull();
  });

  it('clicking a section button calls setActiveSection with that section id', () => {
    const setActiveSection = vi.fn();
    renderWithMantine(
      <SiteSidebar {...defaultProps} />,
      {
        authValue: mockLoggedOut,
        sectionValue: { activeSection: 'all', setActiveSection },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: /Senior/ }));
    expect(setActiveSection).toHaveBeenCalledWith('seniors');
  });

  it('clicking All button calls setActiveSection with all', () => {
    const setActiveSection = vi.fn();
    renderWithMantine(
      <SiteSidebar {...defaultProps} />,
      {
        authValue: mockLoggedOut,
        sectionValue: { activeSection: 'seniors', setActiveSection },
      },
    );
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(setActiveSection).toHaveBeenCalledWith('all');
  });

  it('hides nav items that are set to false in visibility prop', () => {
    renderWithMantine(
      <SiteSidebar {...defaultProps} visibility={{ '/about': false, '/teams': true }} />,
      { authValue: mockLoggedOut },
    );
    expect(screen.queryByText('About Us')).toBeNull();
    expect(screen.getByText('Teams')).toBeTruthy();
  });

  it('uses custom club.nav when provided instead of DEFAULT_NAV', () => {
    const customClub: Club = {
      ...club,
      nav: [{ to: '/custom', label: 'Custom Page', icon: 'fa-star' }],
    };
    renderWithMantine(
      <SiteSidebar {...defaultProps} club={customClub} />,
      { authValue: mockLoggedOut },
    );
    expect(screen.getByText('Custom Page')).toBeTruthy();
    expect(screen.queryByText('Home')).toBeNull();
  });

  it('shows club shop link when shopUrl is set', () => {
    const shopClub: Club = { ...club, shopUrl: 'https://shop.example.com' };
    renderWithMantine(
      <SiteSidebar {...defaultProps} club={shopClub} />,
      { authValue: mockLoggedOut },
    );
    expect(screen.getByText('Club Shop')).toBeTruthy();
  });

  it('shows Request a Pitch link for managers when pitchBookings=true', () => {
    renderWithMantine(
      <SiteSidebar {...defaultProps} pitchBookings />,
      {
        authValue: mockAdmin,
        clubValue: mockSingleClub,
      },
    );
    expect(screen.getByText('Request a Pitch')).toBeTruthy();
  });

  it('shows Booking Requests admin link when pitchBookings=true and user is admin', () => {
    renderWithMantine(
      <SiteSidebar {...defaultProps} pitchBookings />,
      {
        authValue: mockAdmin,
        clubValue: mockSingleClub,
      },
    );
    expect(screen.getByText('Booking Requests')).toBeTruthy();
  });

  it('renders the user chip with initials when logged in', () => {
    renderWithMantine(
      <SiteSidebar {...defaultProps} />,
      { authValue: mockMember, clubValue: mockSingleClub },
    );
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Signed in')).toBeTruthy();
  });

  it('shows ADMIN badge on the user chip for admin users', () => {
    renderWithMantine(
      <SiteSidebar {...defaultProps} />,
      { authValue: mockAdmin, clubValue: mockSingleClub },
    );
    // "ADMIN" appears twice for an admin: once on the user chip badge, once on
    // the admin section divider. Both confirm the admin branches rendered.
    expect(screen.getAllByText('ADMIN').length).toBeGreaterThanOrEqual(2);
  });

  it('renders Log out button when logged in and calls signOut when clicked', async () => {
    mockSignOut.mockClear();
    // window.location.reload is called after signOut — stub it to a no-op so
    // jsdom doesn't blow up.
    const origLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...origLocation, reload: vi.fn() },
      writable: true,
    });

    renderWithMantine(
      <SiteSidebar {...defaultProps} />,
      { authValue: mockMember, clubValue: mockSingleClub },
    );

    const btn = screen.getByText('Log out');
    fireEvent.mouseEnter(btn);
    fireEvent.mouseLeave(btn);
    fireEvent.click(btn);

    expect(mockSignOut).toHaveBeenCalled();
  });
});

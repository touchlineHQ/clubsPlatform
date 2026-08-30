import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import type { AppData } from '../types';

const renderApp = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>);

const mockLoadClubRegistry = vi.hoisted(() => vi.fn());
const mockLoadAllData = vi.hoisted(() => vi.fn());
vi.mock('../data', () => ({
  loadClubRegistry: mockLoadClubRegistry,
  loadAllData: mockLoadAllData,
}));

vi.mock('react-router-dom', () => ({
  HashRouter: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Routes: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Route: ({ element }: { element: React.ReactNode }) => <>{element}</>,
  Navigate: () => null,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
  NavLink: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useLocation: () => ({ pathname: '/' }),
}));

const ANON_AUTH = {
  user: null as { clubSlug: string | null } | null,
  loading: false,
  isAdmin: false,
  isManager: false,
  isPlatformAdmin: false,
  teamRoles: [] as unknown[],
  refresh: vi.fn(),
};
/** Mutable so a test can sign someone in — the private-club gate keys off it. */
const mockAuth = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockAuth.current,
  AuthContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
}));

vi.mock('../context/SectionContext', () => ({
  SectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SectionContext: { Provider: ({ children }: { children: React.ReactNode }) => <>{children}</> },
  useSection: () => ({ activeSection: 'all', setActiveSection: vi.fn() }),
}));

vi.mock('../components/SiteHeader', () => ({
  SiteHeader: () => <div data-testid="site-header">Header</div>,
}));
vi.mock('../components/SiteSidebar', () => ({
  SiteSidebar: () => <div data-testid="site-sidebar">Sidebar</div>,
}));
vi.mock('../components/ProtectedRoute', () => ({
  ProtectedRoute: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../pages/HomePage', () => ({ HomePage: () => <div data-testid="home-page">Home</div> }));
vi.mock('../pages/LandingPage', () => ({ LandingPage: () => <div data-testid="landing-page">Landing</div> }));
vi.mock('../pages/AboutPage', () => ({ AboutPage: () => <div>About</div> }));
vi.mock('../pages/TeamsPage', () => ({ TeamsPage: () => <div>Teams</div> }));
vi.mock('../pages/TeamPage', () => ({ TeamPage: () => <div>Team</div> }));
vi.mock('../pages/FixturesResultsPage', () => ({ FixturesResultsPage: () => <div>Fixtures</div> }));
vi.mock('../pages/RegisterPage', () => ({ RegisterPage: () => <div>Register</div> }));
vi.mock('../pages/CommitteePage', () => ({ CommitteePage: () => <div>Committee</div> }));
vi.mock('../pages/NewsPage', () => ({ NewsPage: () => <div>News</div> }));
vi.mock('../pages/GalleryPage', () => ({ GalleryPage: () => <div>Gallery</div> }));
vi.mock('../pages/MatchdayPage', () => ({ MatchdayPage: () => <div>Matchday</div> }));
vi.mock('../pages/ContactPage', () => ({ ContactPage: () => <div>Contact</div> }));
vi.mock('../pages/CustomizePage', () => ({ CustomizePage: () => <div>Customise</div> }));
vi.mock('../pages/LoginPage', () => ({ LoginPage: () => <div>Login</div> }));
vi.mock('../pages/SignUpPage', () => ({ SignUpPage: () => <div>SignUp</div> }));
vi.mock('../pages/AdminUsersPage', () => ({ AdminUsersPage: () => <div>AdminUsers</div> }));
vi.mock('../pages/RegistrationsPage', () => ({ RegistrationsPage: () => <div>Registrations</div> }));
vi.mock('../pages/PitchBookingPage', () => ({ PitchBookingPage: () => <div>PitchBooking</div> }));
vi.mock('../pages/BookingAdminPage', () => ({ BookingAdminPage: () => <div>BookingAdmin</div> }));
vi.mock('../pages/PitchSchedulePage', () => ({ PitchSchedulePage: () => <div>PitchSchedule</div> }));
vi.mock('../pages/AdminSecretsPage', () => ({ AdminSecretsPage: () => <div>AdminSecrets</div> }));
vi.mock('../pages/AdminPaymentsPage', () => ({ AdminPaymentsPage: () => <div>AdminPayments</div> }));
vi.mock('../pages/PaymentSuccessPage', () => ({ PaymentSuccessPage: () => <div data-testid="payment-success">PaymentSuccess</div> }));
vi.mock('../pages/PaymentCancelledPage', () => ({ PaymentCancelledPage: () => <div data-testid="payment-cancelled">PaymentCancelled</div> }));

import { App } from '../App';

const minimalClub = {
  slug: 'test-club', name: 'Test FC', tagline: '', founded: 2000,
  email: '', address: { line1: '', line2: '', postcode: '' },
  what3words: '', socials: {}, about: [], history: [],
};

const appData: AppData = {
  club: minimalClub,
  teams: { sections: [] },
  committee: { committee: [] },
  registration: [],
  news: [],
  gallery: [],
  matchday: [],
  clubFeed: null,
  liveTeams: [],
  sidebarFeeds: [],
  visibility: {},
};

const singleClubRegistry = {
  multiClub: false,
  pitchBookings: false,
  clubs: [{ id: 'c1', slug: 'test-club', name: 'Test FC', location: 'Test' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.current = { ...ANON_AUTH };
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash: '', pathname: '/', replace: vi.fn() },
  });
});

describe('App', () => {
  it('shows loader while registry is loading', () => {
    mockLoadClubRegistry.mockReturnValue(new Promise(() => {}));
    renderApp(<App />);
    expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
  });

  it('shows loader while data is loading after registry resolves', async () => {
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    mockLoadAllData.mockReturnValue(new Promise(() => {}));
    renderApp(<App />);
    await waitFor(() => {
      expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
    });
  });

  it('renders full app shell after data loads', async () => {
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('site-header')).toBeTruthy();
    });
    expect(screen.getByTestId('home-page')).toBeTruthy();
  });

  it('shows LandingPage in multi-club mode when no slug is in URL', async () => {
    mockLoadClubRegistry.mockResolvedValue({ multiClub: true, pitchBookings: false, clubs: [] });
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeTruthy();
    });
  });

  it('shows payment success page when hash is /payment-success', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '#/payment-success', pathname: '/' },
    });
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('payment-success')).toBeTruthy();
    });
  });

  it('shows payment cancelled page when hash is /payment-cancelled', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '#/payment-cancelled', pathname: '/' },
    });
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('payment-cancelled')).toBeTruthy();
    });
  });

  it('renders the payment result page without waiting for the club registry', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '#/payment-success', pathname: '/' },
    });
    mockLoadClubRegistry.mockReturnValue(new Promise(() => {}));
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('payment-success')).toBeTruthy();
    });
  });

  it('renders all conditionally-visible routes when visibility is fully set', async () => {
    const allVisibleData: AppData = {
      ...appData,
      visibility: {
        '/about': true, '/teams': true, '/fixtures': true, '/register': true,
        '/committee': true, '/news': true, '/gallery': true, '/matchday': true, '/contact': true,
      },
    };
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    mockLoadAllData.mockResolvedValue(allVisibleData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('site-header')).toBeTruthy();
    });
    expect(screen.getByText('About')).toBeTruthy();
    expect(screen.getByText('Teams')).toBeTruthy();
    expect(screen.getByText('News')).toBeTruthy();
    expect(screen.getByText('Gallery')).toBeTruthy();
  });

  it('extracts club slug from URL path in multi-club mode', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '', pathname: '/test-club/' },
    });
    const multiClubRegistry = {
      multiClub: true, pitchBookings: false,
      clubs: [{ id: 'c1', slug: 'test-club', name: 'Test FC', location: 'Test' }],
    };
    mockLoadClubRegistry.mockResolvedValue(multiClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(mockLoadAllData).toHaveBeenCalledWith('test-club', true);
    });
  });

  it('does not show the private-site banner for a live club', async () => {
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('site-header')).toBeTruthy();
    });
    expect(screen.queryByText(/This site is private/)).toBeNull();
  });

  it('does not show the private-site banner when the registry omits published', async () => {
    // Older /api/clubs payloads carry no published field; those clubs are live.
    mockLoadClubRegistry.mockResolvedValue(singleClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeTruthy();
    });
  });

  it('does not extract slug when URL path does not match any club', async () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { hash: '', pathname: '/unknown-path/' },
    });
    const multiClubRegistry = {
      multiClub: true, pitchBookings: false,
      clubs: [{ id: 'c1', slug: 'test-club', name: 'Test FC', location: 'Test' }],
    };
    mockLoadClubRegistry.mockResolvedValue(multiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('landing-page')).toBeTruthy();
    });
  });
});

describe('App — private club', () => {
  const privateMultiClubRegistry = {
    multiClub: true,
    pitchBookings: false,
    clubs: [{ id: 'c1', slug: 'test-club', name: 'Test FC', published: false }],
  };

  const atClubPath = () => Object.defineProperty(window, 'location', {
    writable: true,
    value: { hash: '', pathname: '/test-club/', replace: vi.fn() },
  });

  it('sends an anonymous visitor to the platform landing page', async () => {
    atClubPath();
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/');
    });
    expect(screen.queryByTestId('site-header')).toBeNull();
  });

  it('never loads the club data for a visitor who cannot see the site', async () => {
    atClubPath();
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalled();
    });
    // GET /api/club answers 404 for them — asking would only hang the loader.
    expect(mockLoadAllData).not.toHaveBeenCalled();
  });

  it('turns away a signed-in member who is not an admin', async () => {
    atClubPath();
    mockAuth.current = { ...ANON_AUTH, user: { clubSlug: 'test-club' } };
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/');
    });
    expect(mockLoadAllData).not.toHaveBeenCalled();
  });

  it('keeps the login page reachable so an admin can sign in', async () => {
    atClubPath();
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByText('Login')).toBeTruthy();
    });
  });

  it('waits for auth to settle before turning anyone away', async () => {
    atClubPath();
    mockAuth.current = { ...ANON_AUTH, loading: true };
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(document.querySelector('.mantine-Loader-root')).toBeTruthy();
    });
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(mockLoadAllData).not.toHaveBeenCalled();
  });

  it("renders the site, with a private banner, for the club's own admin", async () => {
    atClubPath();
    mockAuth.current = { ...ANON_AUTH, isAdmin: true, user: { clubSlug: 'test-club' } };
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('site-header')).toBeTruthy();
    });
    expect(screen.getByText(/This site is private/)).toBeTruthy();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('renders the site for a platform admin', async () => {
    atClubPath();
    mockAuth.current = { ...ANON_AUTH, isAdmin: true, isPlatformAdmin: true, user: { clubSlug: null } };
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    mockLoadAllData.mockResolvedValue(appData);
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('site-header')).toBeTruthy();
    });
  });

  it('turns away an admin of a different club', async () => {
    atClubPath();
    mockAuth.current = { ...ANON_AUTH, isAdmin: true, user: { clubSlug: 'other-club' } };
    mockLoadClubRegistry.mockResolvedValue(privateMultiClubRegistry);
    renderApp(<App />);
    await waitFor(() => {
      expect(window.location.replace).toHaveBeenCalledWith('/');
    });
  });

  it('shows a holding card instead of redirecting in single-club mode', async () => {
    mockLoadClubRegistry.mockResolvedValue({
      multiClub: false,
      pitchBookings: false,
      clubs: [{ id: 'c1', slug: 'test-club', name: 'Test FC', published: false }],
    });
    renderApp(<App />);
    await waitFor(() => {
      expect(screen.getByText('Not live yet')).toBeTruthy();
    });
    // "/" is this club's own site in a single-club fork — redirecting would loop.
    expect(window.location.replace).not.toHaveBeenCalled();
  });
});

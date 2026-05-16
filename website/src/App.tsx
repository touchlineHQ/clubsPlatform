import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AppShell, Center, Loader, MantineProvider } from '@mantine/core';
import { useDisclosure, useMediaQuery } from '@mantine/hooks';
import { loadAllData, loadClubRegistry } from './data';
import type { AppData, ClubEntry } from './types';
import { createClubTheme, createLandingTheme, clubCssVariablesResolver } from './theme';
import { AuthProvider } from './context/AuthContext';
import { ClubContext } from './context/ClubContext';
import { SectionProvider } from './context/SectionContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SiteHeader } from './components/SiteHeader';
import { SiteSidebar } from './components/SiteSidebar';
import { LandingPage } from './pages/LandingPage';
import { HomePage } from './pages/HomePage';
import { AboutPage } from './pages/AboutPage';
import { TeamsPage } from './pages/TeamsPage';
import { RegisterPage } from './pages/RegisterPage';
import { CommitteePage } from './pages/CommitteePage';
import { NewsPage } from './pages/NewsPage';
import { GalleryPage } from './pages/GalleryPage';
import { MatchdayPage } from './pages/MatchdayPage';
import { ContactPage } from './pages/ContactPage';
import { FixturesResultsPage } from './pages/FixturesResultsPage';
import { TeamPage } from './pages/TeamPage';
import { CustomizePage } from './pages/CustomizePage';
import { LoginPage } from './pages/LoginPage';
import { SignUpPage } from './pages/SignUpPage';
import { AdminUsersPage } from './pages/AdminUsersPage';
import { MyRegistrationsPage } from './pages/MyRegistrationsPage';
import { PitchBookingPage } from './pages/PitchBookingPage';
import { BookingAdminPage } from './pages/BookingAdminPage';
import { PitchSchedulePage } from './pages/PitchSchedulePage';
import { AdminSecretsPage } from './pages/AdminSecretsPage';
import { AdminPaymentsPage } from './pages/AdminPaymentsPage';
import { PaymentSuccessPage } from './pages/PaymentSuccessPage';
import { PaymentCancelledPage } from './pages/PaymentCancelledPage';

function NavigationHandler({ onNavigate }: { onNavigate: () => void }) {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    onNavigate();
  }, [pathname, onNavigate]);
  return null;
}

/** Extract the first path segment as a potential club slug, e.g. "/east-leake/" → "east-leake" */
function parseClubSlugFromPath(clubs: ClubEntry[]): string | null {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  if (first && clubs.some(c => c.slug === first)) return first;
  return null;
}

export const App = () => {
  const [registry, setRegistry] = useState<{ multiClub: boolean; pitchBookings: boolean; clubs: ClubEntry[] } | null>(null);
  const [clubSlug, setClubSlug] = useState<string | null>(null);
  const [fetchedData, setFetchedData] = useState<AppData | null>(null);
  const [editingData, setEditingData] = useState<AppData | null>(null);
  const [previewData, setPreviewData] = useState<AppData | null>(null);
  const [opened, { toggle, close }] = useDisclosure();
  const isMobile = useMediaQuery('(max-width: 768px)') ?? false;

  // Lock body scroll while the mobile drawer is open so the page behind
  // doesn't slide around when the user swipes.
  useEffect(() => {
    if (!opened || !isMobile) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = original; };
  }, [opened, isMobile]);

  // Step 1: load club registry to determine single vs multi-club mode
  useEffect(() => {
    loadClubRegistry().then((reg) => {
      setRegistry(reg);

      let slug: string | null = null;
      if (reg.multiClub) {
        slug = parseClubSlugFromPath(reg.clubs);
      } else {
        // Single-club: use the sole registered club
        slug = reg.clubs[0]?.slug ?? null;
      }
      setClubSlug(slug);
    });
  }, []);

  // Step 2: once we have a club slug, load all club data
  useEffect(() => {
    if (!clubSlug || !registry) return;
    loadAllData(clubSlug, registry.multiClub).then(setFetchedData);
  }, [clubSlug, registry]);

  const data = previewData ?? fetchedData;

  useEffect(() => {
    if (data) document.title = data.club.name;
  }, [data]);

  const handleApplyPreview = useCallback((updated: AppData) => {
    setPreviewData(updated);
    setEditingData(updated);
  }, []);

  const handlePrimaryColorSaved = useCallback((color: string | null) => {
    setRegistry(prev => prev ? {
      ...prev,
      clubs: prev.clubs.map(c => c.slug === clubSlug ? { ...c, primaryColor: color } : c),
    } : prev);
  }, [clubSlug]);

  const handleSecondaryColorSaved = useCallback((color: string | null) => {
    setRegistry(prev => prev ? {
      ...prev,
      clubs: prev.clubs.map(c => c.slug === clubSlug ? { ...c, secondaryColor: color } : c),
    } : prev);
  }, [clubSlug]);

  const handleResetPreview = useCallback(() => {
    setPreviewData(null);
    setEditingData(null);
  }, []);

  // Registry not yet loaded
  if (!registry) {
    return (
      <Center h="100vh">
        <Loader size="xl" />
      </Center>
    );
  }

  // Payment result pages are club-agnostic — render them before any club-slug
  // guard so GoCardless redirects (which carry no club slug in the path) work.
  const hashPath = window.location.hash.replace(/^#/, '').split('?')[0];
  if (hashPath === '/payment-success' || hashPath === '/payment-cancelled') {
    return (
      <MantineProvider theme={createLandingTheme()}>
        <HashRouter>
          <Routes>
            <Route path="/payment-success" element={<PaymentSuccessPage />} />
            <Route path="/payment-cancelled" element={<PaymentCancelledPage />} />
          </Routes>
        </HashRouter>
      </MantineProvider>
    );
  }

  // Multi-club platform root: no club in URL path → show landing page
  if (registry.multiClub && !clubSlug) {
    return (
      <MantineProvider theme={createLandingTheme()}>
        <AuthProvider>
          <LandingPage clubs={registry.clubs} />
        </AuthProvider>
      </MantineProvider>
    );
  }

  // Club determined but data not yet loaded
  if (!data || !clubSlug) {
    return (
      <Center h="100vh">
        <Loader size="xl" />
      </Center>
    );
  }

  const registryEntry = registry?.clubs.find(c => c.slug === clubSlug);
  const clubTheme = createClubTheme(
    registryEntry?.primaryColor ?? data.club.primaryColor,
    registryEntry?.secondaryColor ?? data.club.secondaryColor,
  );

  return (
    <ClubContext.Provider value={{ clubSlug, isMultiClub: registry.multiClub, clubs: registry.clubs }}>
    <MantineProvider theme={clubTheme} cssVariablesResolver={clubCssVariablesResolver}>
    <AuthProvider>
    <SectionProvider>
    <HashRouter>
      <NavigationHandler onNavigate={close} />
      <AppShell
        layout="alt"
        header={{ height: 60, collapsed: opened && isMobile }}
        navbar={{ width: 300, breakpoint: 'md', collapsed: { mobile: !opened } }}
        padding="md"
        styles={{ navbar: { background: 'var(--cp-surface)', border: 'none' } }}
      >
        <AppShell.Header>
          <SiteHeader club={data.club} sections={data.teams.sections} navOpen={opened} onNavToggle={toggle} />
        </AppShell.Header>

        <AppShell.Navbar>
          <SiteSidebar
            club={data.club}
            sections={data.teams.sections}
            sidebarFeeds={data.sidebarFeeds}
            onNavClick={close}
            pitchBookings={registry.pitchBookings}
            visibility={data.visibility}
          />
        </AppShell.Navbar>

        <AppShell.Main>
          <Routes>
            <Route path="/" element={<HomePage club={data.club} visibility={data.visibility} />} />

            {data.visibility['/about'] && <Route path="/about" element={<AboutPage club={data.club} />} />}
            {data.visibility['/teams'] && (
              <>
                <Route path="/teams" element={<TeamsPage teams={data.teams} liveTeams={data.liveTeams} />} />
                <Route path="/teams/:league/:teamSlug" element={<TeamPage liveTeams={data.liveTeams} />} />
                <Route path="/teams/:teamSlug" element={<TeamPage liveTeams={data.liveTeams} />} />
              </>
            )}
            {data.visibility['/fixtures'] && <Route path="/fixtures" element={<FixturesResultsPage feed={data.clubFeed} teams={data.teams} liveTeams={data.liveTeams} />} />})
            {data.visibility['/register'] && <Route path="/register" element={<RegisterPage items={data.registration} />} />}
            {data.visibility['/committee'] && <Route path="/committee" element={<CommitteePage committee={data.committee} teams={data.teams} />} />}
            {data.visibility['/news'] && <Route path="/news" element={<NewsPage items={data.news} />} />}
            {data.visibility['/gallery'] && <Route path="/gallery" element={<GalleryPage items={data.gallery} />} />}
            {data.visibility['/matchday'] && <Route path="/matchday" element={<MatchdayPage items={data.matchday} club={data.club} />} />}
            {data.visibility['/contact'] && <Route path="/contact" element={<ContactPage club={data.club} />} />}

            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/my-registrations" element={
              <ProtectedRoute>
                <MyRegistrationsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/users" element={
              <ProtectedRoute requireAdmin>
                <AdminUsersPage liveTeams={data.liveTeams} />
              </ProtectedRoute>
            } />
            <Route path="/customise" element={
              <ProtectedRoute requireAdmin>
                <CustomizePage
                  originalData={fetchedData!}
                  editingData={editingData}
                  onEditingChange={setEditingData}
                  onApplyPreview={handleApplyPreview}
                  onResetPreview={handleResetPreview}
                  previewActive={previewData !== null}
                  onPrimaryColorSaved={handlePrimaryColorSaved}
                  onSecondaryColorSaved={handleSecondaryColorSaved}
                />
              </ProtectedRoute>
            } />
            <Route path="/bookings" element={
              <ProtectedRoute requireManager>
                <PitchBookingPage liveTeams={data.liveTeams} />
              </ProtectedRoute>
            } />
            <Route path="/admin/bookings" element={
              <ProtectedRoute requireAdmin>
                <BookingAdminPage clubFeedSlug={data.club.clubFeedSlug} />
              </ProtectedRoute>
            } />
            <Route path="/admin/import" element={<Navigate to="/my-registrations" replace />} />
            <Route path="/schedule" element={<PitchSchedulePage />} />
            <Route path="/admin/secrets" element={
              <ProtectedRoute requireAdmin>
                <AdminSecretsPage />
              </ProtectedRoute>
            } />
            <Route path="/admin/payments" element={
              <ProtectedRoute requireAdmin>
                <AdminPaymentsPage />
              </ProtectedRoute>
            } />
            <Route path="/payment-success" element={<PaymentSuccessPage />} />
            <Route path="/payment-cancelled" element={<PaymentCancelledPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell.Main>
      </AppShell>
    </HashRouter>
    </SectionProvider>
    </AuthProvider>
    </MantineProvider>
    </ClubContext.Provider>
  );
}

export default App;

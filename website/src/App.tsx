import { useEffect, useState, useCallback } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell, Center, Loader, MantineProvider } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { loadAllData, loadClubRegistry } from './data';
import type { AppData, ClubEntry } from './types';
import { createClubTheme } from './theme';
import { AuthProvider } from './context/AuthContext';
import { ClubContext } from './context/ClubContext';
import { SectionProvider } from './context/SectionContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { SiteHeader } from './components/SiteHeader';
import { SiteSidebar } from './components/SiteSidebar';
import { ClubSelectorPage } from './pages/ClubSelectorPage';
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
import { PitchBookingPage } from './pages/PitchBookingPage';
import { BookingAdminPage } from './pages/BookingAdminPage';
import { PitchSchedulePage } from './pages/PitchSchedulePage';

/** Extract the first path segment as a potential club slug, e.g. "/east-leake/" → "east-leake" */
function parseClubSlugFromPath(clubs: ClubEntry[]): string | null {
  const segments = window.location.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  if (first && clubs.some(c => c.slug === first)) return first;
  return null;
}

const DEMO_SLUG = 'demo';

export default function App() {
  const [registry, setRegistry] = useState<{ multiClub: boolean; clubs: ClubEntry[] } | null>(null);
  const [clubSlug, setClubSlug] = useState<string | null>(null);
  const [fetchedData, setFetchedData] = useState<AppData | null>(null);
  const [editingData, setEditingData] = useState<AppData | null>(null);
  const [previewData, setPreviewData] = useState<AppData | null>(null);
  const [opened, { toggle, close }] = useDisclosure();

  // Step 1: load club registry to determine single vs multi-club mode
  useEffect(() => {
    loadClubRegistry().then((reg) => {
      setRegistry(reg);

      let slug: string | null = null;
      if (reg.multiClub) {
        slug = parseClubSlugFromPath(reg.clubs);

        // If no slug in the URL but only one real (non-demo) club exists,
        // skip the selector and go straight to that club.
        if (!slug) {
          const realClubs = reg.clubs.filter(c => c.slug !== DEMO_SLUG);
          if (realClubs.length === 1) {
            window.location.replace(`/${realClubs[0].slug}/`);
            return;
          }
        }
      } else {
        // Single-club: use the sole registered club
        slug = reg.clubs[0]?.slug ?? null;
      }
      setClubSlug(slug);
    });
  }, []);

  // Step 2: once we have a club slug, load all club data
  useEffect(() => {
    if (!clubSlug) return;
    loadAllData(clubSlug).then(setFetchedData);
  }, [clubSlug]);

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

  // Multi-club platform root: no club in URL path → show selector
  if (registry.multiClub && !clubSlug) {
    return (
      <MantineProvider theme={createClubTheme()}>
        <AuthProvider>
          <ClubSelectorPage clubs={registry.clubs} />
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
  const clubTheme = createClubTheme(registryEntry?.primaryColor ?? data.club.primaryColor);

  return (
    <ClubContext.Provider value={{ clubSlug, isMultiClub: registry.multiClub, clubs: registry.clubs }}>
    <MantineProvider theme={clubTheme}>
    <AuthProvider>
    <SectionProvider>
    <HashRouter>
      <AppShell
        header={{ height: 60 }}
        navbar={{ width: 300, breakpoint: 'md', collapsed: { mobile: !opened } }}
        padding="md"
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
          />
        </AppShell.Navbar>

        <AppShell.Main>
          <Routes>
            <Route path="/" element={<HomePage club={data.club} />} />
            <Route path="/about" element={<AboutPage club={data.club} />} />
            <Route path="/teams" element={<TeamsPage teams={data.teams} liveTeams={data.liveTeams} />} />
            <Route path="/teams/:league/:teamSlug" element={<TeamPage liveTeams={data.liveTeams} />} />
            <Route path="/teams/:teamSlug" element={<TeamPage liveTeams={data.liveTeams} />} />
            <Route path="/fixtures" element={<FixturesResultsPage feed={data.clubFeed} teams={data.teams} liveTeams={data.liveTeams} />} />
            <Route path="/register" element={<RegisterPage items={data.registration} />} />
            <Route path="/committee" element={<CommitteePage committee={data.committee} teams={data.teams} />} />
            <Route path="/news" element={<NewsPage items={data.news} />} />
            <Route path="/gallery" element={<GalleryPage items={data.gallery} />} />
            <Route path="/matchday" element={<MatchdayPage items={data.matchday} club={data.club} />} />
            <Route path="/contact" element={<ContactPage club={data.club} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
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
            <Route path="/schedule" element={<PitchSchedulePage />} />
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

import { useState } from 'react';
import {
  Anchor, Badge, Box, Button, Container, Group, Paper,
  SimpleGrid, Stack, Text, TextInput, PasswordInput, ThemeIcon,
  Title, Alert,
} from '@mantine/core';
import {
  IconBallFootball, IconBrandGithub, IconCalendar, IconCheck,
  IconChevronRight, IconEdit,
  IconExternalLink, IconLogin, IconMail, IconMapPin, IconPlus,
  IconShield, IconUsers,
} from '@tabler/icons-react';
import type { ClubEntry } from '../types';
import { signIn, signUp } from '../auth-client';

const DEMO_SLUG = 'demo';

// ── Colours (match design tokens) ────────────────────────────────────────────
const O5 = '#f07820';
const O6 = '#e96a1a';
const O7 = '#c85510';
const O0 = '#fff4eb';
const O1 = '#ffe8d2';
const G5 = '#22c55e';
const G6 = '#16a34a';
const G1 = '#e6f9ee';
const DARK = '#1a2332';
const DARK2 = '#273347';

// ── Shared nav scroll helper ──────────────────────────────────────────────────
function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────────────────────────────────────
// LandingPage
// ─────────────────────────────────────────────────────────────────────────────
interface LandingPageProps {
  clubs: ClubEntry[];
}

export function LandingPage({ clubs }: LandingPageProps) {
  const [authTab, setAuthTab] = useState<'signup' | 'login'>('signup');

  const handleLoginClick = () => {
    setAuthTab('login');
    setTimeout(() => scrollTo('getstarted'), 50);
  };

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <LandingHeader onLoginClick={handleLoginClick} />
      <HeroSection />
      <ClubDirectorySection clubs={clubs} />
      <FeaturesSection />
      <GetStartedSection authTab={authTab} onTabChange={setAuthTab} />
      <ContactSection />
      <LandingFooter />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LandingHeader
// ─────────────────────────────────────────────────────────────────────────────
function LandingHeader({ onLoginClick }: { onLoginClick: () => void }) {
  return (
    <Box
      component="nav"
      style={{
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        height: 70,
      }}
    >
      <Container size="xl" h="100%">
        <Group h="100%" justify="space-between" wrap="nowrap" gap={0}>
          {/* Brand */}
          <Box component="a" href="#" style={{ flexShrink: 0, marginRight: 32, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/images/logoHQ.png" alt="touchlineHQ" height={40} style={{ display: 'block' }} />
            <Stack gap={0}>
              <Text fw={700} size="sm" lh={1.2} c={G6} style={{ whiteSpace: 'nowrap' }}>clubsPlatform</Text>
              <Text size="xs" c="gray.5" lh={1.2} style={{ fontSize: '0.72rem' }}>by touchlineHQ</Text>
            </Stack>
          </Box>

          {/* Centre nav links — hidden on mobile */}
          <Group gap={2} wrap="nowrap" style={{ flex: 1 }} visibleFrom="md">
            {[
              { label: 'Directory', icon: <IconBallFootball size={14} />, href: '#clubs' },
              { label: 'Features', icon: <IconShield size={14} />, href: '#features' },
              { label: 'Get Started', icon: <IconUsers size={14} />, href: '#getstarted' },
              { label: 'Contact', icon: <IconMail size={14} />, href: '#contact' },
            ].map(({ label, icon, href }) => (
              <Button
                key={label}
                component="a"
                href={href}
                variant="subtle"
                size="compact-sm"
                leftSection={icon}
                color="gray"
                onClick={e => { e.preventDefault(); scrollTo(href.slice(1)); }}
              >
                {label}
              </Button>
            ))}
            <Anchor
              href="https://touchlinehq.co.uk"
              target="_blank"
              rel="noopener"
              c={G6}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '5px 12px', borderRadius: 6,
                fontSize: '0.82rem', fontWeight: 500, textDecoration: 'none',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = G1)}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              touchlineHQ
              <IconExternalLink size={12} />
            </Anchor>
          </Group>

          {/* Right actions */}
          <Group gap={8} style={{ marginLeft: 'auto' }}>
            <Button
              variant="subtle"
              size="compact-sm"
              color="gray"
              leftSection={<IconLogin size={14} />}
              onClick={onLoginClick}
            >
              Log in
            </Button>
            <Button
              component="a"
              href="#getstarted"
              variant="light"
              color="orange"
              size="compact-sm"
              leftSection={<IconBallFootball size={14} />}
              onClick={e => { e.preventDefault(); scrollTo('getstarted'); }}
            >
              Get your club
            </Button>
          </Group>
        </Group>
      </Container>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HeroSection
// ─────────────────────────────────────────────────────────────────────────────
function HeroSection() {
  return (
    <Box
      style={{
        background: `linear-gradient(160deg, var(--mantine-color-gray-0) 0%, ${O0} 100%)`,
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        padding: '80px 24px 72px',
      }}
    >
      <Container size="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={64} style={{ alignItems: 'center' }}>
          {/* Left — copy */}
          <Stack gap="xl">
            <div>
              <Badge color="orange" variant="light" radius="xl" size="sm" mb="lg">
                Grassroots football, online
              </Badge>
              <Title order={1} fw={800} style={{ fontSize: '3.25rem', lineHeight: 1.08, marginBottom: 20, textWrap: 'balance' } as React.CSSProperties}>
                Your club's{' '}
                <span style={{ color: O5 }}>digital home,</span>{' '}
                ready in minutes.
              </Title>
              <Text size="xl" c="dimmed" maw={480} lh={1.65}>
                A fully branded club website with live fixtures, team pages, news, and a built-in admin — powered by the FA Full-Time feed.
              </Text>
            </div>

            <Group gap="sm" wrap="wrap">
              <Button
                size="lg"
                radius="xl"
                color="orange"
                leftSection={<IconUsers size={18} />}
                onClick={() => scrollTo('getstarted')}
                style={{ transition: 'filter 0.15s, transform 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(0.92)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.filter = ''; e.currentTarget.style.transform = ''; }}
              >
                Get your club online
              </Button>
              <Button
                size="lg"
                radius="xl"
                variant="outline"
                color="orange"
                leftSection={<IconBallFootball size={18} />}
                onClick={() => scrollTo('clubs')}
                style={{ transition: 'background 0.15s, transform 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.background = O0; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.transform = ''; }}
              >
                Browse clubs
              </Button>
            </Group>

            <Group gap="xl" mt="xs">
              {[
                { num: 'Live', lbl: 'FA fixture feed' },
                { num: 'Free', lbl: 'Open source' },
                { num: '10 min', lbl: 'To go live' },
              ].map(({ num, lbl }) => (
                <Stack key={lbl} gap={4}>
                  <Text fw={800} size="xl">{num}</Text>
                  <Text size="sm" c="dimmed">{lbl}</Text>
                </Stack>
              ))}
            </Group>
          </Stack>

          {/* Right — visual card */}
          <div style={{ position: 'relative' }}>
            <Paper radius="xl" shadow="lg" withBorder style={{ overflow: 'hidden' }}>
              {/* Dark header */}
              <div style={{
                background: `linear-gradient(135deg, ${DARK} 0%, ${DARK2} 100%)`,
                padding: '20px 24px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <Group gap={10} mb={12}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: O1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <IconBallFootball size={22} color={O5} />
                    </div>
                    <div>
                      <Text fw={800} size="md" c="white" lh={1.2}>Demo FC</Text>
                      <Text size="xs" c="rgba(255,255,255,0.5)">Seniors · Women · Juniors</Text>
                    </div>
                  </Group>
                  <Group gap={6}>
                    <Badge size="xs" color="orange" variant="light">Seniors</Badge>
                    <Badge size="xs" style={{ background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)', border: 'none' }}>Juniors</Badge>
                    <Badge size="xs" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)', border: 'none' }}>Women</Badge>
                  </Group>
                </div>
                <div style={{ width: 52, height: 52, borderRadius: 12, background: 'rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <IconShield size={28} color="rgba(255,255,255,0.7)" stroke={1.5} />
                </div>
              </div>

              {/* Body */}
              <Box p="xl" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <Group justify="space-between" align="center">
                  <Text size="xs" fw={700} c="gray.6" tt="uppercase" style={{ letterSpacing: '0.05em' }}>Upcoming Fixtures</Text>
                  <Group gap={4}>
                    {['All', 'Seniors', 'Juniors'].map((t, i) => (
                      <Box
                        key={t}
                        style={{
                          padding: '4px 12px', borderRadius: 9999,
                          fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                          border: `1.5px solid ${i === 0 ? O5 : 'var(--mantine-color-gray-3)'}`,
                          background: i === 0 ? O5 : 'transparent',
                          color: i === 0 ? '#fff' : 'var(--mantine-color-gray-6)',
                        }}
                      >
                        {t}
                      </Box>
                    ))}
                  </Group>
                </Group>

                {[
                  { teams: 'Demo FC 1st vs Keyworth United', meta: 'Sat 3 May · 14:00' },
                  { teams: 'Demo FC U14 vs Northfield Town U14', meta: 'Sat 3 May · 10:30' },
                  { teams: 'Demo FC Women vs Valley Rangers', meta: 'Sun 4 May · 11:00' },
                ].map(({ teams, meta }) => (
                  <Paper key={teams} withBorder radius="md" p="sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <IconCalendar size={14} color={O5} style={{ flexShrink: 0 }} />
                    <Text size="sm" fw={600} c="gray.8" style={{ flex: 1 }}>{teams}</Text>
                    <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>{meta}</Text>
                  </Paper>
                ))}

                <Box
                  component="a"
                  href="#clubs"
                  onClick={e => { e.preventDefault(); scrollTo('clubs'); }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    padding: 10, background: O0, borderRadius: 10,
                    fontSize: '0.82rem', fontWeight: 700, color: O6, textDecoration: 'none',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = O1)}
                  onMouseLeave={e => (e.currentTarget.style.background = O0)}
                >
                  Browse all clubs
                  <IconChevronRight size={14} />
                </Box>
              </Box>
            </Paper>

            {/* Floating mini-card */}
            <div style={{
              position: 'absolute', bottom: -16, left: -24,
              background: '#fff', borderRadius: 14, padding: '12px 16px',
              boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)',
              border: '1px solid var(--mantine-color-gray-2)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: G1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <IconCheck size={18} color={G6} />
              </div>
              <div style={{ fontSize: '0.8rem' }}>
                <div style={{ fontWeight: 700, color: 'var(--mantine-color-gray-9)' }}>Live FA fixture sync</div>
                <div style={{ color: 'var(--mantine-color-gray-5)' }}>Updates daily, automatically</div>
              </div>
            </div>
          </div>
        </SimpleGrid>
      </Container>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ClubDirectorySection
// ─────────────────────────────────────────────────────────────────────────────
function ClubDirectorySection({ clubs }: { clubs: ClubEntry[] }) {
  const demoClub = clubs.find(c => c.slug === DEMO_SLUG);
  const realClubs = clubs.filter(c => c.slug !== DEMO_SLUG);

  return (
    <Box id="clubs" style={{ background: '#fff', padding: '80px 24px' }}>
      <Container size="xl">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md" mb={48}>
          <div>
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.07em', color: O5, marginBottom: 10 }}>Club directory</Text>
            <Title order={2} fw={800} style={{ fontSize: '2.1rem', marginBottom: 12 }}>Clubs on the platform.</Title>
            <Text size="md" c="dimmed" maw={560}>Every club gets a fully branded site, their own subdomain, and admin access. Browse what's already live.</Text>
          </div>
          <Button color="orange" radius="xl" leftSection={<IconPlus size={14} />} onClick={() => scrollTo('getstarted')}>
            Add your club
          </Button>
        </Group>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {demoClub && (
            <ClubCard
              name={demoClub.name}
              location="Demo Town, Demo County"
              sections={['Seniors', 'Juniors', 'Women']}
              badgeBg={O1}
              badgeEmoji="⚽"
              isDemo
              href={`/${DEMO_SLUG}/`}
            />
          )}
          {realClubs.map(club => (
            <ClubCard
              key={club.slug}
              name={club.name}
              location={club.location}
              sections={[]}
              badgeBg="var(--mantine-color-gray-1)"
              badgeEmoji="🏆"
              href={`/${club.slug}/`}
            />
          ))}

          {/* Add your club dashed card */}
          <AddClubCard onClick={() => scrollTo('getstarted')} />
        </SimpleGrid>
      </Container>
    </Box>
  );
}

interface ClubCardProps {
  name: string;
  location?: string;
  sections: string[];
  badgeBg: string;
  badgeEmoji: string;
  isDemo?: boolean;
  href: string;
  onClick?: () => void;
}

function ClubCard({ name, location, sections, badgeBg, badgeEmoji, isDemo, href, onClick }: ClubCardProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      component="a"
      href={href}
      onClick={onClick ? (e: React.MouseEvent) => { e.preventDefault(); onClick(); } : undefined}
      style={{
        display: 'block', textDecoration: 'none', color: 'inherit',
        border: `${isDemo ? 2 : 1}px solid ${isDemo ? O5 : 'var(--mantine-color-gray-3)'}`,
        borderRadius: 16, overflow: 'hidden',
        boxShadow: hovered ? '0 10px 15px -3px rgba(0,0,0,0.1)' : 'none',
        transform: hovered ? 'translateY(-3px)' : 'none',
        transition: 'box-shadow 0.2s, transform 0.2s',
        cursor: 'pointer',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Top */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--mantine-color-gray-2)',
        background: isDemo ? `linear-gradient(135deg, ${O0} 0%, #fff 100%)` : '#fff',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      }}>
        <Group gap={12} align="flex-start">
          <div style={{ width: 48, height: 48, borderRadius: 10, background: badgeBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem', flexShrink: 0 }}>
            {badgeEmoji}
          </div>
          <div>
            <Group gap={7} mb={3} align="center">
              <Text fw={700} size="md" style={{ color: 'var(--mantine-color-gray-9)' }}>{name}</Text>
              {isDemo && <Badge size="xs" color="orange" variant="light" style={{ fontSize: '0.65rem', padding: '2px 8px' }}>Demo</Badge>}
            </Group>
            {location && (
              <Text size="xs" c="gray.5" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <IconMapPin size={11} />
                {location}
              </Text>
            )}
          </div>
        </Group>
      </div>

      {/* Bottom */}
      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
        <Group gap={5} wrap="wrap">
          {sections.map(s => (
            <Badge key={s} size="sm" variant="light" color="gray">{s}</Badge>
          ))}
        </Group>
        <Text size="xs" fw={600} style={{ color: O5, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 3 }}>
          View site
          <IconChevronRight size={12} style={{ transform: hovered ? 'translateX(3px)' : 'none', transition: 'transform 0.15s' }} />
        </Text>
      </div>
    </Box>
  );
}

function AddClubCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      onClick={onClick}
      style={{
        border: `2px dashed ${hovered ? O5 : 'var(--mantine-color-gray-4)'}`,
        borderRadius: 16, padding: '32px 20px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        cursor: 'pointer',
        background: hovered ? O0 : 'transparent',
        transition: 'border-color 0.2s, background 0.2s',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ width: 48, height: 48, borderRadius: 10, background: hovered ? O1 : 'var(--mantine-color-gray-1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: hovered ? O5 : 'var(--mantine-color-gray-5)', transition: 'background 0.2s, color 0.2s' }}>
        <IconPlus size={22} />
      </div>
      <Text fw={700} style={{ color: hovered ? O6 : 'var(--mantine-color-gray-7)', fontSize: '0.9rem', textAlign: 'center', transition: 'color 0.2s' }}>Add your club</Text>
      <Text size="sm" c="gray.5" ta="center">Get a free site in minutes</Text>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FeaturesSection
// ─────────────────────────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: <IconUsers size={22} />,
    title: 'Team Pages',
    desc: 'A dedicated page for every squad — U6s through to First Team — with manager info, fixtures, and results.',
    points: ['Coach & manager contacts', 'Subscribe to follow a team', 'FA safeguarding compliant'],
  },
  {
    icon: <IconCalendar size={22} />,
    title: 'Live Fixture Sync',
    desc: 'Fixtures and results pulled automatically from FA Full-Time. Google Calendar and iCal integration built in.',
    points: ['Daily automatic updates', 'Google Calendar & iCal sync', 'W/D/L form tracker'],
  },
  {
    icon: <IconEdit size={22} />,
    title: 'Easy Admin',
    desc: 'A simple dashboard for club volunteers. Update news, manage teams, and edit club details — no code needed.',
    points: ['JSON-driven content editing', 'Role-based access (admin / manager)', 'Mobile-friendly'],
  },
  {
    icon: <IconShield size={22} />,
    title: 'Privacy First',
    desc: 'GDPR-compliant by design. No personal player data stored. Scores hidden for younger age groups automatically.',
    points: ['FAN-based references only', 'No personal data stored', 'Scores hidden for U12s & under'],
  },
  {
    icon: <IconBrandGithub size={22} />,
    title: 'Open Source',
    desc: 'Fork it, self-host it, contribute to it. No lock-in, no hidden fees, full data portability.',
    points: ['MIT licensed on GitHub', 'Self-host on Cloudflare Pages', 'touchlineHQ managed option available'],
  },
];

function FeaturesSection() {
  return (
    <Box id="features" style={{ background: DARK, padding: '80px 24px' }}>
      <Container size="xl">
        <div style={{ maxWidth: 560, marginBottom: 48 }}>
          <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.07em', color: O5, marginBottom: 10 }}>What's included</Text>
          <Title order={2} fw={800} c="white" style={{ fontSize: '2.1rem', marginBottom: 12 }}>Everything a grassroots club needs.</Title>
          <Text c="gray.4">Built for volunteers, not developers. No coding, no subscriptions, no lock-in.</Text>
        </div>

        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {FEATURES.map(({ icon, title, desc, points }) => (
            <div key={title} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: '28px 24px' }}>
              <ThemeIcon size={48} radius="lg" style={{ background: `rgba(240,120,32,0.15)`, color: O5, marginBottom: 16 }}>
                {icon}
              </ThemeIcon>
              <Text fw={700} c="white" mb={8}>{title}</Text>
              <Text size="sm" c="gray.4" lh={1.6} mb={16}>{desc}</Text>
              <Stack gap={6}>
                {points.map(p => (
                  <Group key={p} gap={7} align="flex-start">
                    <IconCheck size={12} color={G5} style={{ flexShrink: 0, marginTop: 2 }} />
                    <Text size="xs" c="gray.5">{p}</Text>
                  </Group>
                ))}
              </Stack>
            </div>
          ))}
        </SimpleGrid>
      </Container>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GetStartedSection
// ─────────────────────────────────────────────────────────────────────────────
interface GetStartedProps {
  authTab: 'signup' | 'login';
  onTabChange: (tab: 'signup' | 'login') => void;
}

function GetStartedSection({ authTab, onTabChange }: GetStartedProps) {
  return (
    <Box
      id="getstarted"
      style={{
        background: `linear-gradient(160deg, var(--mantine-color-gray-0) 0%, ${O0} 60%)`,
        borderTop: '1px solid var(--mantine-color-gray-2)',
        padding: '80px 24px',
      }}
    >
      <Container size="xl">
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} style={{ alignItems: 'center' }}>
          {/* Left — copy */}
          <Stack gap="lg">
            <div>
              <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.07em', color: O5, marginBottom: 10 }}>Get started</Text>
              <Title order={2} fw={800} style={{ fontSize: '2rem', marginBottom: 12 }}>
                Your club's site,{' '}
                <span style={{ color: O5 }}>live today.</span>
              </Title>
              <Text c="gray.6">Sign up and you'll have a working club website in under 10 minutes — no coding, no hosting to configure.</Text>
            </div>

            <Stack gap="md">
              {[
                { n: 1, label: 'Create an account', desc: 'Your email and a password — that\'s it.' },
                { n: 2, label: 'Fill in your club details', desc: 'Name, colours, badge, teams — all editable from your browser.' },
                { n: 3, label: 'Go live', desc: 'Your site deploys automatically. Share the link with your players.' },
              ].map(({ n, label, desc }) => (
                <div key={n} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: O5, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>{n}</div>
                  <Stack gap={2}>
                    <Text fw={600} size="sm" lh={1.4}>{label}</Text>
                    <Text size="sm" c="gray.6" lh={1.5}>{desc}</Text>
                  </Stack>
                </div>
              ))}
            </Stack>

            <Paper withBorder radius="md" p="md">
              <Text size="xs" fw={600} c="gray.5" tt="uppercase" style={{ letterSpacing: '0.05em', marginBottom: 6 }}>Need help setting up?</Text>
              <Text size="sm" c="gray.7">
                The{' '}
                <Anchor href="https://touchlinehq.co.uk" target="_blank" c={G6} fw={600}>touchlineHQ team</Anchor>
                {' '}can handle setup, hosting, and ongoing support for your club.
              </Text>
            </Paper>
          </Stack>

          {/* Right — auth card */}
          <AuthCard authTab={authTab} onTabChange={onTabChange} />
        </SimpleGrid>
      </Container>
    </Box>
  );
}

function AuthCard({ authTab, onTabChange }: GetStartedProps) {
  const [clubName, setClubName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? 'Registration failed');
        return;
      }

      const res = await fetch('/api/clubs/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clubName }),
      });
      const data = await res.json() as { ok?: boolean; slug?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to create club');
        return;
      }
      setSuccess('Account created! Taking you to your new club site…');
      setTimeout(() => {
        window.location.replace(`/${data.slug}/`);
      }, 1200);
    } catch {
      setError('Something went wrong — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Login failed');
        return;
      }
      window.location.reload();
    } catch {
      setError('Login failed — please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper shadow="lg" radius="xl" withBorder style={{ overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
        {(['signup', 'login'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { onTabChange(tab); setError(''); setSuccess(''); }}
            style={{
              padding: 16, textAlign: 'center', fontSize: '0.9rem', fontWeight: 700,
              cursor: 'pointer', border: 'none', fontFamily: 'inherit', background: 'transparent',
              color: authTab === tab ? O5 : 'var(--mantine-color-gray-6)',
              backgroundColor: authTab === tab ? O0 : 'transparent',
              borderBottom: authTab === tab ? `2px solid ${O5}` : '2px solid transparent',
              transition: 'background 0.15s',
            }}
          >
            {tab === 'signup' ? 'Create account' : 'Log in'}
          </button>
        ))}
      </div>

      {/* Form body */}
      <Box p={28}>
        {error && <Alert color="red" variant="light" mb="md">{error}</Alert>}
        {success && <Alert color="green" variant="light" mb="md">{success}</Alert>}

        {authTab === 'signup' ? (
          <form onSubmit={handleSignUp}>
            <Stack gap="md">
              <TextInput
                label="Club name"
                placeholder="e.g. Radcliffe Olympic FC"
                required
                value={clubName}
                onChange={e => setClubName(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <TextInput
                label="Your name"
                placeholder="First and last name"
                required
                value={name}
                onChange={e => setName(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <TextInput
                label="Email address"
                type="email"
                placeholder="you@yourclub.co.uk"
                required
                value={email}
                onChange={e => setEmail(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <PasswordInput
                label="Password"
                placeholder="At least 8 characters"
                required
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <Button type="submit" fullWidth color="orange" radius="md" size="md" loading={loading} mt={4}>
                Create my club site →
              </Button>
              <Text size="xs" c="gray.5" ta="center" lh={1.5}>
                By signing up you agree to our{' '}
                <Anchor href="#" size="xs" c={O5}>Terms of Service</Anchor>{' '}and{' '}
                <Anchor href="#" size="xs" c={O5}>Privacy Policy</Anchor>. Zero spam.
              </Text>
            </Stack>
          </form>
        ) : (
          <form onSubmit={handleLogin}>
            <Stack gap="md">
              <TextInput
                label="Email address"
                type="email"
                placeholder="you@yourclub.co.uk"
                required
                value={email}
                onChange={e => setEmail(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <PasswordInput
                label="Password"
                placeholder="Your password"
                required
                value={password}
                onChange={e => setPassword(e.currentTarget.value)}
                styles={{ label: { fontSize: '0.8rem', fontWeight: 600, color: 'var(--mantine-color-gray-8)' } }}
              />
              <Button type="submit" fullWidth color="orange" radius="md" size="md" loading={loading} mt={4}>
                Log in to my club →
              </Button>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--mantine-color-gray-5)', fontSize: '0.8rem' }}>
                <div style={{ flex: 1, height: 1, background: 'var(--mantine-color-gray-2)' }} />
                or
                <div style={{ flex: 1, height: 1, background: 'var(--mantine-color-gray-2)' }} />
              </div>
              <Text size="xs" c="gray.5" ta="center" lh={1.5}>
                <Anchor href="#" size="xs" c={O5}>Forgot your password?</Anchor>
                {' · '}
                Don't have an account?{' '}
                <Anchor href="#" size="xs" c={O5} onClick={e => { e.preventDefault(); onTabChange('signup'); }}>Sign up free</Anchor>
              </Text>
            </Stack>
          </form>
        )}
      </Box>
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactSection
// ─────────────────────────────────────────────────────────────────────────────
function ContactSection() {
  return (
    <Box id="contact" style={{ background: `linear-gradient(135deg, ${DARK} 0%, ${DARK2} 100%)`, padding: '80px 24px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto', textAlign: 'center' }}>
        <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.07em', color: G5, marginBottom: 10 }}>Get in touch</Text>
        <Title order={2} fw={800} c="white" style={{ fontSize: '2.1rem', marginBottom: 12 }}>Need help or something bespoke?</Title>
        <Text c="gray.4" mb={36} style={{ margin: '0 auto 36px' }}>
          The touchlineHQ team can handle everything — setup, hosting, FA feed integration, custom features, and ongoing support. Drop us a line and we'll get back to you quickly.
        </Text>

        <div style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 20, padding: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <Button
            component="a"
            href="mailto:hello@touchlinehq.co.uk"
            size="lg"
            radius="xl"
            color="orange"
            leftSection={<IconMail size={18} />}
            style={{ transition: 'filter 0.15s', fontSize: '1rem' }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(0.92)')}
            onMouseLeave={e => (e.currentTarget.style.filter = '')}
          >
            hello@touchlinehq.co.uk
          </Button>
          <Text size="sm" style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center', maxWidth: 400 }}>
            We typically reply within one working day. Tell us your club name, how many teams you have, and what you're looking for.
          </Text>
          <Group gap="xs" align="center">
            <Anchor href="https://touchlinehq.co.uk" target="_blank" rel="noopener" size="sm" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}>touchlineHQ.co.uk</Anchor>
            <Text size="sm" style={{ color: 'rgba(255,255,255,0.2)' }}>·</Text>
            <Anchor href="https://github.com/touchlineHQ" target="_blank" rel="noopener" size="sm" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}>GitHub</Anchor>
            <Text size="sm" style={{ color: 'rgba(255,255,255,0.2)' }}>·</Text>
            <Anchor href="https://github.com/touchlineHQ/clubsPlatform" target="_blank" rel="noopener" size="sm" style={{ color: 'rgba(255,255,255,0.5)', textDecoration: 'none' }} onMouseEnter={e => (e.currentTarget.style.color = '#fff')} onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}>clubsPlatform repo</Anchor>
          </Group>
        </div>
      </div>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LandingFooter
// ─────────────────────────────────────────────────────────────────────────────
function LandingFooter() {
  return (
    <Box
      component="footer"
      style={{
        background: 'var(--mantine-color-gray-9)',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        padding: '28px 24px',
      }}
    >
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        {/* Brand */}
        <Box component="a" href="#" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: O5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconBallFootball size={14} color="#fff" />
          </div>
          <Text fw={700} size="sm" c="white">
            clubs<span style={{ color: O5 }}>Platform</span>
          </Text>
        </Box>

        <Text size="xs" c="gray.5">© {new Date().getFullYear()} touchlineHQ. Made in the UK.</Text>

        <Group gap={16}>
          <Anchor href="https://touchlinehq.co.uk" target="_blank" size="xs" style={{ color: G5, textDecoration: 'none', transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = G6)} onMouseLeave={e => (e.currentTarget.style.color = G5)}>touchlineHQ.co.uk ↗</Anchor>
          <Anchor href="https://github.com/touchlineHQ/clubsPlatform" target="_blank" size="xs" c="gray.5" style={{ textDecoration: 'none' }}>GitHub</Anchor>
          <Anchor href="#" size="xs" c="gray.5" style={{ textDecoration: 'none' }}>Privacy</Anchor>
        </Group>
      </div>
    </Box>
  );
}

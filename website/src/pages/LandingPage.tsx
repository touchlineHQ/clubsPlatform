import { useState } from 'react';
import {
  Anchor, Badge, Box, Button, Container, Group, Paper,
  SimpleGrid, Stack, Text, TextInput, PasswordInput,
  Title, Alert,
} from '@mantine/core';
import {
  IconBallFootball, IconCalendar, IconCheck, IconChevronRight,
  IconExternalLink, IconMail, IconMapPin, IconPlus,
  IconShield, IconUsers,
} from '@tabler/icons-react';
import type { ClubEntry } from '../types';
import { signUp } from '../auth-client';

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
const scrollTo = (id: string) => {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─────────────────────────────────────────────────────────────────────────────
// LandingPage
// ─────────────────────────────────────────────────────────────────────────────
interface LandingPageProps {
  clubs: ClubEntry[];
}

export const LandingPage = ({ clubs }: LandingPageProps) => (
  <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
    <LandingHeader />
    <HeroSection />
    <ClubDirectorySection clubs={clubs} />
    <GetStartedSection />
    <ContactSection />
    <LandingFooter />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// LandingHeader
// ─────────────────────────────────────────────────────────────────────────────
const LandingHeader = () => (
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
        <Group gap={8} wrap="nowrap" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <Button
            component="a"
            href="#getstarted"
            variant="light"
            color="orange"
            size="compact-sm"
            leftSection={<IconBallFootball size={14} />}
            onClick={e => { e.preventDefault(); scrollTo('getstarted'); }}
            visibleFrom="xs"
          >
            Create your club
          </Button>
        </Group>
      </Group>
    </Container>
  </Box>
);

// ─────────────────────────────────────────────────────────────────────────────
// HeroSection
// ─────────────────────────────────────────────────────────────────────────────
const HeroSection = () => (
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
              Get Your Club Online
            </Button>
            <Button
              component="a" 
              href={`/${DEMO_SLUG}/`}
              target="_blank"
              rel="noopener noreferrer"
              size="lg"
              radius="xl"
              variant="outline"
              color="orange"
              leftSection={<IconBallFootball size={18} />}
              style={{ transition: 'background 0.15s, transform 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = O0; e.currentTarget.style.transform = 'translateY(-1px)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.transform = ''; }}
            >
              View Demo Club
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

// ─────────────────────────────────────────────────────────────────────────────
// ClubDirectorySection
// ─────────────────────────────────────────────────────────────────────────────
const ClubDirectorySection = ({ clubs }: { clubs: ClubEntry[] }) => {
  const demoClub = clubs.find(c => c.slug === DEMO_SLUG);
  const realClubs = clubs.filter(c => c.slug !== DEMO_SLUG);

  return (
    <Box id="clubs" style={{ background: '#fff', padding: '80px 24px' }}>
      <Container size="xl">
        <Group justify="space-between" align="flex-end" wrap="wrap" gap="md" mb={48}>
          <div>
            <Text size="xs" fw={700} tt="uppercase" style={{ letterSpacing: '0.07em', color: O5, marginBottom: 10 }}>Club directory</Text>
            <Title order={2} fw={800} style={{ fontSize: '2.1rem', marginBottom: 12 }}>Clubs on the platform.</Title>
            <Text size="md" c="dimmed" maw={560}>Every club gets a fully branded site, their own space, and admin access. Browse what's already live.</Text>
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
          {/* TODO: Add featured clubs functionality so only a select few are displayed on the homepage
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
          ))} */}

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

const ClubCard = ({ name, location, sections, badgeBg, badgeEmoji, isDemo, href, onClick }: ClubCardProps) => {
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

const AddClubCard = ({ onClick }: { onClick: () => void }) => {
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
// GetStartedSection
// ─────────────────────────────────────────────────────────────────────────────
const GetStartedSection = () => (
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

        {/* Left — auth card */}
        <AuthCard />
      </SimpleGrid>
    </Container>
  </Box>
);

const AuthCard = () => {
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

  return (
    <Paper shadow="lg" radius="xl" withBorder style={{ overflow: 'hidden' }}>
      {/* Form body */}
      <Box p={28}>
        {error && <Alert color="red" variant="light" mb="md">{error}</Alert>}
        {success && <Alert color="green" variant="light" mb="md">{success}</Alert>}

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
          </Stack>
        </form>
      </Box>
    </Paper>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ContactSection
// ─────────────────────────────────────────────────────────────────────────────
const ContactSection = () => {
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
            href={`mailto:hello@touchlinehq.co.uk?subject=Setup%20Request`}
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
          <Text size="sm" style={{ color: 'rgba(255,255,255,0.55)', textAlign: 'center', maxWidth: 450 }}>
            We typically reply within one working day. Tell us your club name, how many teams you have, and what you're looking for.
          </Text>
        </div>
      </div>
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LandingFooter
// ─────────────────────────────────────────────────────────────────────────────
const LandingFooter = () => (
  <Box
    component="footer"
    style={{
      background: 'var(--mantine-color-gray-9)',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      padding: '28px 24px',
    }}
  >
    <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      {/* Brand */}
      <Box component="a" href="#" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, margin: 'auto' }}>
        <div style={{ width: 28, height: 28, borderRadius: 7, background: O5, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <IconBallFootball size={14} color="#fff" />
        </div>
        <Text fw={700} size="sm" c="white">
          clubs<span style={{ color: O5 }}>Platform</span>
        </Text>
      </Box>

      <Text size="xs" c="gray.5" m="auto">© {new Date().getFullYear()} touchlineHQ. Made in the UK.</Text>

      <Group gap={16} wrap="nowrap" style={{ flexShrink: 0, margin: 'auto' }}>
        <Anchor href="https://touchlinehq.co.uk" target="_blank" size="xs" style={{ color: G5, textDecoration: 'none', transition: 'color 0.15s' }} onMouseEnter={e => (e.currentTarget.style.color = G6)} onMouseLeave={e => (e.currentTarget.style.color = G5)}>touchlineHQ.co.uk ↗</Anchor>
      </Group>
    </div>
  </Box>
);

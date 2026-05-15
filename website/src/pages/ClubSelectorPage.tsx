import { useMemo, useState } from 'react';
import {
  Title, Text, SimpleGrid, Paper, Stack, Group, Image, Center, Loader,
  TextInput, PasswordInput, Badge, Button, Modal, Alert, Container, Box,
} from '@mantine/core';
import { IconPlus, IconSearch, IconArrowRight } from '@tabler/icons-react';
import type { ClubEntry } from '../types';
import { useAuth } from '../context/AuthContext';
import { signIn, signOut } from '../auth-client';
import { HeroBanner } from '../components/club/HeroBanner';
import { clubDesign } from '../theme';

const DEMO_SLUG = 'demo';

interface Props {
  clubs: ClubEntry[];
  loading?: boolean;
}

export function ClubSelectorPage({ clubs, loading }: Props) {
  const { isPlatformAdmin, user, loading: authLoading, refresh } = useAuth();
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);

  const realClubs = useMemo(() => clubs.filter(c => c.slug !== DEMO_SLUG), [clubs]);
  const demoClub = useMemo(() => clubs.find(c => c.slug === DEMO_SLUG), [clubs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return realClubs;
    return realClubs.filter(c =>
      c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
    );
  }, [realClubs, search]);

  const handleSignOut = async () => {
    await signOut();
    await refresh();
  };

  if (loading) {
    return (
      <Center h="60vh">
        <Loader size="xl" />
      </Center>
    );
  }

  const noRealClubs = realClubs.length === 0;

  return (
    <Container size="lg" py="lg">
      <Stack gap="lg">
        {/* Dark gradient hero — matches the design system used across club pages */}
        <HeroBanner padding={32}>
          <Group justify="space-between" align="center" wrap="wrap" gap="md">
            <Stack gap={6} style={{ flex: 1, minWidth: 240 }}>
              <Text
                size="xs"
                fw={700}
                c="var(--mantine-primary-color-filled)"
                style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
              >
                touchlineHQ
              </Text>
              <Title order={1} ff={clubDesign.font.heading} fw={800} c="#fff" fz={{ base: 26, sm: 34 }} lh={1.1}>
                Touchline Clubs Platform
              </Title>
              <Text c="rgba(255,255,255,0.65)" size="md">
                Powering grassroots football clubs across the country
              </Text>
            </Stack>

            {!authLoading && (
              user ? (
                <Group gap="xs">
                  <Text size="sm" c="rgba(255,255,255,0.65)">Signed in as {user.name}</Text>
                  <Button variant="white" color="dark" size="xs" radius="xl" onClick={handleSignOut}>
                    Sign out
                  </Button>
                </Group>
              ) : (
                <Button variant="white" color="dark" size="sm" radius="xl" onClick={() => setLoginOpen(true)}>
                  Sign in
                </Button>
              )
            )}
          </Group>
        </HeroBanner>

        {/* CTAs */}
        {(demoClub || isPlatformAdmin) && (
          <Group>
            {demoClub && (
              <Button
                component="a"
                href={`/${demoClub.slug}/`}
                variant="light"
                size="md"
                radius="xl"
                rightSection={<IconArrowRight size={14} />}
              >
                Try the demo
              </Button>
            )}
            {isPlatformAdmin && (
              <Button
                onClick={() => setCreateOpen(true)}
                size="md"
                radius="xl"
                leftSection={<IconPlus size={14} />}
              >
                Create new club
              </Button>
            )}
          </Group>
        )}

        {/* Clubs section */}
        <Stack gap="md">
          <Group justify="space-between" align="baseline">
            <Title order={3} ff={clubDesign.font.heading} fw={800}>Clubs</Title>
            {!noRealClubs && (
              <Text size="sm" c="dimmed">
                {filtered.length} {filtered.length === 1 ? 'club' : 'clubs'}
              </Text>
            )}
          </Group>

          {noRealClubs ? (
            <Paper
              p="xl"
              radius="md"
              withBorder
              ta="center"
              style={{
                background: clubDesign.color.n1,
                borderStyle: 'dashed',
              }}
            >
              <Stack gap="sm" align="center">
                <Text fw={700} ff={clubDesign.font.heading} size="lg">No clubs yet</Text>
                <Text c="dimmed" size="sm" maw={400}>
                  {user
                    ? isPlatformAdmin
                      ? 'Create your first club using the button above.'
                      : 'No clubs have been added to this platform yet.'
                    : 'Sign in as a platform admin to create and manage clubs.'}
                </Text>
                {!user && (
                  <Button variant="light" size="sm" radius="xl" mt="xs" onClick={() => setLoginOpen(true)}>
                    Sign in
                  </Button>
                )}
              </Stack>
            </Paper>
          ) : (
            <>
              <TextInput
                placeholder="Search by name or slug..."
                value={search}
                onChange={e => setSearch(e.currentTarget.value)}
                size="md"
                radius="md"
                leftSection={<IconSearch size={16} />}
              />
              {filtered.length === 0 ? (
                <Paper p="xl" radius="md" withBorder ta="center">
                  <Text c="dimmed">No clubs match "{search}"</Text>
                </Paper>
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
                  {filtered.map((club) => (
                    <ClubCard key={club.slug} club={club} />
                  ))}
                </SimpleGrid>
              )}
            </>
          )}
        </Stack>
      </Stack>

      <CreateClubModal opened={createOpen} onClose={() => setCreateOpen(false)} />
      <LoginModal opened={loginOpen} onClose={() => setLoginOpen(false)} onSuccess={refresh} />
    </Container>
  );
}

function ClubCard({ club, isDemo }: { club: ClubEntry; isDemo?: boolean }) {
  return (
    <Paper
      component="a"
      href={`/${club.slug}/`}
      p="lg"
      radius="md"
      withBorder
      style={{
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.08)';
        e.currentTarget.style.borderColor = 'var(--mantine-primary-color-filled)';
        e.currentTarget.style.transform = 'translateY(-2px)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.boxShadow = '';
        e.currentTarget.style.borderColor = '';
        e.currentTarget.style.transform = '';
      }}
    >
      <Group gap="md" align="center" wrap="nowrap">
        {club.badge ? (
          <Box
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: clubDesign.color.n1,
              padding: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Image src={club.badge} alt={club.name} fit="contain" />
          </Box>
        ) : (
          <Center
            w={56}
            h={56}
            style={{
              borderRadius: 12,
              background: club.primaryColor ?? 'var(--mantine-primary-color-filled)',
              color: 'white',
              fontWeight: 800,
              fontSize: 22,
              fontFamily: clubDesign.font.heading,
              flexShrink: 0,
            }}
          >
            {club.name.charAt(0)}
          </Center>
        )}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={800} ff={clubDesign.font.heading} size="lg" truncate>{club.name}</Text>
            {isDemo && <Badge variant="light" color="gray" size="sm" radius="xl">Demo</Badge>}
          </Group>
          <Text size="sm" c="dimmed">{club.slug}</Text>
        </Stack>
      </Group>
    </Paper>
  );
}

interface LoginModalProps {
  opened: boolean;
  onClose: () => void;
  onSuccess: () => Promise<unknown>;
}

function LoginModal({ opened, onClose, onSuccess }: LoginModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await signIn.email({ email, password });
      if (result.error) {
        setError(result.error.message ?? 'Login failed');
      } else {
        await onSuccess();
        onClose();
      }
    } catch {
      setError('Login failed — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Sign in" size="sm" radius="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Email"
            type="email"
            required
            radius="md"
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            required
            radius="md"
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
          />
          {error && <Alert color="red" radius="md">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="subtle" radius="xl" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" radius="xl" loading={submitting}>Sign in</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

interface CreateClubModalProps {
  opened: boolean;
  onClose: () => void;
}

function CreateClubModal({ opened, onClose }: CreateClubModalProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/clubs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim().toLowerCase(), name: name.trim() }),
      });

      const data = await res.json() as { ok?: boolean; slug?: string; error?: string };

      if (!res.ok) {
        setError(data.error ?? `Request failed: ${res.status}`);
        return;
      }

      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create new club" size="md" radius="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          <Text size="sm" c="dimmed">
            A new club will be created with empty content. You can populate teams, news,
            committee and other content from the customise screen after creation.
          </Text>

          <TextInput
            label="Club slug"
            description="Used in the URL (e.g. /your-club/). Lowercase letters, numbers and hyphens only."
            placeholder="your-club"
            radius="md"
            value={slug}
            onChange={e => setSlug(e.currentTarget.value)}
            required
          />

          <TextInput
            label="Club name"
            placeholder="Your Club FC"
            radius="md"
            value={name}
            onChange={e => setName(e.currentTarget.value)}
            required
          />

          {error && (
            <Alert color="red" radius="md" title="Could not create club">
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" radius="xl" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" radius="xl" loading={submitting}>Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

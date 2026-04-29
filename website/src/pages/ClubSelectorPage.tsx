import { useMemo, useState } from 'react';
import {
  Title, Text, SimpleGrid, Paper, Stack, Group, Image, Center, Loader,
  TextInput, PasswordInput, Badge, Button, Modal, Alert, Container,
} from '@mantine/core';
import type { ClubEntry } from '../types';
import { useAuth } from '../context/AuthContext';
import { signIn, signOut } from '../auth-client';

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

  return (
    <Container size="lg" py="xl">
      <Stack gap="xl">
        {/* Page header row */}
        <Group justify="space-between" align="flex-start">
          <Stack gap="xs" style={{ flex: 1 }}>
            <Title order={1}>Touchline Clubs Platform</Title>
            <Text c="dimmed" size="lg">
              One platform powering grassroots football clubs across the country.
              Pick a club below, try the demo, or create your own.
            </Text>
          </Stack>

          {/* Auth controls */}
          {!authLoading && (
            user ? (
              <Group gap="xs" mt={4}>
                <Text size="sm" c="dimmed">Signed in as {user.name}</Text>
                <Button variant="subtle" size="xs" onClick={handleSignOut}>Sign out</Button>
              </Group>
            ) : (
              <Button variant="subtle" size="sm" mt={4} onClick={() => setLoginOpen(true)}>
                Sign in
              </Button>
            )
          )}
        </Group>

        {/* Top CTAs: demo + (admin) create */}
        <Group>
          {demoClub && (
            <Button
              component="a"
              href={`/${demoClub.slug}/`}
              variant="light"
              size="md"
            >
              View demo club
            </Button>
          )}
          {isPlatformAdmin && (
            <Button onClick={() => setCreateOpen(true)} size="md">
              Create new club
            </Button>
          )}
        </Group>

        {/* Search + grid */}
        <Stack gap="md">
          <Group justify="space-between" align="end">
            <Title order={3}>Browse clubs</Title>
            <Text size="sm" c="dimmed">
              {filtered.length} {filtered.length === 1 ? 'club' : 'clubs'}
            </Text>
          </Group>

          <TextInput
            placeholder="Search by name or slug..."
            value={search}
            onChange={e => setSearch(e.currentTarget.value)}
            size="md"
          />

          {filtered.length === 0 ? (
            <Paper p="xl" withBorder ta="center">
              <Text c="dimmed">
                {search ? `No clubs match "${search}"` : 'No clubs have been created yet.'}
              </Text>
            </Paper>
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
              {filtered.map((club) => (
                <ClubCard key={club.slug} club={club} />
              ))}
            </SimpleGrid>
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
      p="xl"
      radius="md"
      withBorder
      style={{
        textDecoration: 'none',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s ease',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--mantine-shadow-md)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '')}
    >
      <Group gap="md" align="center">
        {club.badge ? (
          <Image src={club.badge} alt={club.name} w={48} h={48} fit="contain" />
        ) : (
          <Center
            w={48}
            h={48}
            style={{
              borderRadius: '50%',
              background: club.primaryColor ?? 'var(--mantine-primary-color-filled)',
              color: 'white',
              fontWeight: 700,
              fontSize: 20,
              flexShrink: 0,
            }}
          >
            {club.name.charAt(0)}
          </Center>
        )}
        <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
          <Group gap="xs" wrap="nowrap">
            <Text fw={600} size="lg" truncate>{club.name}</Text>
            {isDemo && <Badge variant="light" color="gray" size="sm">Demo</Badge>}
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
  onSuccess: () => Promise<void>;
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
    <Modal opened={opened} onClose={onClose} title="Sign in" size="sm">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Email"
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            required
            value={password}
            onChange={e => setPassword(e.currentTarget.value)}
          />
          {error && <Alert color="red">{error}</Alert>}
          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting}>Sign in</Button>
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

      // Reload the page so the new club appears in the registry
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Create new club" size="md">
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
            value={slug}
            onChange={e => setSlug(e.currentTarget.value)}
            required
          />

          <TextInput
            label="Club name"
            placeholder="Your Club FC"
            value={name}
            onChange={e => setName(e.currentTarget.value)}
            required
          />

          {error && (
            <Alert color="red" title="Could not create club">
              {error}
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" loading={submitting}>Create</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

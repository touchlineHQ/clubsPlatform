import { Title, Text, Button, Group, SimpleGrid, Paper, ThemeIcon, Stack, Image } from '@mantine/core';
import { Link } from 'react-router-dom';
import type { Club } from '../types';
import { tablerIcon } from '../utils/icons';
import { useAuth } from '../context/AuthContext';

interface Props { club: Club }

export function HomePage({ club }: Props) {
  const { user, loading, teamRoles } = useAuth();
  const hasAbout = club.about && club.about.length > 0;
  const hasHistory = club.history && club.history.length > 0;

  return (
    <Stack gap="xl">
      {/* Banner */}
      <Paper p="xl" radius="md" withBorder>
        <Group justify="space-between" align="center" wrap="wrap" gap="xl">
          <Stack gap="md" style={{ flex: 1, minWidth: 200 }}>
            <div>
              <Title order={1} c="var(--mantine-primary-color-filled)">{club.name}</Title>
              {club.tagline && <Text size="lg" c="dimmed">{club.tagline}</Text>}
            </div>
            {club.homeBanner && (
              <Text dangerouslySetInnerHTML={{ __html: club.homeBanner }} />
            )}
            <Group>
              <Button component={Link} to="/about" variant="outline">
                About Us
              </Button>
              <Button component={Link} to="/register">
                Register &amp; Pay
              </Button>
            </Group>
          </Stack>
          {club.badge && (
            <Image src={club.badge} alt={`${club.name} Badge`} w={160} h={160} fit="contain" />
          )}
        </Group>
      </Paper>

      {/* My Teams — shown to logged-in users with team assignments */}
      {!loading && user && teamRoles.length > 0 && (
        <div>
          <Title order={2} mb="md">My Teams</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {teamRoles.map(t => (
              <Paper key={t.id} p="md" radius="md" withBorder>
                <Group justify="space-between" mb={4}>
                  <Text fw={600}>{t.teamName}</Text>
                </Group>
                <Group gap="xs" mt="sm">
                  <Button component={Link} to={`/teams/${t.teamLeague}/${t.teamSlug}`} size="xs" variant="light">
                    Fixtures &amp; Results
                  </Button>
                  {t.role !== 'subscriber' && (
                    <Button component={Link} to="/bookings" size="xs" variant="outline">
                      Book Pitch
                    </Button>
                  )}
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </div>
      )}

      {/* Who We Are */}
      {hasAbout && (
        <div>
          <Title order={2} mb="md">Who We Are</Title>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {club.about.map((item, i) => (
              <Paper key={i} p="md" radius="md" withBorder>
                <Group align="flex-start" gap="md" wrap="nowrap">
                  <ThemeIcon variant="light" size="lg" radius="md">
                    {tablerIcon(item.icon)}
                  </ThemeIcon>
                  <div>
                    <Text fw={600} mb={4}>{item.title}</Text>
                    <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: item.text }} />
                  </div>
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
          {hasHistory && (
            <Group mt="md">
              <Button component={Link} to="/about" variant="outline">
                Read Our Full Story
              </Button>
            </Group>
          )}
        </div>
      )}
    </Stack>
  );
}

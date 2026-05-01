import { Title, Text, Button, Group, SimpleGrid, Paper, ThemeIcon, Stack, Image, Box, Badge } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import type { Club } from '../types';
import { tablerIcon } from '../utils/icons';
import { useAuth } from '../context/AuthContext';
import { HeroBanner } from '../components/club/HeroBanner';
import { StatTileRow } from '../components/club/StatTile';
import { clubDesign } from '../theme';

interface Props { club: Club }

export function HomePage({ club }: Props) {
  const { user, loading, teamRoles } = useAuth();
  const hasAbout = club.about && club.about.length > 0;
  const hasHistory = club.history && club.history.length > 0;
  const yearsRunning = club.founded ? new Date().getFullYear() - club.founded : null;

  const stats: { value: string; label: string }[] = [];
  if (club.founded) stats.push({ value: String(club.founded), label: 'Founded' });
  if (yearsRunning != null && yearsRunning > 0) stats.push({ value: `${yearsRunning}+`, label: 'Years running' });
  if (hasAbout) stats.push({ value: String(club.about.length), label: 'Club values' });
  if (club.colours) stats.push({ value: club.colours, label: 'Club colours' });

  return (
    <Stack gap="lg">
      {/* Dark gradient hero with crest, name, tagline and primary CTAs */}
      <HeroBanner padding={32}>
        <Group justify="space-between" align="center" wrap="wrap" gap="xl">
          <Stack gap="md" style={{ flex: 1, minWidth: 240 }}>
            <Text
              size="xs"
              fw={700}
              c="var(--mantine-primary-color-filled)"
              style={{ letterSpacing: '0.12em', textTransform: 'uppercase' }}
            >
              Welcome
            </Text>
            <Title
              order={1}
              ff={clubDesign.font.heading}
              fw={800}
              c="#fff"
              fz={{ base: 30, sm: 40 }}
              lh={1.05}
            >
              {club.name}
            </Title>
            {club.tagline && (
              <Text c="rgba(255,255,255,0.65)" size="md" maw={520}>
                {club.tagline}
              </Text>
            )}
            {club.homeBanner && (
              <Text
                c="rgba(255,255,255,0.65)"
                size="sm"
                maw={520}
                dangerouslySetInnerHTML={{ __html: club.homeBanner }}
              />
            )}
            <Group gap="xs" mt={4}>
              <Button component={Link} to="/about" variant="white" color="dark" radius="xl" size="sm">
                About Us
              </Button>
              <Button
                component={Link}
                to="/register"
                radius="xl"
                size="sm"
                rightSection={<IconArrowRight size={14} />}
              >
                Register &amp; Pay
              </Button>
            </Group>
          </Stack>
          {club.badge && (
            <Box
              style={{
                width: 160,
                height: 160,
                borderRadius: 18,
                background: 'rgba(255,255,255,0.08)',
                padding: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Image src={club.badge} alt={`${club.name} Badge`} fit="contain" />
            </Box>
          )}
        </Group>
      </HeroBanner>

      {/* Quick stats — only shown when we have at least two facts to surface */}
      {stats.length >= 2 && <StatTileRow items={stats.slice(0, 4)} />}

      {/* My Teams — shown to logged-in users with team assignments */}
      {!loading && user && teamRoles.length > 0 && (
        <Box>
          <Group justify="space-between" align="baseline" mb="sm">
            <Title order={3} ff={clubDesign.font.heading} fw={800}>My Teams</Title>
            <Badge variant="light" radius="xl">{teamRoles.length}</Badge>
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {teamRoles.map(t => (
              <Paper key={t.id} p="md" radius="md" withBorder>
                <Group justify="space-between" mb={4} wrap="nowrap">
                  <Text fw={700} ff={clubDesign.font.heading}>{t.teamName}</Text>
                  <Badge size="xs" variant="light" tt="capitalize">{t.role}</Badge>
                </Group>
                <Group gap="xs" mt="sm">
                  <Button component={Link} to={`/teams/${t.teamLeague}/${t.teamSlug}`} size="xs" variant="light" radius="xl">
                    Fixtures &amp; Results
                  </Button>
                  {t.role !== 'subscriber' && (
                    <Button component={Link} to="/bookings" size="xs" variant="outline" radius="xl">
                      Book Pitch
                    </Button>
                  )}
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </Box>
      )}

      {/* Who We Are — values cards in the design's neutral card style */}
      {hasAbout && (
        <Box>
          <Group justify="space-between" align="baseline" mb="sm">
            <Title order={3} ff={clubDesign.font.heading} fw={800}>Who We Are</Title>
            {hasHistory && (
              <Button
                component={Link}
                to="/about"
                variant="subtle"
                size="compact-sm"
                rightSection={<IconArrowRight size={12} />}
              >
                Read Our Full Story
              </Button>
            )}
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {club.about.map((item, i) => (
              <Paper key={i} p="lg" radius="md" withBorder>
                <Group align="flex-start" gap="md" wrap="nowrap">
                  <ThemeIcon variant="light" size="lg" radius="md">
                    {tablerIcon(item.icon)}
                  </ThemeIcon>
                  <Box>
                    <Text fw={700} ff={clubDesign.font.heading} mb={4}>{item.title}</Text>
                    <Text size="sm" c="dimmed" dangerouslySetInnerHTML={{ __html: item.text }} />
                  </Box>
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </Box>
      )}
    </Stack>
  );
}

import { Title, Text, SimpleGrid, Paper, ThemeIcon, Group, Stack, Box, Image, Badge } from '@mantine/core';
import type { Club } from '../types';
import { tablerIcon } from '../utils/icons';
import { HeroBanner } from '../components/club/HeroBanner';
import { clubDesign } from '../theme';

interface Props { club: Club }

export function AboutPage({ club }: Props) {
  const hasHistory = club.history && club.history.length > 0;
  const hasAbout = club.about && club.about.length > 0;

  return (
    <Stack gap="lg">
      <HeroBanner padding={28}>
        <Group align="center" gap="lg" wrap="wrap">
          {club.badge && (
            <Box
              style={{
                width: 88,
                height: 88,
                borderRadius: 14,
                background: 'rgba(255,255,255,0.08)',
                padding: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Image src={club.badge} alt={`${club.name} Badge`} fit="contain" />
            </Box>
          )}
          <Stack gap={6} style={{ flex: 1, minWidth: 220 }}>
            <Title order={2} ff={clubDesign.font.heading} fw={800} c="#fff" fz={{ base: 22, sm: 28 }}>
              About {club.name}
            </Title>
            {club.tagline && (
              <Text c="rgba(255,255,255,0.65)" size="sm">
                {club.tagline}
              </Text>
            )}
            {(club.founded || club.colours) && (
              <Group gap="xs" mt={4}>
                {club.founded && (
                  <Badge variant="white" color="dark" radius="xl">
                    Est. {club.founded}
                  </Badge>
                )}
                {club.colours && (
                  <Badge radius="xl">
                    {club.colours}
                  </Badge>
                )}
              </Group>
            )}
          </Stack>
        </Group>
      </HeroBanner>

      {hasHistory && (
        <Paper p="xl" radius="md" withBorder>
          <Title order={3} ff={clubDesign.font.heading} fw={800} mb="md">Our Story</Title>
          <Stack gap="sm">
            {club.history.map((p, i) => (
              <Text key={i} size="sm" c={clubDesign.color.n7} lh={1.7}>{p}</Text>
            ))}
          </Stack>
        </Paper>
      )}

      {hasAbout && (
        <Box>
          <Title order={3} ff={clubDesign.font.heading} fw={800} mb="sm">Who We Are</Title>
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

      {!hasHistory && !hasAbout && (
        <Text c="dimmed">No club history or about information has been added yet.</Text>
      )}
    </Stack>
  );
}

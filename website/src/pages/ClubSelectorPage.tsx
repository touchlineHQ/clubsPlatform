import { Title, Text, SimpleGrid, Paper, Stack, Group, Image, Center, Loader } from '@mantine/core';
import type { ClubEntry } from '../types';

interface Props {
  clubs: ClubEntry[];
  loading?: boolean;
}

export function ClubSelectorPage({ clubs, loading }: Props) {
  if (loading) {
    return (
      <Center h="60vh">
        <Loader size="xl" />
      </Center>
    );
  }

  return (
    <Stack gap="xl" p="xl">
      <Stack gap="xs">
        <Title order={1}>Clubs Platform</Title>
        <Text c="dimmed" size="lg">Select a club to continue</Text>
      </Stack>

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="lg">
        {clubs.map((club) => (
          <Paper
            key={club.slug}
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
                  }}
                >
                  {club.name.charAt(0)}
                </Center>
              )}
              <Stack gap={2}>
                <Text fw={600} size="lg">{club.name}</Text>
                <Text size="sm" c="dimmed">{club.slug}</Text>
              </Stack>
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
